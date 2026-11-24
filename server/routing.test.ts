import assert from 'node:assert/strict';
import {
  createEmptyProviderStateMap,
  isModelFreeTier,
  PROVIDER_IDS,
  PROVIDER_REGISTRY,
} from '../src/shared/providers.ts';
import type {
  CouncilSSEEvent,
  ModelInfo,
  PreflightReport,
  ProviderId,
} from '../src/shared/types.ts';
import { buildChatGptAliasModelInfo, pickBestGeminiFlashLiteModelId } from './chatgptAlias.ts';
import { inferModelTier, probeSingleModel } from './modelCatalogService.ts';
import {
  classifyProviderError,
  clearProviderHealth,
  getModelUnavailableReason,
  getProviderHealth,
  getVerifiedModelsCount,
  isModelAccessVerified,
  PROVIDER_BLOCK_TTL_MS,
  RATE_LIMIT_TTL_MS,
  recordModelAccessVerified,
  recordModelUnavailable,
  recordProviderHealth,
} from './modelHealth.ts';
import { runCouncilEngine } from './orchestrator.ts';
import {
  getMlaConfig,
  getPublicWalletClientConfig,
  getSafeMlaConfigForAdmin,
  saveMlaConfig,
} from './payments.ts';
import { runCouncilPreflight } from './preflight.ts';
import { ANTHROPIC_PROBE_TIMEOUT_MS, verifyAnthropicConnection } from './providers/anthropic.ts';
import { GEMINI_PROBE_TIMEOUT_MS } from './providers/gemini.ts';
import {
  discoverOpenAIModels,
  PROBE_TIMEOUT_MS as OPENAI_PROBE_TIMEOUT_MS,
  probeOpenAIModel,
} from './providers/openai.ts';
import {
  pickFallbackModel,
  rankFallbackCandidates,
  selectModelsHeuristically,
  smartSelectModels,
} from './smartSelect.ts';

function makeModel(
  provider: ProviderId,
  modelId: string,
  opts: Partial<ModelInfo> = {},
): ModelInfo {
  const available = opts.available ?? true;
  return {
    compositeId: `${provider}:${modelId}`,
    provider,
    modelId,
    displayName: modelId,
    description: `${provider} model ${modelId}`,
    capabilities: ['Reasoning', 'Text', 'Streaming'],
    contextWindowTokens: 128000,
    supportsMultimodal: true,
    source: 'live_discovered',
    available,
    availabilityState:
      opts.availabilityState ?? (available ? 'inference_ready' : 'unavailable'),
    tier: inferModelTier(modelId),
    inputPricePer1MUsd: null,
    outputPricePer1MUsd: null,
    pricingVerified: false,
    ...opts,
  };
}

function makeProviderStates(
  overrides: Partial<PreflightReport['providerStates']> = {},
): PreflightReport['providerStates'] {
  const base = createEmptyProviderStateMap((pid) => {
    if (pid === 'google' || pid === 'openai') {
      return {
        connected: true,
        healthState: 'inference_ready' as const,
        message: null,
        discoveredCount: 3,
        inferenceReadyCount: 3,
      };
    }
    if (pid === 'anthropic') {
      return {
        connected: true,
        healthState: 'inference_ready' as const,
        message: null,
        discoveredCount: 2,
        inferenceReadyCount: 2,
      };
    }
    return {
      connected: false,
      healthState: 'disconnected' as const,
      message: null,
      discoveredCount: 0,
      inferenceReadyCount: 0,
    };
  });
  return {
    ...base,
    ...overrides,
  };
}

async function runTests() {
  // 0. Error classification, 7-state machine, and per-model inference gating
  {
    const creditErr = classifyProviderError(
      new Error('Your credit balance is too low to access the Anthropic API.'),
    );
    assert.equal(creditErr.category, 'insufficient_credits');
    assert.equal(creditErr.retryable, false);

    const quotaErr = classifyProviderError(
      new Error('429 You exceeded your current quota (insufficient_quota).'),
    );
    assert.equal(quotaErr.category, 'insufficient_credits');
    assert.equal(quotaErr.retryable, false);

    const credErr = classifyProviderError({ status: 401, message: 'incorrect_api_key invalid_api_key' });
    assert.equal(credErr.category, 'invalid_credentials');
    assert.equal(credErr.retryable, false);

    const notFoundErr = classifyProviderError({ status: 404, message: 'model_not_found: gpt-99 does not exist' });
    assert.equal(notFoundErr.category, 'invalid_model');
    assert.equal(notFoundErr.retryable, false);

    const rateErr = classifyProviderError({ status: 429, message: 'Too Many Requests: rate_limit_exceeded' });
    assert.equal(rateErr.category, 'rate_limited');
    assert.equal(rateErr.retryable, true);

    const transientErr = classifyProviderError({ status: 503, message: 'Service Unavailable ETIMEDOUT' });
    assert.equal(transientErr.category, 'transient_error');
    assert.equal(transientErr.retryable, true);

    // Health state machine & independent per-model inference tracking
    const uid = 'test_user_health_states';
    clearProviderHealth(uid, 'google');
    assert.equal(getProviderHealth(uid, 'google').state, 'connected');
    assert.equal(getVerifiedModelsCount(uid, 'google'), 0);

    recordProviderHealth(uid, 'google', 'verified', null);
    assert.equal(getProviderHealth(uid, 'google').state, 'verified');

    recordModelAccessVerified(uid, 'google', 'google:gemini-2.5-flash');
    assert.equal(getProviderHealth(uid, 'google').state, 'inference_ready');
    assert.equal(isModelAccessVerified(uid, 'google:gemini-2.5-flash'), true);
    // Sibling model from same provider MUST NOT become inference-verified automatically
    assert.equal(isModelAccessVerified(uid, 'google:gemini-2.5-pro'), false);
    assert.equal(getVerifiedModelsCount(uid, 'google'), 1);

    recordModelAccessVerified(uid, 'google', 'google:gemini-2.5-pro');
    assert.equal(getVerifiedModelsCount(uid, 'google'), 2);

    recordProviderHealth(uid, 'google', 'rate_limited', 'Rate limit hit', 'rate_limited');
    assert.equal(getProviderHealth(uid, 'google').state, 'rate_limited');
    assert.equal(isModelAccessVerified(uid, 'google:gemini-2.5-flash'), false);
    assert.equal(getVerifiedModelsCount(uid, 'google'), 0);

    recordModelUnavailable(uid, 'google:bad-model', 'Model not found', 'invalid_model');
    assert.equal(getModelUnavailableReason(uid, 'google:bad-model')?.errorCategory, 'invalid_model');
    clearProviderHealth(uid, 'google');
  }

  // Verify fabricated/non-existent model IDs are never mapped to special tiers
  {
    assert.equal(inferModelTier('gemini-2.5-flash-lite'), 'low');
    assert.equal(inferModelTier('gemini-2.5-flash'), 'medium');
    assert.equal(inferModelTier('gemini-2.5-pro'), 'extreme');
    assert.equal(inferModelTier('gpt-4o-mini'), 'low');
    assert.equal(inferModelTier('o3'), 'extreme');
  }

  // Scenario 1: Gemini connection & actual response (with unverified OpenAI/Anthropic excluded)
  {
    const uid = 'test_scenario_1_gemini_response';
    clearProviderHealth(uid, 'google');

    const events: CouncilSSEEvent[] = [];
    const readyGoogle = [
      makeModel('google', 'gemini-2.5-flash'),
      makeModel('google', 'gemini-2.5-pro'),
    ];
    const providerStates = makeProviderStates({
      openai: {
        connected: false,
        healthState: 'disconnected',
        message: 'Not connected',
        discoveredCount: 0,
        inferenceReadyCount: 0,
      },
      anthropic: {
        connected: false,
        healthState: 'disconnected',
        message: 'Not connected',
        discoveredCount: 0,
        inferenceReadyCount: 0,
      },
    });

    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_gemini_1',
      mode: 'chat',
      intelligenceLevel: 'medium',
      selectedModels: ['google:gemini-2.5-flash'],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Explain Raft leader election concisely.',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        resolveKey: async (_u, _t, pid) => (pid === 'google' ? 'gemini-key' : null),
        getCatalog: async () => ({
          models: readyGoogle,
          discoveryErrors: {},
          warnings: [],
          providerStates,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [readyGoogle[0]],
          rejectedModels: [],
          providerStates,
          warnings: [],
        }),
        probeModel: async () => ({ ok: true, availabilityState: 'inference_ready' }),
        invokeStream: async ({ provider, modelId, onDelta }) => {
          assert.equal(provider, 'google');
          onDelta('Leader election uses randomized election timeouts.');
          return {
            content: 'Leader election uses randomized election timeouts.',
            inputTokens: 42,
            outputTokens: 18,
            latencyMs: 190,
            estimatedCostUsd: 0.00008,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    const done = events.find((e) => e.type === 'model_done');
    assert.ok(done && done.type === 'model_done');
    assert.equal(done.provider, 'google');
    assert.equal(done.content, 'Leader election uses randomized election timeouts.');
    const councilDone = events.find((e) => e.type === 'council_done');
    assert.ok(councilDone && councilDone.type === 'council_done');
    assert.equal(councilDone.status, 'completed');
  }

  // Scenario 2: Multiple Gemini models in one Council (SmartSelect + Orchestrator)
  {
    const uid = 'test_scenario_2_multi_gemini';
    const googleCatalog = [
      makeModel('google', 'gemini-2.5-flash-lite'),
      makeModel('google', 'gemini-2.5-flash'),
      makeModel('google', 'gemini-2.5-pro'),
      // Models listed via models.list() but NOT inference-tested must NEVER be selected
      makeModel('google', 'gemini-experimental-listed-only', {
        available: false,
        availabilityState: 'verified',
      }),
    ];
    const providerStates = makeProviderStates({
      google: {
        connected: true,
        healthState: 'inference_ready',
        message: null,
        discoveredCount: 4,
        inferenceReadyCount: 3,
      },
      openai: {
        connected: false,
        healthState: 'disconnected',
        message: null,
        discoveredCount: 0,
        inferenceReadyCount: 0,
      },
      anthropic: {
        connected: false,
        healthState: 'disconnected',
        message: null,
        discoveredCount: 0,
        inferenceReadyCount: 0,
      },
    });

    const smartResult = await smartSelectModels({
      uid,
      idToken: 'tok',
      prompt: 'Design an event-sourced ledger with idempotent consumers',
      mode: 'debate',
      intelligenceLevel: 'high',
      runPreflightFn: async () => ({
        ok: true,
        checkedAt: new Date().toISOString(),
        readyModels: googleCatalog.slice(0, 3),
        rejectedModels: [],
        providerStates,
        warnings: [],
      }),
    });

    assert.equal(smartResult.selectedModels.length, 3);
    assert.ok(smartResult.selectedModels.every((id) => id.startsWith('google:')));
    assert.ok(!smartResult.selectedModels.includes('google:gemini-experimental-listed-only'));
    assert.equal(smartResult.singleModelMode, false);
    assert.notEqual(smartResult.moderatorModel, 'none');

    // Run structured debate with 2 independently verified Gemini models
    const events: CouncilSSEEvent[] = [];
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_multi_gemini',
      mode: 'debate',
      intelligenceLevel: 'high',
      selectedModels: ['google:gemini-2.5-flash', 'google:gemini-2.5-pro'],
      moderatorModel: 'google:gemini-2.5-pro',
      maxRounds: 3,
      startRound: 1,
      priorMessages: [],
      userPrompt: 'Postgres vs CockroachDB for multi-region ledger',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        resolveKey: async () => 'gemini-key',
        getCatalog: async () => ({
          models: googleCatalog,
          discoveryErrors: {},
          warnings: [],
          providerStates,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: googleCatalog.slice(0, 3),
          rejectedModels: [],
          providerStates,
          warnings: [],
        }),
        probeModel: async () => ({ ok: true, availabilityState: 'inference_ready' }),
        invokeStream: async ({ modelId, onDelta }) => {
          const text = `Gemini perspective from ${modelId}`;
          onDelta(text);
          return {
            content: text,
            inputTokens: 80,
            outputTokens: 60,
            latencyMs: 140,
            estimatedCostUsd: 0.0002,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    // 3 rounds * 2 models + 1 moderator verdict = 7 completed messages
    assert.equal(events.filter((e) => e.type === 'model_done').length, 7);
    const done = events.find((e) => e.type === 'council_done');
    assert.ok(done && done.type === 'council_done' && done.status === 'completed');
  }

  // Scenario 3: OpenAI insufficient credits (models.list accessible, inference denied -> blocked, no retry, Gemini still succeeds)
  {
    const uid = 'test_scenario_3_openai_credits';
    clearProviderHealth(uid, 'openai');
    clearProviderHealth(uid, 'google');

    const events: CouncilSSEEvent[] = [];
    let openaiAttempts = 0;

    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_openai_credits',
      mode: 'chat',
      intelligenceLevel: 'medium',
      selectedModels: ['openai:gpt-4o-mini', 'google:gemini-2.5-flash'],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Summarize HTTP/3 QUIC benefits',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        resolveKey: async () => 'key',
        getCatalog: async () => ({
          models: [
            makeModel('openai', 'gpt-4o-mini'),
            makeModel('google', 'gemini-2.5-flash'),
            makeModel('google', 'gemini-2.5-pro'),
          ],
          discoveryErrors: {},
          warnings: [],
          providerStates: makeProviderStates(),
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [makeModel('openai', 'gpt-4o-mini'), makeModel('google', 'gemini-2.5-flash')],
          rejectedModels: [],
          providerStates: makeProviderStates(),
          warnings: [],
        }),
        probeModel: async (_u, pid) => {
          assert.notEqual(pid, 'openai', 'Must never re-probe exhausted-credit OpenAI');
          return { ok: true, availabilityState: 'inference_ready' };
        },
        invokeStream: async ({ provider, modelId, onDelta }) => {
          if (provider === 'openai') {
            openaiAttempts += 1;
            throw Object.assign(
              new Error('You exceeded your current quota, please check your plan and billing details'),
              { status: 429, code: 'insufficient_quota' },
            );
          }
          const txt = `Google reply (${modelId})`;
          onDelta(txt);
          return {
            content: txt,
            inputTokens: 50,
            outputTokens: 30,
            latencyMs: 110,
            estimatedCostUsd: 0.0001,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    assert.equal(openaiAttempts, 1, 'OpenAI insufficient_quota must NEVER be retried');
    assert.equal(getProviderHealth(uid, 'openai').state, 'insufficient_credits');
    const fb = events.find((e) => e.type === 'model_fallback');
    assert.ok(fb && fb.type === 'model_fallback');
    assert.equal(fb.errorCategory, 'insufficient_credits');
    assert.ok(fb.fallbackCompositeId.startsWith('google:'));
  }

  // Scenario 4: Anthropic insufficient credits (distinguished from models.list, never retried, cross-provider fallback)
  {
    const uid = 'test_scenario_4_anthropic_credits';
    clearProviderHealth(uid, 'anthropic');
    clearProviderHealth(uid, 'google');

    const events: CouncilSSEEvent[] = [];
    let anthropicCalls = 0;

    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_anthropic_credits',
      mode: 'chat',
      intelligenceLevel: 'high',
      selectedModels: ['anthropic:claude-sonnet-4-5', 'google:gemini-2.5-flash'],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Review distributed lock leases',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: [
            makeModel('anthropic', 'claude-sonnet-4-5'),
            makeModel('anthropic', 'claude-3-5-haiku-latest'),
            makeModel('google', 'gemini-2.5-flash'),
            makeModel('google', 'gemini-2.5-pro'),
          ],
          discoveryErrors: {},
          warnings: [],
          providerStates: makeProviderStates(),
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [makeModel('anthropic', 'claude-sonnet-4-5'), makeModel('google', 'gemini-2.5-flash')],
          rejectedModels: [],
          providerStates: makeProviderStates(),
          warnings: [],
        }),
        probeModel: async (_u, pid) => {
          assert.notEqual(pid, 'anthropic', 'Must never probe Anthropic once credits are exhausted');
          return { ok: true, availabilityState: 'inference_ready' };
        },
        invokeStream: async ({ provider, modelId, onDelta }) => {
          if (provider === 'anthropic') {
            anthropicCalls += 1;
            throw new Error('400 Your credit balance is too low to access the Anthropic API.');
          }
          onDelta(`Reply from ${provider}:${modelId}`);
          return {
            content: `Reply from ${provider}:${modelId}`,
            inputTokens: 90,
            outputTokens: 60,
            latencyMs: 150,
            estimatedCostUsd: 0.0003,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    assert.equal(anthropicCalls, 1, 'Exhausted Anthropic credit error must never be retried');
    assert.equal(getProviderHealth(uid, 'anthropic').state, 'insufficient_credits');
    const fb = events.find((e) => e.type === 'model_fallback');
    assert.ok(fb && fb.type === 'model_fallback');
    assert.equal(fb.errorCategory, 'insufficient_credits');
    assert.ok(fb.fallbackCompositeId.startsWith('google:'));
  }

  // Scenario 5: Invalid model IDs (rejected at preflight + runtime 404 never retried repeatedly)
  {
    const uid = 'test_scenario_5_invalid_models';
    clearProviderHealth(uid, 'google');
    clearProviderHealth(uid, 'openai');

    const liveCatalog = [
      makeModel('google', 'gemini-2.5-flash'),
      makeModel('google', 'gemini-2.5-pro'),
      makeModel('openai', 'gpt-4o'),
      makeModel('openai', 'gpt-4o-mini'),
    ];

    const preflightReport = await runCouncilPreflight({
      uid,
      idToken: 'tok',
      targetCompositeIds: [
        'google:gemini-2.5-flash',
        'google:nonexistent-model-id',
        'openai:dall-e-3',
      ],
      deps: {
        getCatalog: async () => ({
          models: [
            makeModel('google', 'gemini-2.5-flash'),
            makeModel('openai', 'dall-e-3', {
              capabilities: ['Image Generation'],
              available: false,
              availabilityState: 'unavailable',
            }),
          ],
          discoveryErrors: {},
          warnings: [],
          providerStates: makeProviderStates(),
        }),
        resolveKey: async () => 'fake-key',
        probeModel: async (_u, pid, _k, modelId) => {
          if (pid === 'google' && modelId === 'gemini-2.5-flash') {
            return { ok: true, availabilityState: 'inference_ready' };
          }
          return {
            ok: false,
            availabilityState: 'unavailable',
            errorCategory: 'invalid_model',
            reason: 'Probe failed',
          };
        },
      },
    });

    assert.equal(preflightReport.readyModels.length, 1);
    assert.equal(
      preflightReport.rejectedModels.find((r) => r.compositeId === 'google:nonexistent-model-id')?.errorCategory,
      'invalid_model',
    );
    assert.equal(
      preflightReport.rejectedModels.find((r) => r.compositeId === 'openai:dall-e-3')?.errorCategory,
      'invalid_model',
    );

    // Runtime 404 on selected model must execute strictly ONCE (zero retry waste) and fall back cleanly
    const events: CouncilSSEEvent[] = [];
    const invokeCounts = new Map<string, number>();

    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_invalid_runtime',
      mode: 'chat',
      intelligenceLevel: 'medium',
      selectedModels: ['google:stale-invalid-id', 'openai:gpt-4o'],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Explain TLS 1.3 handshake',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: liveCatalog,
          discoveryErrors: {},
          warnings: [],
          providerStates: makeProviderStates(),
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [makeModel('openai', 'gpt-4o')],
          rejectedModels: [
            {
              compositeId: 'google:stale-invalid-id',
              provider: 'google',
              modelId: 'stale-invalid-id',
              availabilityState: 'unavailable',
              available: false,
              reason: 'Model ID not found in live discovery.',
              errorCategory: 'invalid_model',
            },
          ],
          providerStates: makeProviderStates(),
          warnings: [],
        }),
        probeModel: async (_u, pid, _k, modelId) => {
          if (
            (pid === 'openai' && modelId === 'gpt-4o-mini') ||
            (pid === 'google' && modelId === 'gemini-2.5-flash')
          ) {
            return { ok: true, availabilityState: 'inference_ready' };
          }
          return {
            ok: false,
            availabilityState: 'unavailable',
            errorCategory: 'invalid_model',
            reason: 'Probe failed',
          };
        },
        invokeStream: async ({ provider, modelId, onDelta }) => {
          const cid = `${provider}:${modelId}`;
          invokeCounts.set(cid, (invokeCounts.get(cid) || 0) + 1);
          if (cid === 'openai:gpt-4o') {
            throw Object.assign(new Error('model_not_found: gpt-4o disabled on project'), {
              status: 404,
            });
          }
          onDelta(`Valid reply from ${cid}`);
          return {
            content: `Valid reply from ${cid}`,
            inputTokens: 50,
            outputTokens: 40,
            latencyMs: 120,
            estimatedCostUsd: 0.0002,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    assert.equal(invokeCounts.get('openai:gpt-4o'), 1);
    assert.equal(events.filter((e) => e.type === 'model_fallback').length, 2);
    assert.equal(events.find((e) => e.type === 'council_done' && e.status === 'completed')?.type, 'council_done');
  }

  // Scenario 6: Provider rate limits (retries once transparently; if persistently rate limited, transitions state & falls back)
  {
    const uid = 'test_scenario_6_rate_limits';
    clearProviderHealth(uid, 'google');
    clearProviderHealth(uid, 'openai');

    let openaiRateCalls = 0;
    let googleTransientCalls = 0;
    const events: CouncilSSEEvent[] = [];

    const catalog = [
      makeModel('openai', 'gpt-4o-mini'),
      makeModel('google', 'gemini-2.5-flash'),
      makeModel('google', 'gemini-2.5-pro'),
    ];

    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_rate_limit',
      mode: 'chat',
      intelligenceLevel: 'medium',
      selectedModels: ['openai:gpt-4o-mini', 'google:gemini-2.5-flash'],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Compare B-Tree vs LSM-Tree indexes',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: catalog,
          discoveryErrors: {},
          warnings: [],
          providerStates: makeProviderStates(),
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: catalog.slice(0, 2),
          rejectedModels: [],
          providerStates: makeProviderStates(),
          warnings: [],
        }),
        probeModel: async (_u, pid, _k, modelId) => {
          if (pid === 'google' && modelId === 'gemini-2.5-pro') {
            return { ok: true, availabilityState: 'inference_ready' };
          }
          return { ok: false, availabilityState: 'rate_limited', errorCategory: 'rate_limited', reason: 'Still rate limited' };
        },
        invokeStream: async ({ provider, modelId, onDelta }) => {
          if (provider === 'openai') {
            openaiRateCalls += 1;
            // Persistent rate limit across initial try + 1 retry
            throw Object.assign(new Error('Too Many Requests: rate_limit_exceeded'), { status: 429 });
          }
          if (modelId === 'gemini-2.5-flash') {
            googleTransientCalls += 1;
            if (googleTransientCalls === 1) {
              throw Object.assign(new Error('rate_limit_exceeded'), { status: 429 });
            }
          }
          onDelta(`Recovered reply from ${provider}:${modelId}`);
          return {
            content: `Recovered reply from ${provider}:${modelId}`,
            inputTokens: 35,
            outputTokens: 25,
            latencyMs: 95,
            estimatedCostUsd: 0.0001,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    assert.equal(openaiRateCalls, 2, 'Rate limit should retry exactly once before falling back');
    assert.equal(googleTransientCalls, 2, 'Single transient rate limit should recover on retry');
    // 429 rate limit must NOT block the whole OpenAI provider; only mark the single model unavailable
    assert.notEqual(getProviderHealth(uid, 'openai').state, 'insufficient_credits');
    assert.notEqual(getProviderHealth(uid, 'openai').state, 'invalid_credentials');
    assert.equal(getModelUnavailableReason(uid, 'openai:gpt-4o-mini')?.errorCategory, 'rate_limited');
    const fb = events.find((e) => e.type === 'model_fallback' && e.originalCompositeId === 'openai:gpt-4o-mini');
    assert.ok(fb && fb.type === 'model_fallback');
    assert.equal(fb.errorCategory, 'rate_limited');
    assert.equal(fb.fallbackCompositeId, 'google:gemini-2.5-pro');
  }

  // Scenario 7: No available models (SmartSelect throws & Orchestrator emits fatal_error + status error, never reports success)
  {
    await assert.rejects(
      async () =>
        smartSelectModels({
          uid: 'test_scenario_7_smart_none',
          idToken: 'tok',
          prompt: 'Hello council',
          mode: 'chat',
          intelligenceLevel: 'medium',
          runPreflightFn: async () => ({
            ok: false,
            checkedAt: new Date().toISOString(),
            readyModels: [],
            rejectedModels: [],
            providerStates: makeProviderStates({
              google: {
                connected: true,
                healthState: 'invalid_credentials',
                message: 'API key invalid',
                discoveredCount: 0,
                inferenceReadyCount: 0,
              },
              openai: {
                connected: true,
                healthState: 'insufficient_credits',
                message: 'Quota empty',
                discoveredCount: 2,
                inferenceReadyCount: 0,
              },
              anthropic: {
                connected: false,
                healthState: 'disconnected',
                message: 'Not connected',
                discoveredCount: 0,
                inferenceReadyCount: 0,
              },
            }),
            warnings: ['openai: Quota empty', 'google: API key invalid'],
          }),
        }),
      /No usable models are available/,
    );

    const events: CouncilSSEEvent[] = [];
    let invokeCalls = 0;

    await runCouncilEngine({
      uid: 'test_scenario_7_orch_none',
      idToken: 'tok',
      councilId: 'c_empty',
      mode: 'debate',
      intelligenceLevel: 'high',
      selectedModels: ['google:bad-id', 'openai:bad-id-2'],
      moderatorModel: 'google:bad-id',
      maxRounds: 3,
      startRound: 1,
      priorMessages: [],
      userPrompt: 'Impossible run',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        resolveKey: async () => null,
        getCatalog: async () => ({
          models: [],
          discoveryErrors: {},
          warnings: ['All providers disconnected or out of credits.'],
          providerStates: makeProviderStates({
            google: { connected: false, healthState: 'disconnected', message: 'Not connected', discoveredCount: 0, inferenceReadyCount: 0 },
            openai: { connected: true, healthState: 'insufficient_credits', message: 'Credits exhausted', discoveredCount: 0, inferenceReadyCount: 0 },
            anthropic: { connected: false, healthState: 'disconnected', message: 'Not connected', discoveredCount: 0, inferenceReadyCount: 0 },
          }),
        }),
        runPreflight: async () => ({
          ok: false,
          checkedAt: new Date().toISOString(),
          readyModels: [],
          rejectedModels: [
            {
              compositeId: 'google:bad-id',
              provider: 'google',
              modelId: 'bad-id',
              availabilityState: 'invalid_credentials',
              available: false,
              reason: 'Invalid API key',
              errorCategory: 'invalid_credentials',
            },
            {
              compositeId: 'openai:bad-id-2',
              provider: 'openai',
              modelId: 'bad-id-2',
              availabilityState: 'insufficient_credits',
              available: false,
              reason: 'OpenAI credits exhausted',
              errorCategory: 'insufficient_credits',
            },
          ],
          providerStates: makeProviderStates(),
          warnings: ['All providers disconnected or out of credits.'],
        }),
        invokeStream: async () => {
          invokeCalls += 1;
          throw new Error('Should never execute');
        },
      },
    });

    assert.equal(invokeCalls, 0);
    const fatal = events.find((e) => e.type === 'fatal_error');
    assert.ok(fatal && fatal.type === 'fatal_error');
    const done = events.find((e) => e.type === 'council_done');
    assert.ok(done && done.type === 'council_done');
    assert.equal(done.status, 'error');
    assert.equal(events.filter((e) => e.type === 'model_done').length, 0);
  }

  // Scenario 8: Single Model Chat (usable when exactly 1 model passes inference testing; blocked for multi-model debate)
  {
    const uid = 'test_scenario_8_single_model_chat';
    const singleReady = [makeModel('google', 'gemini-2.5-flash')];
    const singlePreflight: PreflightReport = {
      ok: true,
      checkedAt: new Date().toISOString(),
      readyModels: singleReady,
      rejectedModels: [],
      providerStates: makeProviderStates({
        google: {
          connected: true,
          healthState: 'inference_ready',
          message: null,
          discoveredCount: 5,
          inferenceReadyCount: 1,
        },
        openai: {
          connected: false,
          healthState: 'disconnected',
          message: null,
          discoveredCount: 0,
          inferenceReadyCount: 0,
        },
        anthropic: {
          connected: false,
          healthState: 'disconnected',
          message: null,
          discoveredCount: 0,
          inferenceReadyCount: 0,
        },
      }),
      warnings: [],
    };

    const singleSmart = await smartSelectModels({
      uid,
      idToken: 'tok',
      prompt: 'Explain idempotency keys',
      mode: 'chat',
      intelligenceLevel: 'medium',
      runPreflightFn: async () => singlePreflight,
    });
    assert.equal(singleSmart.singleModelMode, true);
    assert.deepEqual(singleSmart.selectedModels, ['google:gemini-2.5-flash']);
    assert.equal(singleSmart.moderatorModel, 'none');

    // Structured debate MUST still reject 1 model
    await assert.rejects(
      async () =>
        smartSelectModels({
          uid,
          idToken: 'tok',
          prompt: 'Debate monolith vs microservices',
          mode: 'debate',
          intelligenceLevel: 'medium',
          runPreflightFn: async () => singlePreflight,
        }),
      /requires at least 2 usable models/,
    );

    // Run Single Model Chat end-to-end in Orchestrator
    const events: CouncilSSEEvent[] = [];
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_single_chat',
      mode: 'chat',
      intelligenceLevel: 'medium',
      selectedModels: ['google:gemini-2.5-flash'],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Explain idempotency keys',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        resolveKey: async () => 'gemini-key',
        getCatalog: async () => ({
          models: singleReady,
          discoveryErrors: {},
          warnings: [],
          providerStates: singlePreflight.providerStates,
        }),
        runPreflight: async () => singlePreflight,
        probeModel: async () => ({ ok: true, availabilityState: 'inference_ready' }),
        invokeStream: async ({ modelId, onDelta }) => {
          onDelta(`Single chat reply from ${modelId}`);
          return {
            content: `Single chat reply from ${modelId}`,
            inputTokens: 30,
            outputTokens: 20,
            latencyMs: 90,
            estimatedCostUsd: 0.00005,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    assert.equal(events.filter((e) => e.type === 'model_done').length, 1);
    const done = events.find((e) => e.type === 'council_done');
    assert.ok(done && done.type === 'council_done' && done.status === 'completed');
  }

  // Scenario 9: Smart Fallback verifies candidate BEFORE switching & lazy-selectable models
  {
    const uid = 'test_scenario_9_smart_fallback';
    for (const pid of PROVIDER_IDS) {
      clearProviderHealth(uid, pid);
    }

    // Excluded (available: false) or non-selectable models MUST be skipped; live 'verified' + available models work lazily
    const catalogWithUnavailable: ModelInfo[] = [
      makeModel('google', 'gemini-2.5-flash'),
      makeModel('google', 'gemini-2.5-pro', {
        available: true,
        availabilityState: 'verified',
      }),
      makeModel('openai', 'o3', {
        available: false,
        availabilityState: 'unavailable',
      }),
    ];
    const strictSel = selectModelsHeuristically(
      catalogWithUnavailable,
      'Design a formally verified consensus engine',
      'debate',
      'extreme',
    );
    assert.ok(!strictSel.selectedModels.includes('openai:o3'));
    assert.ok(strictSel.selectedModels.includes('google:gemini-2.5-pro'));

    // Verify Orchestrator probes fallback candidate #1 (fails), skips it without invoking generation, and verifies candidate #2 (succeeds)
    const events: CouncilSSEEvent[] = [];
    const probedOrder: string[] = [];
    const fullCatalog = [
      makeModel('openai', 'gpt-4o'),
      makeModel('anthropic', 'claude-sonnet-4-5'), // Candidate #1 by score -> fails probe
      makeModel('google', 'gemini-2.5-pro'),       // Candidate #2 by score -> passes probe
      makeModel('google', 'gemini-2.5-flash'),
    ];

    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_smart_fallback',
      mode: 'chat',
      intelligenceLevel: 'high',
      selectedModels: ['openai:gpt-4o', 'google:gemini-2.5-flash'],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Analyze safety invariants',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: fullCatalog,
          discoveryErrors: {},
          warnings: [],
          providerStates: makeProviderStates(),
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [makeModel('openai', 'gpt-4o'), makeModel('google', 'gemini-2.5-flash')],
          rejectedModels: [],
          providerStates: makeProviderStates(),
          warnings: [],
        }),
        probeModel: async (_u, pid, _k, modelId) => {
          const cid = `${pid}:${modelId}`;
          probedOrder.push(cid);
          if (pid === 'anthropic') {
            return {
              ok: false,
              availabilityState: 'insufficient_credits',
              errorCategory: 'insufficient_credits',
              reason: 'Credits exhausted',
            };
          }
          return { ok: true, availabilityState: 'inference_ready' };
        },
        invokeStream: async ({ provider, modelId, onDelta }) => {
          const cid = `${provider}:${modelId}`;
          assert.notEqual(provider, 'anthropic', 'Must NEVER invoke generation on failed-probe candidate');
          if (cid === 'openai:gpt-4o') {
            throw Object.assign(new Error('invalid_api_key'), { status: 401 });
          }
          onDelta(`Verified reply from ${cid}`);
          return {
            content: `Verified reply from ${cid}`,
            inputTokens: 40,
            outputTokens: 30,
            latencyMs: 100,
            estimatedCostUsd: 0.0001,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    assert.equal(getProviderHealth(uid, 'openai').state, 'invalid_credentials');
    assert.ok(probedOrder.includes('anthropic:claude-sonnet-4-5'));
    assert.ok(probedOrder.includes('google:gemini-2.5-pro'));
    const fb = events.find((e) => e.type === 'model_fallback');
    assert.ok(fb && fb.type === 'model_fallback');
    assert.equal(fb.errorCategory, 'invalid_credentials');
    assert.equal(fb.fallbackCompositeId, 'google:gemini-2.5-pro');

    // Fallback ranking check
    const ranked = rankFallbackCandidates({
      availableModels: fullCatalog,
      excludedCompositeIds: new Set(['openai:gpt-4o', 'google:gemini-2.5-flash']),
      blockedProviders: new Set<ProviderId>(['anthropic']),
      intelligenceLevel: 'high',
      prompt: 'Analyze invariants',
      mode: 'chat',
    });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].compositeId, 'google:gemini-2.5-pro');
    assert.equal(
      pickFallbackModel({
        availableModels: fullCatalog,
        excludedCompositeIds: new Set(),
        blockedProviders: new Set<ProviderId>(PROVIDER_IDS),
        intelligenceLevel: 'low',
        prompt: 'Hi',
        mode: 'chat',
      }),
      null,
    );
  }

  // Scenario 10: classifyProviderError bug fixes (no bare-digit matching, structured status first, free provider 429)
  {
    // Request ID containing "402" MUST NOT be classified as insufficient_credits or providerLevelBlock
    const reqId402 = classifyProviderError(
      new Error('Upstream socket failure while handling request req_4021abc'),
    );
    assert.notEqual(reqId402.category, 'insufficient_credits');
    assert.equal(reqId402.category, 'upstream_error');
    assert.equal(reqId402.providerLevelBlock, false);

    // Other bare digits inside request IDs (401, 403, 404, 429, 500) must NOT trigger status classification
    for (const token of ['trace_4019', 'span_4032', 'id_4048', 'req_4290', 'err_5007']) {
      const res = classifyProviderError(new Error(`Unexpected failure (${token})`));
      assert.equal(res.category, 'upstream_error', `Bare digits in ${token} must not match error categories`);
    }

    // Real 402
    const real402 = classifyProviderError({ status: 402, message: 'Payment required' }, 'openai');
    assert.equal(real402.category, 'insufficient_credits');
    assert.equal(real402.providerLevelBlock, true);

    // OpenAI insufficient_quota 429
    const openaiQuota429 = classifyProviderError(
      {
        status: 429,
        error: {
          code: 'insufficient_quota',
          type: 'insufficient_quota',
          message: 'You exceeded your current quota, please check your plan and billing details.',
        },
      },
      'openai',
    );
    assert.equal(openaiQuota429.category, 'insufficient_credits');
    assert.equal(openaiQuota429.providerLevelBlock, true);

    // Normal 429 rate limit
    const normal429 = classifyProviderError(
      { status: 429, message: 'Rate limit reached for RPM' },
      'openai',
    );
    assert.equal(normal429.category, 'rate_limited');
    assert.equal(normal429.providerLevelBlock, false);
    assert.equal(normal429.retryable, true);

    // 401 invalid key
    const real401 = classifyProviderError({ status: 401, message: 'Invalid API key' }, 'openai');
    assert.equal(real401.category, 'invalid_credentials');
    assert.equal(real401.providerLevelBlock, true);

    // 403 permission denied must NOT block whole provider
    const real403 = classifyProviderError({ status: 403, message: 'Forbidden for model' }, 'openai');
    assert.equal(real403.category, 'invalid_credentials');
    assert.equal(real403.providerLevelBlock, false);

    // Free OpenAI-compatible providers: 429 MUST be "free limit reached, retry shortly", never credits exhausted
    for (const freePid of ['groq', 'openrouter', 'cerebras', 'mistral'] as const) {
      const free429 = classifyProviderError(
        { status: 429, message: 'You exceeded your current quota for free tier' },
        freePid,
      );
      assert.equal(free429.category, 'rate_limited');
      assert.match(free429.summary.toLowerCase(), /free limit reached, retry shortly/);
      assert.equal(free429.providerLevelBlock, false);
    }
  }

  // Scenario 11: 5-minute provider block TTL & single-model error isolation (no whole-provider blocking)
  {
    const uid = 'test_scenario_11_isolation_ttl';
    clearProviderHealth(uid, 'openai');
    clearProviderHealth(uid, 'groq');

    const startMs = 1_000_000;
    recordProviderHealth(uid, 'openai', 'insufficient_credits', '402 billing limit', 'insufficient_credits', startMs);
    assert.equal(getProviderHealth(uid, 'openai', startMs + 60_000).state, 'insufficient_credits');
    assert.equal(
      getProviderHealth(uid, 'openai', startMs + PROVIDER_BLOCK_TTL_MS + 1).state,
      'connected',
      'Provider block must expire automatically after 5 minutes',
    );

    // Single failed model on Groq (even 402/429/403) must NOT block sibling Groq models
    const probeFail = await probeSingleModel(uid, 'groq', 'gsk_secret_test_key_1234', 'broken-model', {
      openaiClient: {
        chat: {
          completions: {
            create: async () => {
              throw Object.assign(new Error('Rate limit reached for broken-model with gsk_secret_test_key_1234'), {
                status: 429,
              });
            },
          },
        },
      },
    });
    assert.equal(probeFail.ok, false);
    assert.notEqual(getProviderHealth(uid, 'groq').state, 'insufficient_credits');
    assert.notEqual(getProviderHealth(uid, 'groq').state, 'invalid_credentials');
    assert.equal(getModelUnavailableReason(uid, 'groq:broken-model') !== null, true);
    assert.ok(!probeFail.reason?.includes('gsk_secret_test_key_1234'), 'Groq key must be redacted');

    // Sibling model on same Groq provider stays completely usable and passes probe
    assert.equal(getModelUnavailableReason(uid, 'groq:llama-3.3-70b-versatile'), null);
    const siblingOk = await probeSingleModel(
      uid,
      'groq',
      'gsk_secret_test_key_1234',
      'llama-3.3-70b-versatile',
      {
        openaiClient: {
          chat: {
            completions: {
              create: async () => ({ choices: [{ message: { content: 'OK' } }] }),
            },
          },
        },
      },
    );
    assert.equal(siblingOk.ok, true);
    assert.equal(siblingOk.availabilityState, 'inference_ready');
    clearProviderHealth(uid, 'openai');
    clearProviderHealth(uid, 'groq');
  }

  // Scenario 12: OpenAI probeOpenAIModel retries once with max_tokens when max_completion_tokens is unsupported + 20s timeouts
  {
    assert.equal(OPENAI_PROBE_TIMEOUT_MS, 20_000);
    assert.equal(ANTHROPIC_PROBE_TIMEOUT_MS, 20_000);
    assert.equal(GEMINI_PROBE_TIMEOUT_MS, 20_000);

    const calls: Array<Record<string, unknown>> = [];
    await probeOpenAIModel('test-key', 'legacy-chat-model', {
      providerId: 'openai',
      client: {
        chat: {
          completions: {
            create: async (body) => {
              calls.push(body);
              if ('max_completion_tokens' in body) {
                throw Object.assign(
                  new Error("Unsupported parameter: 'max_completion_tokens' is not supported with this model."),
                  { status: 400, code: 'unsupported_parameter', param: 'max_completion_tokens' },
                );
              }
              return { choices: [{ message: { content: 'OK' } }] };
            },
          },
        },
      },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].max_completion_tokens, 128);
    assert.equal(calls[1].max_tokens, 128);
    assert.equal('max_completion_tokens' in calls[1], false);
  }

  // Scenario 13: OpenAI-compatible provider config registry, live /models discovery & OpenRouter :free filter
  {
    assert.equal(PROVIDER_REGISTRY.groq.baseURL, 'https://api.groq.com/openai/v1');
    assert.equal(PROVIDER_REGISTRY.openrouter.baseURL, 'https://openrouter.ai/api/v1');
    assert.equal(PROVIDER_REGISTRY.openrouter.modelIdEndsWith, ':free');
    assert.equal(PROVIDER_REGISTRY.cerebras.baseURL, 'https://api.cerebras.ai/v1');
    assert.equal(PROVIDER_REGISTRY.mistral.baseURL, 'https://api.mistral.ai/v1');
    assert.equal(PROVIDER_REGISTRY.cohere.baseURL, 'https://api.cohere.ai/compatibility/v1');

    const openrouterModels = await discoverOpenAIModels('sk-or-v1-test', {
      providerId: 'openrouter',
      rawModelsList: [
        { id: 'meta-llama/llama-3.3-70b-instruct:free', context_length: 131072 },
        { id: 'openai/gpt-4o', context_length: 128000 },
        { id: 'deepseek/deepseek-r1:free', context_length: 65536 },
        { id: 'anthropic/claude-3.7-sonnet', context_length: 200000 },
      ],
    });
    assert.deepEqual(
      openrouterModels.map((m) => m.modelId),
      ['deepseek/deepseek-r1:free', 'meta-llama/llama-3.3-70b-instruct:free'],
    );
    assert.ok(openrouterModels.every((m) => m.availabilityState === 'verified' && m.available === true));

    const groqModels = await discoverOpenAIModels('gsk_test', {
      providerId: 'groq',
      rawModelsList: [
        { id: 'llama-3.3-70b-versatile', context_length: 131072 },
        { id: 'whisper-large-v3', context_length: 1500 },
      ],
    });
    assert.deepEqual(groqModels.map((m) => m.modelId), ['llama-3.3-70b-versatile']);

    const cohereModels = await discoverOpenAIModels('cohere_test', {
      providerId: 'cohere',
      rawModelsList: [
        { id: 'command-a-03-2025', context_length: 256000 },
        { id: 'embed-english-v3.0', context_length: 512 },
        { id: 'rerank-v3.5', context_length: 4096 },
      ],
    });
    assert.deepEqual(cohereModels.map((m) => m.modelId), ['command-a-03-2025']);
  }

  // Scenario 14: Sequential council model execution with 1-2s delay + redacted raw errors + lazy chat verification
  {
    const uid = 'test_scenario_14_sequential_delay';
    clearProviderHealth(uid, 'groq');
    clearProviderHealth(uid, 'openrouter');

    const trace: string[] = [];
    const events: CouncilSSEEvent[] = [];
    const groqModel = makeModel('groq', 'llama-3.3-70b-versatile', { availabilityState: 'verified' });
    const orModel = makeModel('openrouter', 'deepseek/deepseek-r1:free', { availabilityState: 'verified' });
    const seqStates = makeProviderStates({
      groq: { connected: true, healthState: 'verified', message: null, discoveredCount: 1, inferenceReadyCount: 0 },
      openrouter: { connected: true, healthState: 'verified', message: null, discoveredCount: 1, inferenceReadyCount: 0 },
    });

    const t0 = Date.now();
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_seq_delay',
      mode: 'chat',
      intelligenceLevel: 'medium',
      enableFallback: false,
      selectedModels: [groqModel.compositeId, orModel.compositeId],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Say hi sequentially',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 40,
        resolveKey: async (_u, _t, pid) =>
          pid === 'groq' ? 'gsk_secret_live_999999' : pid === 'openrouter' ? 'sk-or-v1-secret_888888' : null,
        getCatalog: async () => ({
          models: [groqModel, orModel],
          discoveryErrors: {},
          warnings: [],
          providerStates: seqStates,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [groqModel, orModel],
          rejectedModels: [],
          providerStates: seqStates,
          warnings: [],
        }),
        invokeStream: async ({ provider, modelId, onDelta }) => {
          trace.push(`start:${provider}:${modelId}`);
          if (provider === 'openrouter') {
            throw Object.assign(
              new Error('Upstream rejected Bearer sk-or-v1-secret_888888 on model route'),
              { status: 400 },
            );
          }
          onDelta('Hello from Groq');
          trace.push(`end:${provider}:${modelId}`);
          return {
            content: 'Hello from Groq',
            inputTokens: 10,
            outputTokens: 5,
            latencyMs: 15,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });
    const elapsedMs = Date.now() - t0;

    // Strictly sequential: Groq starts and finishes before OpenRouter starts, with turn delay enforced
    assert.deepEqual(trace, [
      'start:groq:llama-3.3-70b-versatile',
      'end:groq:llama-3.3-70b-versatile',
      'start:openrouter:deepseek/deepseek-r1:free',
    ]);
    assert.ok(elapsedMs >= 35, `Expected sequential delay >=35ms, got ${elapsedMs}ms`);
    assert.equal(isModelAccessVerified(uid, groqModel.compositeId), true);

    const errEv = events.find((e) => e.type === 'model_error');
    assert.ok(errEv && errEv.type === 'model_error');
    assert.ok(!errEv.errorMessage.includes('sk-or-v1-secret_888888'), 'API key must be redacted from raw error');
    assert.match(errEv.errorMessage, /\[REDACTED_KEY\]/);
    assert.match(errEv.errorMessage, /Upstream rejected/);
  }

  // Regression: Per-model free-tier limit:0 & 403 org restriction stay per-model; sk-ant-usr- detected cleanly
  {
    const freeTierLimitZero = classifyProviderError(
      {
        status: 429,
        message: 'RESOURCE_EXHAUSTED: Quota exceeded for metric: free_tier_requests, limit: 0, model: gemini-2.5-pro',
      },
      'google',
    );
    assert.equal(freeTierLimitZero.category, 'invalid_model');

    const orgVerifyErr = classifyProviderError(
      { status: 403, message: 'Your organization must be verified to use the model o3.' },
      'openai',
    );
    assert.equal(orgVerifyErr.category, 'invalid_model');

    const usrTokenRes = await verifyAnthropicConnection('sk-ant-usr-example-user-token');
    assert.equal(usrTokenRes.valid, false);
    assert.equal(usrTokenRes.healthState, 'invalid_credentials');
    assert.match(usrTokenRes.error || '', /sk-ant-api03/);
  }

  // Scenario 15: Auto-remove unresponsive models from chat & pass peer context in group chat
  {
    const uid = 'test_scenario_15_autoremove_and_groupchat';
    clearProviderHealth(uid, 'google');
    clearProviderHealth(uid, 'groq');
    clearProviderHealth(uid, 'openai');

    const gFlash = makeModel('google', 'gemini-2.5-flash');
    const brokenGroq = makeModel('groq', 'broken-chat-model');
    const oMini = makeModel('openai', 'gpt-4o-mini');
    const states = makeProviderStates({
      groq: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 1, inferenceReadyCount: 1 },
    });

    // 15a: Free Discussion multi-round — brokenGroq fails in Round 1 with no fallback -> removed in roster_updated & skipped in Round 2
    const debateEvents: CouncilSSEEvent[] = [];
    const roundCalls: Array<{ round: number; modelId: string }> = [];

    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_autoremove',
      mode: 'free',
      intelligenceLevel: 'medium',
      enableFallback: false,
      selectedModels: [brokenGroq.compositeId, gFlash.compositeId],
      moderatorModel: brokenGroq.compositeId,
      maxRounds: 2,
      startRound: 1,
      priorMessages: [],
      userPrompt: 'Compare Redis and Valkey briefly.',
      emit: (e) => debateEvents.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: [brokenGroq, gFlash],
          discoveryErrors: {},
          warnings: [],
          providerStates: states,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [brokenGroq, gFlash],
          rejectedModels: [],
          providerStates: states,
          warnings: [],
        }),
        invokeStream: async ({ modelId, onDelta }) => {
          const rStart = debateEvents.filter((e) => e.type === 'round_start').slice(-1)[0];
          const round = rStart && rStart.type === 'round_start' ? rStart.round : 0;
          roundCalls.push({ round, modelId });
          if (modelId === 'broken-chat-model') {
            throw Object.assign(new Error('model_not_found: broken-chat-model unavailable'), { status: 404 });
          }
          onDelta('Valkey is the community Linux Foundation fork of Redis.');
          return {
            content: 'Valkey is the community Linux Foundation fork of Redis.',
            inputTokens: 25,
            outputTokens: 15,
            latencyMs: 50,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    const rosterEvs = debateEvents.filter((e) => e.type === 'roster_updated');
    assert.ok(rosterEvs.length >= 1, 'Expected roster_updated when unresponsive model removed');
    const lastRoster = rosterEvs[rosterEvs.length - 1];
    assert.equal(lastRoster.type, 'roster_updated');
    if (lastRoster.type === 'roster_updated') {
      assert.deepEqual(lastRoster.selectedModels, [gFlash.compositeId]);
      assert.equal(lastRoster.moderatorModel, gFlash.compositeId);
      assert.equal(lastRoster.removedModels.length, 1);
      assert.equal(lastRoster.removedModels[0].compositeId, brokenGroq.compositeId);
    }
    // broken-chat-model was attempted ONLY in Round 1 and never poked again in Round 2 or Moderator
    assert.deepEqual(
      roundCalls.filter((c) => c.modelId === 'broken-chat-model'),
      [{ round: 1, modelId: 'broken-chat-model' }],
    );

    // 15b: Chat mode passes earlier completed peer reply to next model in same turn
    const chatPrompts: Array<{ modelId: string; prompt: string }> = [];
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_groupchat_ctx',
      mode: 'chat',
      intelligenceLevel: 'low',
      enableFallback: false,
      selectedModels: [gFlash.compositeId, oMini.compositeId],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'hey everyone',
      emit: () => undefined,
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: [gFlash, oMini],
          discoveryErrors: {},
          warnings: [],
          providerStates: states,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [gFlash, oMini],
          rejectedModels: [],
          providerStates: states,
          warnings: [],
        }),
        invokeStream: async ({ modelId, prompt, onDelta }) => {
          chatPrompts.push({ modelId, prompt });
          const text = modelId === 'gemini-2.5-flash' ? 'Hey! What are we working on today?' : 'Hey there, ready to jump in.';
          onDelta(text);
          return {
            content: text,
            inputTokens: 10,
            outputTokens: 8,
            latencyMs: 30,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });
    assert.equal(chatPrompts.length, 2);
    assert.ok(
      chatPrompts[1].prompt.includes('Hey! What are we working on today?'),
      'Second model in group chat must see first model reply',
    );
  }

  // Scenario 16: smartSelectModels probes unverified candidates and drops failing ones before entering chat
  {
    const uid = 'test_scenario_16_smart_select_probing';
    clearProviderHealth(uid, 'groq');
    clearProviderHealth(uid, 'google');

    const badFreeModel = makeModel('groq', 'llama-guard-bad', { availabilityState: 'verified' });
    const goodGroq = makeModel('groq', 'llama-3.3-70b-versatile', { availabilityState: 'verified' });
    const goodGemini = makeModel('google', 'gemini-2.5-flash', { availabilityState: 'inference_ready' });

    const preflightReport: PreflightReport = {
      ok: true,
      checkedAt: new Date().toISOString(),
      readyModels: [badFreeModel, goodGroq, goodGemini],
      rejectedModels: [],
      providerStates: makeProviderStates({
        groq: { connected: true, healthState: 'verified', message: null, discoveredCount: 2, inferenceReadyCount: 0 },
      }),
      warnings: [],
    };

    const probed: string[] = [];
    const smartRes = await smartSelectModels({
      uid,
      idToken: 'tok',
      prompt: 'Help me debug a TypeScript bug',
      mode: 'chat',
      intelligenceLevel: 'medium',
      runPreflightFn: async () => preflightReport,
      resolveKeyFn: async () => 'test-key',
      probeModelFn: async (_u, pid, _k, modelId) => {
        const cid = `${pid}:${modelId}`;
        probed.push(cid);
        if (modelId === 'llama-guard-bad') {
          return { ok: false, availabilityState: 'unavailable', reason: 'Model does not support chat' };
        }
        return { ok: true, availabilityState: 'inference_ready' };
      },
    });

    assert.ok(!smartRes.selectedModels.includes('groq:llama-guard-bad'), 'Failing probed model must be excluded');
    assert.ok(smartRes.selectedModels.includes('google:gemini-2.5-flash'));
    assert.ok(smartRes.selectedModels.includes('groq:llama-3.3-70b-versatile'));
    assert.ok(!probed.includes('google:gemini-2.5-flash'), 'Already inference_ready model should not be re-probed');
  }

  // Scenario 17: Smart AI reaction tag parsing, zero leakage on partial chunks, spam cap, and reaction-only turns
  {
    const uid = 'test_scenario_17_ai_reactions';
    clearProviderHealth(uid, 'google');
    clearProviderHealth(uid, 'openai');
    clearProviderHealth(uid, 'groq');

    const mGoogle = makeModel('google', 'gemini-2.5-flash');
    const mOpenAI = makeModel('openai', 'gpt-4o-mini');
    const mGroq = makeModel('groq', 'llama-3.3-70b-versatile');
    const states = makeProviderStates({
      groq: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 1, inferenceReadyCount: 1 },
    });

    const events: CouncilSSEEvent[] = [];
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_reactions',
      mode: 'chat',
      intelligenceLevel: 'medium',
      enableFallback: false,
      selectedModels: [mGoogle.compositeId, mOpenAI.compositeId, mGroq.compositeId],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'We fixed the race condition!',
      userMessageId: 'user_msg_1',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: [mGoogle, mOpenAI, mGroq],
          discoveryErrors: {},
          warnings: [],
          providerStates: states,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [mGoogle, mOpenAI, mGroq],
          rejectedModels: [],
          providerStates: states,
          warnings: [],
        }),
        invokeStream: async ({ provider, onDelta }) => {
          if (provider === 'google') {
            // Split [[REACT m1 🔥]] across small chunks to verify prefix parser buffers without leaking
            for (const chunk of ['[[RE', 'ACT ', 'm1 🔥]]', ' Nice', ' catch!']) {
              onDelta(chunk);
            }
            return {
              content: '[[REACT m1 🔥]] Nice catch!',
              inputTokens: 12,
              outputTokens: 6,
              latencyMs: 25,
              estimatedCostUsd: 0,
              pricingKnown: true,
              stopped: false,
            };
          }
          if (provider === 'openai') {
            // Pure reaction turn to m1 (user_msg_1)
            onDelta('[[REACT m1 👍]]');
            return {
              content: '[[REACT m1 👍]]',
              inputTokens: 12,
              outputTokens: 4,
              latencyMs: 20,
              estimatedCostUsd: 0,
              pricingKnown: true,
              stopped: false,
            };
          }
          // Third model places [[REACT m1 ❤️]] at the END of its reply -> must STILL strip cleanly from deltas/content
          // and attach onto user_msg_1 (with a second tag from same model ignored)
          for (const chunk of ['Agreed, solid', ' fix. [[RE', 'ACT m1 ❤️]]', ' [[REACT m1 🔥]]']) {
            onDelta(chunk);
          }
          return {
            content: 'Agreed, solid fix. [[REACT m1 ❤️]] [[REACT m1 🔥]]',
            inputTokens: 14,
            outputTokens: 7,
            latencyMs: 22,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    const reactionEvs = events.filter((e) => e.type === 'message_reaction');
    assert.equal(reactionEvs.length, 3, 'Should emit 3 valid reactions (at most 1 per AI model per target message)');
    if (
      reactionEvs[0].type === 'message_reaction' &&
      reactionEvs[1].type === 'message_reaction' &&
      reactionEvs[2].type === 'message_reaction'
    ) {
      assert.equal(reactionEvs[0].targetMessageId, 'user_msg_1');
      assert.equal(reactionEvs[0].reaction.emoji, '🔥');
      assert.equal(reactionEvs[1].targetMessageId, 'user_msg_1');
      assert.equal(reactionEvs[1].reaction.emoji, '👍');
      assert.equal(reactionEvs[2].targetMessageId, 'user_msg_1');
      assert.equal(reactionEvs[2].reaction.emoji, '❤️');
    }

    const deltas = events.filter((e) => e.type === 'model_delta');
    for (const d of deltas) {
      if (d.type === 'model_delta') {
        assert.ok(!d.delta.includes('[[REACT'), `model_delta leaked raw reaction tag: ${d.delta}`);
      }
    }

    const doneEvs = events.filter((e) => e.type === 'model_done');
    assert.equal(doneEvs.length, 3);
    if (
      doneEvs[0].type === 'model_done' &&
      doneEvs[1].type === 'model_done' &&
      doneEvs[2].type === 'model_done'
    ) {
      assert.equal(doneEvs[0].content, 'Nice catch!');
      assert.equal(doneEvs[1].content, '');
      assert.equal(doneEvs[2].content, 'Agreed, solid fix.');
    }

    const councilDone = events.find((e) => e.type === 'council_done');
    assert.ok(councilDone && councilDone.type === 'council_done' && councilDone.status === 'completed');
  }

  // Scenario 18: Emoji normalization, tag format flexibility, and leading-emoji auto-lift onto target message
  {
    const uid = 'test_scenario_18_reaction_normalization_and_lift';
    clearProviderHealth(uid, 'google');
    clearProviderHealth(uid, 'openai');
    clearProviderHealth(uid, 'groq');

    const mGoogle = makeModel('google', 'gemini-2.5-flash');
    const mOpenAI = makeModel('openai', 'gpt-4o-mini');
    const mGroq = makeModel('groq', 'llama-3.3-70b-versatile');
    const states = makeProviderStates({
      groq: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 1, inferenceReadyCount: 1 },
    });

    const events: CouncilSSEEvent[] = [];
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_reactions_norm',
      mode: 'free',
      intelligenceLevel: 'medium',
      enableFallback: false,
      selectedModels: [mGoogle.compositeId, mOpenAI.compositeId, mGroq.compositeId],
      moderatorModel: mGoogle.compositeId,
      maxRounds: 1,
      startRound: 1,
      priorMessages: [],
      userPrompt: 'We shipped zero-downtime blue/green deploys today!',
      userMessageId: 'user_ship_1',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: [mGoogle, mOpenAI, mGroq],
          discoveryErrors: {},
          warnings: [],
          providerStates: states,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [mGoogle, mOpenAI, mGroq],
          rejectedModels: [],
          providerStates: states,
          warnings: [],
        }),
        invokeStream: async ({ systemInstruction, provider, onDelta }) => {
          if (systemInstruction.includes('Council Moderator')) {
            onDelta('1. Executive summary\nGreat deploy.');
            return {
              content: '1. Executive summary\nGreat deploy.',
              inputTokens: 20,
              outputTokens: 10,
              latencyMs: 20,
              estimatedCostUsd: 0,
              pricingKnown: true,
              stopped: false,
            };
          }
          if (provider === 'google') {
            // Unmarked heart without FE0F + comma separator -> normalizes to ❤️
            onDelta('[[REACT: m1, ❤]] Awesome milestone!');
            return {
              content: '[[REACT: m1, ❤]] Awesome milestone!',
              inputTokens: 10,
              outputTokens: 6,
              latencyMs: 15,
              estimatedCostUsd: 0,
              pricingKnown: true,
              stopped: false,
            };
          }
          if (provider === 'openai') {
            // Model forgets [[REACT ...]] and starts its reply with leading reaction emoji
            for (const c of ['🔥 ', 'Huge win for ', 'reliability!']) {
              onDelta(c);
            }
            return {
              content: '🔥 Huge win for reliability!',
              inputTokens: 10,
              outputTokens: 6,
              latencyMs: 15,
              estimatedCostUsd: 0,
              pricingKnown: true,
              stopped: false,
            };
          }
          // Third model uses non-curated standard celebration emoji inside tag
          onDelta('[[REACT m1 🎉]] Smooth rollout.');
          return {
            content: '[[REACT m1 🎉]] Smooth rollout.',
            inputTokens: 10,
            outputTokens: 6,
            latencyMs: 15,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    const reactionEvs = events.filter((e) => e.type === 'message_reaction');
    assert.equal(reactionEvs.length, 3);
    if (
      reactionEvs[0].type === 'message_reaction' &&
      reactionEvs[1].type === 'message_reaction' &&
      reactionEvs[2].type === 'message_reaction'
    ) {
      assert.equal(reactionEvs[0].targetMessageId, 'user_ship_1');
      assert.equal(reactionEvs[0].reaction.emoji, '❤️');
      assert.equal(reactionEvs[1].targetMessageId, 'user_ship_1');
      assert.equal(reactionEvs[1].reaction.emoji, '🔥');
      assert.equal(reactionEvs[2].targetMessageId, 'user_ship_1');
      assert.equal(reactionEvs[2].reaction.emoji, '🎉');
    }

    const modelDoneEvs = events.filter((e) => e.type === 'model_done' && e.role === 'model');
    assert.equal(modelDoneEvs.length, 3);
    if (
      modelDoneEvs[0].type === 'model_done' &&
      modelDoneEvs[1].type === 'model_done' &&
      modelDoneEvs[2].type === 'model_done'
    ) {
      assert.equal(modelDoneEvs[0].content, 'Awesome milestone!');
      assert.equal(modelDoneEvs[1].content, 'Huge win for reliability!');
      assert.equal(modelDoneEvs[2].content, 'Smooth rollout.');
    }

    const allDeltas = events.filter((e) => e.type === 'model_delta');
    for (const d of allDeltas) {
      if (d.type === 'model_delta') {
        assert.ok(!d.delta.startsWith('🔥'), 'Leading lifted reaction emoji must not leak into model_delta');
      }
    }
  }

  // Scenario 19: Layer 2 post-turn structured reaction decision reacts to user messages cleanly even without inline [[REACT]] tags, including in Debate mode
  {
    const uid = 'test_scenario_19_layer2_reaction_eval';
    clearProviderHealth(uid, 'google');
    clearProviderHealth(uid, 'openai');

    const mGoogle = makeModel('google', 'gemini-2.5-flash');
    const mOpenAI = makeModel('openai', 'gpt-4o-mini');
    const states = makeProviderStates();

    const events: CouncilSSEEvent[] = [];
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_layer2_reactions',
      mode: 'debate',
      intelligenceLevel: 'medium',
      enableFallback: false,
      selectedModels: [mGoogle.compositeId, mOpenAI.compositeId],
      moderatorModel: mGoogle.compositeId,
      maxRounds: 1,
      startRound: 1,
      priorMessages: [],
      userPrompt: 'We cut p99 latency from 420ms to 38ms!',
      userMessageId: 'user_msg_19',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: [mGoogle, mOpenAI],
          discoveryErrors: {},
          warnings: [],
          providerStates: states,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [mGoogle, mOpenAI],
          rejectedModels: [],
          providerStates: states,
          warnings: [],
        }),
        invokeStream: async ({ systemInstruction, onDelta }) => {
          if (systemInstruction.includes('Council Moderator')) {
            onDelta('1. Executive summary\nVerified win.');
            return {
              content: '1. Executive summary\nVerified win.',
              inputTokens: 12,
              outputTokens: 6,
              latencyMs: 15,
              estimatedCostUsd: 0,
              pricingKnown: true,
              stopped: false,
            };
          }
          onDelta('Glad to hear that!');
          return {
            content: 'Glad to hear that!',
            inputTokens: 12,
            outputTokens: 6,
            latencyMs: 15,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
        evaluateReaction: async ({ provider, availableHandles }) => {
          assert.ok(availableHandles.includes('m1'), 'User message handle m1 must be available in debate Round 1');
          if (provider === 'google') {
            return { targetHandle: 'm1', emoji: '🎉' };
          }
          // Transient reaction-eval error on second provider must NOT emit model_error or fail the council run
          throw Object.assign(new Error('Rate limited'), { status: 429 });
        },
      },
    });

    const reactionEvs = events.filter((e) => e.type === 'message_reaction');
    assert.equal(reactionEvs.length, 1);
    if (reactionEvs[0].type === 'message_reaction') {
      assert.equal(reactionEvs[0].targetMessageId, 'user_msg_19');
      assert.equal(reactionEvs[0].reaction.emoji, '🎉');
      assert.equal(reactionEvs[0].reaction.reactorId, mGoogle.compositeId);
    }

    const modelDoneEvs = events.filter((e) => e.type === 'model_done' && e.role === 'model');
    assert.equal(modelDoneEvs.length, 6);
    if (modelDoneEvs[0].type === 'model_done') {
      assert.equal(modelDoneEvs[0].content, 'Glad to hear that!');
    }
    assert.equal(events.filter((e) => e.type === 'model_error').length, 0);

    const councilDone = events.find((e) => e.type === 'council_done');
    assert.ok(councilDone && councilDone.type === 'council_done' && councilDone.status === 'completed');
  }

  // Scenario 20: Groq fixes (discovery filtering, context_window extraction, 413 TPM classification & compaction retry, 60s rate_limit TTL)
  {
    const discoveredGroq = await discoverOpenAIModels('gsk_test', {
      providerId: 'groq',
      rawModelsList: [
        { id: 'llama-3.1-8b-instant', active: false, context_window: 131072 },
        { id: 'groq/compound', active: true, context_window: 131072 },
        { id: 'groq/compound-mini', active: true, context_window: 131072 },
        { id: 'allam-2-7b', active: true, context_window: 4096 },
        { id: 'qwen/qwen3-32b', active: true, context_window: 131072 },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', context_window: 131072 },
      ],
    });
    assert.deepEqual(
      discoveredGroq.map((m) => m.modelId),
      ['meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b'],
      'Inactive, compound, and allam models must be excluded while active/unspecified chat models remain',
    );
    assert.equal(discoveredGroq[0].contextWindowTokens, 131072);
    assert.equal(discoveredGroq[1].contextWindowTokens, 131072);

    assert.equal(inferModelTier('openai/gpt-oss-20b'), 'low');
    assert.equal(inferModelTier('qwen/qwen3-32b'), 'medium');
    assert.equal(inferModelTier('meta-llama/llama-4-scout-17b-16e-instruct'), 'medium');

    const tpm413 = classifyProviderError(
      {
        status: 413,
        error: {
          code: 'rate_limit_exceeded',
          message:
            'Request too large for model llama-3.3-70b-versatile on tokens per minute (TPM): Limit 12000, Requested 15000.',
        },
      },
      'groq',
    );
    assert.equal(tpm413.category, 'rate_limited');
    assert.equal(tpm413.retryable, true);
    assert.equal(tpm413.providerLevelBlock, false);
    assert.equal(tpm413.summary, 'Free limit reached, retry shortly.');

    const uidTtl = 'test_scenario_20_groq_rate_limit_ttl';
    clearProviderHealth(uidTtl, 'groq');
    const baseMs = 5_000_000;
    recordModelUnavailable(uidTtl, 'groq:llama-3.3-70b-versatile', 'TPM limit', 'rate_limited', baseMs);
    recordModelUnavailable(uidTtl, 'groq:broken-id', 'Not found', 'invalid_model', baseMs);
    assert.ok(getModelUnavailableReason(uidTtl, 'groq:llama-3.3-70b-versatile', baseMs + 30_000) !== null);
    assert.equal(
      getModelUnavailableReason(uidTtl, 'groq:llama-3.3-70b-versatile', baseMs + RATE_LIMIT_TTL_MS + 1),
      null,
      'rate_limited model entry must expire after 60s instead of 5 minutes',
    );
    assert.ok(
      getModelUnavailableReason(uidTtl, 'groq:broken-id', baseMs + RATE_LIMIT_TTL_MS + 1) !== null,
      'invalid_model must remain blocked for 5 minutes',
    );

    const uidRun = 'test_scenario_20_groq_413_compaction';
    clearProviderHealth(uidRun, 'groq');
    const mGroq = makeModel('groq', 'llama-3.3-70b-versatile');
    const groqStates = makeProviderStates({
      google: { connected: false, healthState: 'disconnected', message: null, discoveredCount: 0, inferenceReadyCount: 0 },
      openai: { connected: false, healthState: 'disconnected', message: null, discoveredCount: 0, inferenceReadyCount: 0 },
      anthropic: { connected: false, healthState: 'disconnected', message: null, discoveredCount: 0, inferenceReadyCount: 0 },
      groq: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 1, inferenceReadyCount: 1 },
    });

    const longHistory = Array.from({ length: 6 }, (_, i) => ({
      id: `hist_${i}`,
      role: (i % 2 === 0 ? 'user' : 'model') as 'user' | 'model',
      provider: (i % 2 === 0 ? 'user' : 'groq') as 'user' | 'groq',
      modelId: i % 2 === 0 ? 'user' : 'llama-3.3-70b-versatile',
      modelLabel: i % 2 === 0 ? 'User' : 'Groq (llama-3.3-70b-versatile)',
      round: 0,
      stageLabel: 'Group Chat',
      status: 'completed' as const,
      content: `Turn ${i}: ` + 'x'.repeat(1600),
    }));

    const seenPrompts: string[] = [];
    const events: CouncilSSEEvent[] = [];
    await runCouncilEngine({
      uid: uidRun,
      idToken: 'tok',
      councilId: 'c_groq_413',
      mode: 'chat',
      intelligenceLevel: 'medium',
      enableFallback: false,
      selectedModels: [mGroq.compositeId],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: longHistory,
      userPrompt: 'Summarize the key decision in two sentences.',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async (_u, _t, pid) => (pid === 'groq' ? 'gsk_test' : null),
        getCatalog: async () => ({
          models: [mGroq],
          discoveryErrors: {},
          warnings: [],
          providerStates: groqStates,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [mGroq],
          rejectedModels: [],
          providerStates: groqStates,
          warnings: [],
        }),
        invokeStream: async ({ prompt, onDelta }) => {
          seenPrompts.push(prompt);
          if (seenPrompts.length === 1) {
            throw Object.assign(
              new Error('Request too large for model llama-3.3-70b-versatile on tokens per minute (TPM)'),
              { status: 413 },
            );
          }
          onDelta('Compacted retry succeeded cleanly.');
          return {
            content: 'Compacted retry succeeded cleanly.',
            inputTokens: 120,
            outputTokens: 8,
            latencyMs: 30,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    assert.equal(seenPrompts.length, 2);
    assert.ok(seenPrompts[0].length <= 11_000, `Free provider initial context must be capped (got ${seenPrompts[0].length})`);
    assert.ok(
      seenPrompts[1].includes('[earlier chat history compacted to fit TPM budget]'),
      'Second attempt after 413 must compact activePrompt',
    );
    assert.equal(events.filter((e) => e.type === 'model_error').length, 0);
    const done20 = events.find((e) => e.type === 'model_done');
    assert.ok(done20 && done20.type === 'model_done' && done20.content === 'Compacted retry succeeded cleanly.');
  }

  // Scenario 21: Reply-to-Message speaker priority ordering & quoted context injection
  {
    const uid = 'test_scenario_21_reply_to_message';
    clearProviderHealth(uid, 'google');
    clearProviderHealth(uid, 'groq');
    clearProviderHealth(uid, 'openai');

    const mGoogle = makeModel('google', 'gemini-2.5-flash');
    const mGroq = makeModel('groq', 'llama-3.3-70b-versatile');
    const mOpenAI = makeModel('openai', 'gpt-4o-mini');
    const states = makeProviderStates({
      groq: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 1, inferenceReadyCount: 1 },
    });

    // 21a: In chat mode with [google, groq, openai], replying to Groq puts Groq FIRST, then google, openai
    const chatEvents: CouncilSSEEvent[] = [];
    const seenSysByProvider = new Map<string, string>();
    const seenPromptByProvider = new Map<string, string>();
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_reply_chat',
      mode: 'chat',
      intelligenceLevel: 'medium',
      enableFallback: false,
      selectedModels: [mGoogle.compositeId, mGroq.compositeId, mOpenAI.compositeId],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [
        {
          id: 'm_groq_1',
          role: 'model',
          provider: 'groq',
          modelId: 'llama-3.3-70b-versatile',
          modelLabel: 'Groq (llama-3.3-70b-versatile)',
          round: 0,
          stageLabel: 'Group Chat',
          status: 'completed',
          content: 'Check the retry backoff cap before shipping.',
        },
      ],
      userPrompt: 'Good point—should we cap it at 10 seconds?',
      userMessageId: 'u_reply_1',
      replyTo: {
        messageId: 'm_groq_1',
        role: 'model',
        provider: 'groq',
        modelId: 'llama-3.3-70b-versatile',
        modelLabel: 'Groq (llama-3.3-70b-versatile)',
        snippet: 'Check the retry backoff cap before shipping.',
      },
      emit: (e) => chatEvents.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: [mGoogle, mGroq, mOpenAI],
          discoveryErrors: {},
          warnings: [],
          providerStates: states,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [mGoogle, mGroq, mOpenAI],
          rejectedModels: [],
          providerStates: states,
          warnings: [],
        }),
        invokeStream: async ({ provider, systemInstruction, prompt, onDelta }) => {
          seenSysByProvider.set(provider, systemInstruction);
          seenPromptByProvider.set(provider, prompt);
          const reply = `Reply from ${provider}`;
          onDelta(reply);
          return {
            content: reply,
            inputTokens: 20,
            outputTokens: 6,
            latencyMs: 15,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    const startOrder = chatEvents
      .filter((e): e is Extract<CouncilSSEEvent, { type: 'model_start' }> => e.type === 'model_start')
      .map((e) => e.provider);
    assert.deepEqual(
      startOrder,
      ['groq', 'google', 'openai'],
      'Replied-to AI model (groq) must speak FIRST, followed by remaining peers in roster order',
    );
    assert.ok(
      seenSysByProvider.get('groq')?.includes('replied directly to YOUR earlier message'),
      'Target model system instruction must highlight direct reply',
    );
    assert.ok(
      seenSysByProvider.get('groq')?.includes('Check the retry backoff cap before shipping.'),
      'Target model system instruction must include quoted snippet',
    );
    assert.ok(
      seenPromptByProvider.get('groq')?.includes('↳ Replying to'),
      'Transcript prompt must include quoted reply context line',
    );
    assert.ok(
      seenSysByProvider.get('google')?.includes('spoke first'),
      'Peer model system instruction must note the target model spoke first',
    );
    assert.ok(
      seenPromptByProvider.get('google')?.includes('Reply from groq'),
      'Subsequent peer must see the replied-to model response in context',
    );

    // 21b: In multi-round free mode, replyTo prioritizes Round 1 only; Round 2 resumes base roster order
    const freeEvents: CouncilSSEEvent[] = [];
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_reply_free',
      mode: 'free',
      intelligenceLevel: 'medium',
      enableFallback: false,
      selectedModels: [mGoogle.compositeId, mGroq.compositeId, mOpenAI.compositeId],
      moderatorModel: 'none',
      maxRounds: 2,
      startRound: 1,
      priorMessages: [],
      userPrompt: 'OpenAI, clarify your stance on batching.',
      replyTo: {
        messageId: 'm_openai_prev',
        role: 'model',
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        modelLabel: 'OpenAI (gpt-4o-mini)',
        snippet: 'Batching cuts overhead.',
      },
      emit: (e) => freeEvents.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: [mGoogle, mGroq, mOpenAI],
          discoveryErrors: {},
          warnings: [],
          providerStates: states,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [mGoogle, mGroq, mOpenAI],
          rejectedModels: [],
          providerStates: states,
          warnings: [],
        }),
        invokeStream: async ({ provider, onDelta }) => {
          onDelta(`Turn from ${provider}`);
          return {
            content: `Turn from ${provider}`,
            inputTokens: 15,
            outputTokens: 5,
            latencyMs: 10,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    const round1Starts = freeEvents
      .filter(
        (e): e is Extract<CouncilSSEEvent, { type: 'model_start' }> =>
          e.type === 'model_start' && e.role === 'model' && e.round === 1,
      )
      .map((e) => e.provider);
    const round2Starts = freeEvents
      .filter(
        (e): e is Extract<CouncilSSEEvent, { type: 'model_start' }> =>
          e.type === 'model_start' && e.role === 'model' && e.round === 2,
      )
      .map((e) => e.provider);
    assert.deepEqual(round1Starts, ['openai', 'google', 'groq']);
    assert.deepEqual(round2Starts, ['google', 'groq', 'openai']);

    // 21c: Replying to a user message preserves default roster order
    const userReplyEvents: CouncilSSEEvent[] = [];
    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_reply_user',
      mode: 'chat',
      intelligenceLevel: 'medium',
      enableFallback: false,
      selectedModels: [mGoogle.compositeId, mGroq.compositeId, mOpenAI.compositeId],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Follow up on my earlier note.',
      replyTo: {
        messageId: 'user_prev_1',
        role: 'user',
        provider: 'user',
        modelId: 'user',
        modelLabel: 'You',
        snippet: 'Earlier question about queue sizing.',
      },
      emit: (e) => userReplyEvents.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async () => 'test-key',
        getCatalog: async () => ({
          models: [mGoogle, mGroq, mOpenAI],
          discoveryErrors: {},
          warnings: [],
          providerStates: states,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [mGoogle, mGroq, mOpenAI],
          rejectedModels: [],
          providerStates: states,
          warnings: [],
        }),
        invokeStream: async ({ provider, onDelta }) => {
          onDelta(`Reply from ${provider}`);
          return {
            content: `Reply from ${provider}`,
            inputTokens: 15,
            outputTokens: 5,
            latencyMs: 10,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });
    const userReplyOrder = userReplyEvents
      .filter((e): e is Extract<CouncilSSEEvent, { type: 'model_start' }> => e.type === 'model_start')
      .map((e) => e.provider);
    assert.deepEqual(userReplyOrder, ['google', 'groq', 'openai']);
  }

  // Scenario 22: OpenRouter reliability, free-tier (no-subscription) classification & smartSelectModels improvements
  {
    // 22a: Free-tier classification across all providers
    assert.equal(isModelFreeTier(makeModel('openrouter', 'deepseek/deepseek-r1:free')), true);
    assert.equal(isModelFreeTier(makeModel('openrouter', 'openrouter/free')), true);
    assert.equal(isModelFreeTier(makeModel('openrouter', 'openai/gpt-4o')), false);
    assert.equal(isModelFreeTier(makeModel('groq', 'llama-3.3-70b-versatile')), true);
    assert.equal(isModelFreeTier(makeModel('cerebras', 'llama-3.3-70b')), true);
    assert.equal(isModelFreeTier(makeModel('mistral', 'mistral-small-latest')), true);
    assert.equal(isModelFreeTier(makeModel('google', 'gemini-2.5-flash')), true);
    assert.equal(isModelFreeTier(makeModel('google', 'gemma-3-27b-it')), true);
    assert.equal(isModelFreeTier(makeModel('google', 'gemini-2.5-pro')), false);
    assert.equal(isModelFreeTier(makeModel('openai', 'gpt-4o')), false);
    assert.equal(isModelFreeTier(makeModel('anthropic', 'claude-sonnet-4-5')), false);

    // 22b: OpenRouter discovery captures :free, openrouter/free alias, and explicit zero-price models while excluding non-text & paid models
    const orDiscovered = await discoverOpenAIModels('sk-or-v1-test', {
      providerId: 'openrouter',
      rawModelsList: [
        { id: 'openrouter/free', pricing: { prompt: '0', completion: '0' }, context_length: 128000 },
        { id: 'arcee-ai/trinity-large-preview:free', context_length: 131072 },
        { id: 'canada/chat-model:free', context_length: 32768 },
        { id: 'image-only/flux:free', architecture: { output_modalities: ['image'] } },
        { id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } },
      ],
    });
    assert.deepEqual(
      orDiscovered.map((m) => m.modelId),
      ['arcee-ai/trinity-large-preview:free', 'canada/chat-model:free', 'openrouter/free'],
    );
    assert.ok(orDiscovered.every((m) => m.isFreeTier === true));

    // 22c: smartSelectModels guarantees OpenRouter is probed & selected even when earlier providers fail >8 unverified probes or are already inference_ready
    const uid = 'test_scenario_22_openrouter_smart_select';
    for (const pid of PROVIDER_IDS) {
      clearProviderHealth(uid, pid);
    }

    const googleFlash = makeModel('google', 'gemini-2.5-flash', { availabilityState: 'inference_ready' });
    const googlePro = makeModel('google', 'gemini-2.5-pro', { availabilityState: 'inference_ready' });
    const openaiPaid = makeModel('openai', 'gpt-4o', { availabilityState: 'inference_ready' });
    const groqBroken1 = makeModel('groq', 'broken-groq-1', { availabilityState: 'verified' });
    const groqBroken2 = makeModel('groq', 'broken-groq-2', { availabilityState: 'verified' });
    const groqBroken3 = makeModel('groq', 'broken-groq-3', { availabilityState: 'verified' });
    const groqGood = makeModel('groq', 'llama-3.3-70b-versatile', { availabilityState: 'inference_ready' });
    const cerebrasGood = makeModel('cerebras', 'llama-3.3-70b', { availabilityState: 'verified' });
    const openrouterBad1 = makeModel('openrouter', 'tiny/model-1b:free', { availabilityState: 'verified' });
    const openrouterGood = makeModel('openrouter', 'deepseek/deepseek-chat-v3:free', { availabilityState: 'verified' });

    const preflightReport: PreflightReport = {
      ok: true,
      checkedAt: new Date().toISOString(),
      readyModels: [
        googlePro,
        openaiPaid,
        googleFlash,
        groqBroken1,
        groqBroken2,
        groqBroken3,
        groqGood,
        cerebrasGood,
        openrouterBad1,
        openrouterGood,
      ],
      rejectedModels: [],
      providerStates: makeProviderStates({
        groq: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 4, inferenceReadyCount: 1 },
        openrouter: { connected: true, healthState: 'verified', message: null, discoveredCount: 2, inferenceReadyCount: 0 },
        cerebras: { connected: true, healthState: 'verified', message: null, discoveredCount: 1, inferenceReadyCount: 0 },
      }),
      warnings: [],
    };

    const probedModels: string[] = [];
    const freeSmart = await smartSelectModels({
      uid,
      idToken: 'tok',
      prompt: 'Compare distributed KV stores for a Node.js backend',
      mode: 'chat',
      intelligenceLevel: 'medium',
      freeOnly: true,
      runPreflightFn: async () => preflightReport,
      resolveKeyFn: async () => 'test-key',
      probeModelFn: async (_u, pid, _k, modelId) => {
        const cid = `${pid}:${modelId}`;
        probedModels.push(cid);
        if (modelId.startsWith('broken-groq') || modelId === 'tiny/model-1b:free') {
          return { ok: false, availabilityState: 'unavailable', reason: 'Simulated failure' };
        }
        return { ok: true, availabilityState: 'inference_ready' };
      },
    });

    assert.equal(freeSmart.freeOnly, true);
    assert.ok(
      !freeSmart.selectedModels.includes('openai:gpt-4o'),
      'freeOnly must exclude paid OpenAI models',
    );
    assert.ok(
      !freeSmart.selectedModels.includes('google:gemini-2.5-pro'),
      'freeOnly must exclude paid Gemini Pro models',
    );
    assert.ok(
      freeSmart.selectedModels.includes('openrouter:deepseek/deepseek-chat-v3:free'),
      `OpenRouter :free must be selected across 4 connected free providers (got ${freeSmart.selectedModels.join(', ')})`,
    );
    assert.ok(
      freeSmart.selectedModels.includes('cerebras:llama-3.3-70b'),
      'Cerebras must also be represented',
    );
    assert.ok(
      freeSmart.selectedModels.includes('google:gemini-2.5-flash'),
      'Google Flash free-tier must be represented',
    );
    assert.ok(
      freeSmart.selectedModels.includes('groq:llama-3.3-70b-versatile'),
      'Groq must be represented',
    );
    assert.ok(probedModels.includes('openrouter:deepseek/deepseek-chat-v3:free'));
  }

  // Scenario 23: Default intelligenceLevel = 'low' & Premium priority cycling (Gemini -> Groq -> OpenRouter -> Cohere)
  {
    const uid = 'test_scenario_23_premium_priority_cycling';
    for (const pid of PROVIDER_IDS) {
      clearProviderHealth(uid, pid);
    }

    const pool: ModelInfo[] = [
      makeModel('google', 'gemini-2.5-flash-lite', { availabilityState: 'inference_ready' }),
      makeModel('google', 'gemini-2.5-flash', { availabilityState: 'inference_ready' }),
      makeModel('groq', 'llama-3.1-8b-instant', { availabilityState: 'inference_ready' }),
      makeModel('groq', 'llama-3.3-70b-versatile', { availabilityState: 'inference_ready' }),
      makeModel('openrouter', 'meta-llama/llama-3.2-3b-instruct:free', { availabilityState: 'inference_ready' }),
      makeModel('openrouter', 'deepseek/deepseek-chat-v3:free', { availabilityState: 'inference_ready' }),
      makeModel('cohere', 'command-r7b-12-2024', { availabilityState: 'inference_ready' }),
      makeModel('cohere', 'command-a-03-2025', { availabilityState: 'inference_ready' }),
    ];

    const preflightReport: PreflightReport = {
      ok: true,
      checkedAt: new Date().toISOString(),
      readyModels: pool,
      rejectedModels: [],
      providerStates: makeProviderStates({
        groq: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 2, inferenceReadyCount: 2 },
        openrouter: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 2, inferenceReadyCount: 2 },
        cohere: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 2, inferenceReadyCount: 2 },
      }),
      warnings: [],
    };

    const sixSeatSelection = await smartSelectModels({
      uid,
      idToken: 'tok',
      prompt: 'Quick brainstorming session',
      mode: 'chat',
      priorityOrder: ['google', 'groq', 'openrouter', 'cohere'],
      seatCount: 6,
      isPremium: true,
      runPreflightFn: async () => preflightReport,
    });

    assert.equal(sixSeatSelection.intelligenceLevel, 'low', 'Default intelligenceLevel must be low');
    assert.equal(sixSeatSelection.selectedModels.length, 6);
    assert.deepEqual(
      sixSeatSelection.selectedModels.map((cid) => cid.split(':')[0]),
      ['google', 'groq', 'openrouter', 'cohere', 'google', 'groq'],
      'Priority order must cycle Gemini -> Groq -> OpenRouter -> Cohere when seats > 4',
    );
    assert.equal(
      new Set(sixSeatSelection.selectedModels).size,
      6,
      'Each of the 6 cycled seats must pick a distinct model',
    );
  }

  // Scenario 24: T.U.T. Wallet env secrets, HTTP->HTTPS .run.app upgrade, SSRF guard & Admin redaction
  {
    const envKeys = [
      'TUT_FIREBASE_PROJECT_ID',
      'TUT_FIREBASE_DATABASE_ID',
      'TUT_FIREBASE_API_KEY',
      'TUT_FIREBASE_AUTH_DOMAIN',
      'TUT_FIREBASE_APP_ID',
      'TUT_FIREBASE_STORAGE_BUCKET',
      'TUT_FIREBASE_MESSAGING_SENDER_ID',
      'TUT_PAYMENT_CHECKOUT_URL',
      'TUT_VERIFY_RECEIPT_URL',
    ] as const;
    const savedEnv: Record<string, string | undefined> = {};
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
    }

    try {
      process.env.TUT_FIREBASE_PROJECT_ID = 'demo-wallet-project';
      process.env.TUT_FIREBASE_DATABASE_ID = 'demo-wallet-db';
      process.env.TUT_FIREBASE_API_KEY = 'AIzaSyFakeUnitTestPlaceholderKey000001';
      process.env.TUT_FIREBASE_AUTH_DOMAIN = 'demo-wallet-project.firebaseapp.com';
      process.env.TUT_FIREBASE_APP_ID = '1:100000000000:web:abc123def456';
      process.env.TUT_FIREBASE_STORAGE_BUCKET = 'demo-wallet-project.firebasestorage.app';
      process.env.TUT_FIREBASE_MESSAGING_SENDER_ID = '100000000000';
      process.env.TUT_PAYMENT_CHECKOUT_URL = 'http://demo-gateway.asia-southeast1.run.app/pay';
      process.env.TUT_VERIFY_RECEIPT_URL =
        'http://demo-gateway.asia-southeast1.run.app/api/gateway/verify-receipt';

      const full = getMlaConfig();
      assert.equal(full.projectId, 'demo-wallet-project');
      assert.equal(full.firestoreDatabaseId, 'demo-wallet-db');
      assert.equal(
        full.checkoutUrl,
        'https://demo-gateway.asia-southeast1.run.app/pay',
        'http://*.run.app checkout URL must normalize to https:// and preserve /pay path',
      );
      assert.equal(
        full.verifyReceiptUrl,
        'https://demo-gateway.asia-southeast1.run.app/api/gateway/verify-receipt',
        'http://*.run.app verify URL must normalize to https://',
      );

      const redacted = getSafeMlaConfigForAdmin();
      assert.equal(redacted.apiKey, '', 'Admin config response must never echo raw apiKey');
      assert.equal(redacted.hasApiKey, true);
      assert.ok(
        redacted.apiKeyPreview &&
          redacted.apiKeyPreview.includes('••••') &&
          !redacted.apiKeyPreview.includes(process.env.TUT_FIREBASE_API_KEY!),
        'apiKeyPreview must mask the middle of the key',
      );

      const pub = getPublicWalletClientConfig();
      assert.equal(pub.mlaConfigured, true);
      assert.equal(pub.checkoutUrl, 'https://demo-gateway.asia-southeast1.run.app/pay');
      assert.equal(
        pub.verifyReceiptUrl,
        'https://demo-gateway.asia-southeast1.run.app/api/gateway/verify-receipt',
      );
      assert.ok(pub.walletFirebaseConfig);
      assert.equal(pub.walletFirebaseConfig.projectId, 'demo-wallet-project');
      assert.equal(pub.walletFirebaseConfig.appId, '1:100000000000:web:abc123def456');

      const builtCheckout = new URL(pub.checkoutUrl);
      builtCheckout.searchParams.set('tut_pay', '1');
      builtCheckout.searchParams.set('amount', '49');
      builtCheckout.searchParams.set('merchant', 'T.U.T AI Council');
      builtCheckout.searchParams.set('orderId', 'ORD-TEST-01');
      builtCheckout.searchParams.set('returnUrl', 'https://council.example.com/');
      assert.equal(builtCheckout.protocol, 'https:');
      assert.equal(builtCheckout.pathname, '/pay');
      assert.equal(builtCheckout.searchParams.get('tut_pay'), '1');
      assert.equal(builtCheckout.searchParams.get('amount'), '49');
      assert.equal(builtCheckout.searchParams.get('orderId'), 'ORD-TEST-01');

      assert.throws(
        () => saveMlaConfig({ checkoutUrl: 'http://127.0.0.1:8080/pay' }),
        /Private or loopback hostnames are not permitted/,
      );
    } finally {
      for (const k of envKeys) {
        if (savedEnv[k] === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = savedEnv[k];
        }
      }
    }
  }

  // Scenario 25: ChatGPT -> Gemini Flash Lite alias execution, multi-seat cycling, and shared-API model privacy redaction
  {
    const uid = 'test_scenario_25_chatgpt_alias_and_privacy';
    clearProviderHealth(uid, 'google');
    clearProviderHealth(uid, 'openai');

    assert.equal(
      pickBestGeminiFlashLiteModelId([
        { modelId: 'gemini-2.5-pro' },
        { modelId: 'gemini-2.5-flash-lite' },
        { modelId: 'gemini-3.5-flash-lite' },
      ]),
      'gemini-3.5-flash-lite',
    );
    assert.equal(
      pickBestGeminiFlashLiteModelId([
        { modelId: 'gemini-2.5-flash' },
        { modelId: 'gemini-2.5-flash-lite' },
      ]),
      'gemini-2.5-flash-lite',
    );

    const pool: ModelInfo[] = [
      buildChatGptAliasModelInfo(1),
      makeModel('google', 'gemini-3.5-flash-lite', { availabilityState: 'inference_ready' }),
      makeModel('google', 'gemini-2.5-flash', { availabilityState: 'inference_ready' }),
    ];
    const states = makeProviderStates({
      openai: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 1, inferenceReadyCount: 1 },
      google: { connected: true, healthState: 'inference_ready', message: null, discoveredCount: 2, inferenceReadyCount: 2 },
      anthropic: { connected: false, healthState: 'disconnected', message: null, discoveredCount: 0, inferenceReadyCount: 0 },
    });

    const smartMasked = await smartSelectModels({
      uid,
      idToken: 'tok',
      prompt: 'Compare vector indexing options',
      mode: 'free',
      intelligenceLevel: 'low',
      preferredProviders: ['openai', 'google'],
      seatCount: 4,
      isPremium: true,
      maskAdminSharedModels: true,
      runPreflightFn: async () => ({
        ok: true,
        checkedAt: new Date().toISOString(),
        readyModels: pool,
        rejectedModels: [],
        providerStates: states,
        warnings: [],
      }),
    });

    assert.equal(smartMasked.selectedModels.length, 4);
    assert.deepEqual(smartMasked.selectedModels, [
      'openai:chatgpt-1',
      'google:managed-2',
      'openai:chatgpt-3',
      'google:managed-4',
    ]);
    assert.ok(!smartMasked.rationale.includes('gemini-3.5-flash-lite'), 'Rationale must not leak raw Admin model ID');
    assert.ok(!smartMasked.rationale.includes('gemini-2.5-flash'), 'Rationale must not leak raw Admin model ID');

    const seenCalls: Array<{ provider: ProviderId; modelId: string }> = [];
    const events: CouncilSSEEvent[] = [];

    await runCouncilEngine({
      uid,
      idToken: 'tok',
      councilId: 'c_chatgpt_alias',
      mode: 'chat',
      intelligenceLevel: 'low',
      isPremium: true,
      maskModelDetails: true,
      enableFallback: false,
      selectedModels: ['openai:chatgpt-1', 'google:managed-2'],
      moderatorModel: 'none',
      maxRounds: 1,
      startRound: 0,
      priorMessages: [],
      userPrompt: 'Say hello to the council.',
      emit: (e) => events.push(e),
      deps: {
        retryDelayMs: 1,
        turnDelayMs: 1,
        resolveKey: async (_u, _t, pid) => (pid === 'google' ? 'admin-google-key' : null),
        getCatalog: async () => ({
          models: pool,
          discoveryErrors: {},
          warnings: [],
          providerStates: states,
        }),
        runPreflight: async () => ({
          ok: true,
          checkedAt: new Date().toISOString(),
          readyModels: [
            buildChatGptAliasModelInfo(1),
            { ...makeModel('google', 'managed-2'), compositeId: 'google:managed-2' },
          ],
          rejectedModels: [],
          providerStates: states,
          warnings: [],
        }),
        invokeStream: async ({ provider, modelId, onDelta }) => {
          seenCalls.push({ provider, modelId });
          onDelta('Hello from council seat!');
          return {
            content: 'Hello from council seat!',
            inputTokens: 15,
            outputTokens: 6,
            latencyMs: 20,
            estimatedCostUsd: 0,
            pricingKnown: true,
            stopped: false,
          };
        },
      },
    });

    assert.equal(seenCalls.length, 2);
    assert.equal(seenCalls[0].provider, 'google', 'ChatGPT alias seat must execute via Google Gemini');
    assert.equal(seenCalls[0].modelId, 'gemini-3.5-flash-lite');
    assert.equal(seenCalls[1].provider, 'google');

    const doneEvents = events.filter(
      (e): e is Extract<CouncilSSEEvent, { type: 'model_done' }> => e.type === 'model_done',
    );
    assert.equal(doneEvents.length, 2);
    assert.equal(doneEvents[0].provider, 'openai');
    assert.equal(doneEvents[0].modelLabel, 'ChatGPT');
    assert.equal(doneEvents[0].modelId, 'chatgpt-1');
    assert.equal(doneEvents[1].provider, 'google');
    assert.equal(doneEvents[1].modelLabel, 'Google Gemini');
    assert.equal(doneEvents[1].modelId, 'managed-2');
    for (const ev of doneEvents) {
      assert.ok(!ev.modelId.includes('gemini-'), 'SSE event must never leak underlying Admin model ID');
      assert.ok(!ev.modelLabel.includes('gemini-'), 'SSE label must never leak underlying Admin model ID');
    }
  }

  console.log('All 25 Provider Availability, Groq, Reply, Reactions, Premium Priority, T.U.T. Wallet & ChatGPT Alias scenarios passed.');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
