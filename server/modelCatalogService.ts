import {
  createEmptyProviderStateMap,
  getProviderConfig,
  inferModelFreeTier,
  isFreeRateLimitedProvider,
  PROVIDER_IDS,
} from '../src/shared/providers.ts';
import type {
  ErrorCategory,
  IntelligenceLevel,
  ModelAvailabilityState,
  ModelInfo,
  ProviderHealthState,
  ProviderId,
} from '../src/shared/types.ts';
import {
  classifyProviderError,
  clearRateLimitedModelsForUser,
  formatClassifiedError,
  getDiscoveredCatalogCache,
  getModelUnavailableReason,
  getProviderHealth,
  getVerifiedModelsCount,
  isModelAccessVerified,
  recordModelAccessVerified,
  recordModelUnavailable,
  recordProviderHealth,
  setDiscoveredCatalogCache,
} from './modelHealth.ts';
import { buildChatGptAliasModelInfo } from './chatgptAlias.ts';
import { discoverAnthropicModels, probeAnthropicModel } from './providers/anthropic.ts';
import { discoverGeminiModels, probeGeminiModel } from './providers/gemini.ts';
import { discoverOpenAIModels, probeOpenAIModel } from './providers/openai.ts';
import { resolveRuntimeApiKey } from './vault.ts';

export function inferModelTier(modelId: string): IntelligenceLevel {
  const id = modelId.toLowerCase();
  const hasMiniToken = /(?:^|[-_.])mini(?:$|[-_.:])/.test(id);
  if (
    id.includes('flash-lite') ||
    id.includes('nano') ||
    id.includes('haiku') ||
    /(?:^|[-_/:])(1b|2b|3b|4b|7b|8b|9b|12b|14b|20b)(?:$|[-_/:b])/.test(id) ||
    (hasMiniToken && !id.startsWith('o1') && !id.startsWith('o3') && !id.startsWith('o4'))
  ) {
    return 'low';
  }
  if (
    (id.includes('flash') && !id.includes('lite')) ||
    id === 'gpt-4o' ||
    id.startsWith('o3-mini') ||
    id.startsWith('o4-mini') ||
    id.includes('mistral-small') ||
    id.includes('scout') ||
    id.includes('glm-4.5-air') ||
    /(?:^|[-_/:])(17b|24b|27b|30b|32b|70b)(?:$|[-_/:b])/.test(id)
  ) {
    return 'medium';
  }
  if (
    id.includes('opus') ||
    id.includes('ultra') ||
    id.includes('2.5-pro') ||
    (id.startsWith('o3') && !hasMiniToken) ||
    (id.startsWith('o1') && !hasMiniToken) ||
    (id.startsWith('o4') && !hasMiniToken) ||
    id.includes('gpt-5-pro') ||
    id.includes('deepseek-r1') ||
    /(?:^|[-_/:])(235b|405b|671b)(?:$|[-_/:b])/.test(id)
  ) {
    return 'extreme';
  }
  return 'high';
}

function mapErrorCategoryToModelState(cat: ErrorCategory): ModelAvailabilityState {
  if (cat === 'insufficient_credits') return 'insufficient_credits';
  if (cat === 'invalid_credentials') return 'invalid_credentials';
  if (cat === 'rate_limited') return 'rate_limited';
  return 'unavailable';
}

export async function probeSingleModel(
  uid: string,
  providerId: ProviderId,
  apiKey: string,
  modelId: string,
  options?: { openaiClient?: import('./providers/openai.ts').OpenAIProbeClient },
): Promise<{
  ok: boolean;
  availabilityState: ModelAvailabilityState;
  errorCategory?: ErrorCategory;
  reason?: string;
}> {
  const compositeId = `${providerId}:${modelId}`;
  const health = getProviderHealth(uid, providerId);

  if (health.state === 'insufficient_credits') {
    return {
      ok: false,
      availabilityState: 'insufficient_credits',
      errorCategory: 'insufficient_credits',
      reason: health.message || 'Provider credits exhausted.',
    };
  }
  if (health.state === 'invalid_credentials') {
    return {
      ok: false,
      availabilityState: 'invalid_credentials',
      errorCategory: 'invalid_credentials',
      reason: health.message || 'Provider credentials are invalid or unauthorized.',
    };
  }
  if (isModelAccessVerified(uid, compositeId)) {
    return { ok: true, availabilityState: 'inference_ready' };
  }

  const cfg = getProviderConfig(providerId);

  try {
    if (cfg.kind === 'google') {
      await probeGeminiModel(apiKey, modelId);
    } else if (cfg.kind === 'anthropic') {
      await probeAnthropicModel(apiKey, modelId);
    } else {
      await probeOpenAIModel(apiKey, modelId, {
        baseURL: cfg.baseURL,
        providerId,
        client: options?.openaiClient,
      });
    }
    recordModelAccessVerified(uid, providerId, compositeId);
    return { ok: true, availabilityState: 'inference_ready' };
  } catch (err) {
    const classified = classifyProviderError(err, providerId, apiKey);
    const reason = formatClassifiedError(classified);
    const isFreeProvider = isFreeRateLimitedProvider(providerId);

    // ONLY block the whole provider when clearly 401 or 402 (or explicit insufficient_quota code) on non-free providers
    if (classified.providerLevelBlock && !isFreeProvider) {
      if (classified.category === 'insufficient_credits') {
        recordProviderHealth(uid, providerId, 'insufficient_credits', reason, classified.category);
        return {
          ok: false,
          availabilityState: 'insufficient_credits',
          errorCategory: classified.category,
          reason,
        };
      }
      if (classified.category === 'invalid_credentials') {
        if (getVerifiedModelsCount(uid, providerId) > 0) {
          recordModelUnavailable(uid, compositeId, reason, 'invalid_model');
          return {
            ok: false,
            availabilityState: 'unavailable',
            errorCategory: 'invalid_model',
            reason,
          };
        }
        recordProviderHealth(uid, providerId, 'invalid_credentials', reason, classified.category);
        return {
          ok: false,
          availabilityState: 'invalid_credentials',
          errorCategory: classified.category,
          reason,
        };
      }
    }

    // For anything else (403, 404, 429 rate limits, 5xx, upstream, or any free-provider model failure),
    // only mark this single model unavailable and keep other models of this provider usable.
    recordModelUnavailable(uid, compositeId, reason, classified.category);
    return {
      ok: false,
      availabilityState: mapErrorCategoryToModelState(classified.category),
      errorCategory: classified.category,
      reason,
    };
  }
}

export async function getCatalogForUser(
  uid: string,
  idToken: string,
  options?: { forceRefresh?: boolean; isPremium?: boolean },
): Promise<{
  models: ModelInfo[];
  discoveryErrors: Record<string, string>;
  warnings: string[];
  providerStates: Record<
    ProviderId,
    {
      connected: boolean;
      healthState: ProviderHealthState;
      message: string | null;
      discoveredCount: number;
      inferenceReadyCount: number;
    }
  >;
}> {
  const results: ModelInfo[] = [];
  const discoveryErrors: Record<string, string> = {};
  const warnings: string[] = [];
  const providerStates = createEmptyProviderStateMap(() => ({
    connected: false,
    healthState: 'disconnected' as ProviderHealthState,
    message: null as string | null,
    discoveredCount: 0,
    inferenceReadyCount: 0,
  }));

  await Promise.all(
    PROVIDER_IDS.map(async (pid) => {
      const cfg = getProviderConfig(pid);
      try {
        const apiKey = await resolveRuntimeApiKey(uid, idToken, pid, {
          isPremium: options?.isPremium,
        });
        if (!apiKey) {
          providerStates[pid] = {
            connected: false,
            healthState: 'disconnected',
            message: 'Not connected. Add and verify an API key in Connections.',
            discoveredCount: 0,
            inferenceReadyCount: 0,
          };
          return;
        }

        if (options?.forceRefresh) {
          clearRateLimitedModelsForUser(uid, pid);
          const curHealth = getProviderHealth(uid, pid);
          if (curHealth.state === 'rate_limited' || curHealth.state === 'verified' || curHealth.state === 'connected') {
            recordProviderHealth(uid, pid, 'connected', null);
          }
        }

        let health = getProviderHealth(uid, pid);
        let cachedModels = options?.forceRefresh ? null : getDiscoveredCatalogCache(uid, pid);

        if (
          !options?.forceRefresh &&
          (health.state === 'insufficient_credits' || health.state === 'invalid_credentials')
        ) {
          const reason = health.message || `Provider ${cfg.name} is ${health.state}.`;
          warnings.push(`${cfg.name}: ${reason}`);
          providerStates[pid] = {
            connected: true,
            healthState: health.state,
            message: reason,
            discoveredCount: cachedModels?.length || 0,
            inferenceReadyCount: 0,
          };
          if (cachedModels) {
            for (const m of cachedModels) {
              const freeMeta = inferModelFreeTier(m.provider, m.modelId, {
                isZeroPricing:
                  Boolean(m.pricingVerified) &&
                  m.inputPricePer1MUsd === 0 &&
                  m.outputPricePer1MUsd === 0,
              });
              results.push({
                ...m,
                tier: inferModelTier(m.modelId),
                isFreeTier: m.isFreeTier ?? freeMeta.isFreeTier,
                freeTierNote: m.freeTierNote ?? freeMeta.freeTierNote,
                available: false,
                availabilityState: health.state as ModelAvailabilityState,
                unavailableReason: reason,
              });
            }
          }
          return;
        }

        // Discover strictly from live /models endpoint; NEVER auto-test models on load
        if (!cachedModels) {
          if (cfg.kind === 'google') {
            cachedModels = await discoverGeminiModels(apiKey);
          } else if (cfg.kind === 'anthropic') {
            cachedModels = await discoverAnthropicModels(apiKey);
          } else {
            cachedModels = await discoverOpenAIModels(apiKey, {
              providerId: pid,
              baseURL: cfg.baseURL,
              modelIdEndsWith: cfg.modelIdEndsWith,
            });
          }
          setDiscoveredCatalogCache(uid, pid, cachedModels);
          if (getVerifiedModelsCount(uid, pid) === 0) {
            recordProviderHealth(uid, pid, 'verified', null);
          }
          health = getProviderHealth(uid, pid);
        }

        if (cachedModels.length === 0) {
          const reason = cfg.modelIdEndsWith
            ? `Provider returned zero compatible models ending with "${cfg.modelIdEndsWith}" for this API key.`
            : 'Provider returned zero compatible text/reasoning models for this API key.';
          recordProviderHealth(uid, pid, 'unavailable', reason);
          discoveryErrors[pid] = reason;
          providerStates[pid] = {
            connected: true,
            healthState: 'unavailable',
            message: reason,
            discoveredCount: 0,
            inferenceReadyCount: 0,
          };
          return;
        }

        let inferenceReadyCount = 0;
        let usableCount = 0;
        for (const m of cachedModels) {
          const modelErr = getModelUnavailableReason(uid, m.compositeId);
          const isVerifiedAccess = isModelAccessVerified(uid, m.compositeId);

          let availabilityState: ModelAvailabilityState;
          let available = false;
          let unavailableReason: string | undefined;

          if (modelErr) {
            availabilityState = mapErrorCategoryToModelState(modelErr.errorCategory);
            available = false;
            unavailableReason = modelErr.reason;
          } else if (isVerifiedAccess) {
            availabilityState = 'inference_ready';
            available = true;
            inferenceReadyCount += 1;
            usableCount += 1;
          } else {
            // Live-discovered & unblocked; will be tested lazily on first use in chat
            availabilityState = 'verified';
            available = true;
            usableCount += 1;
          }

          const freeMeta = inferModelFreeTier(m.provider, m.modelId, {
            isZeroPricing:
              Boolean(m.pricingVerified) &&
              m.inputPricePer1MUsd === 0 &&
              m.outputPricePer1MUsd === 0,
          });
          results.push({
            ...m,
            tier: inferModelTier(m.modelId),
            isFreeTier: m.isFreeTier ?? freeMeta.isFreeTier,
            freeTierNote: m.freeTierNote ?? freeMeta.freeTierNote,
            available,
            availabilityState,
            unavailableReason,
          });
        }

        const effectiveHealth: ProviderHealthState =
          inferenceReadyCount > 0 ? 'inference_ready' : 'verified';
        recordProviderHealth(uid, pid, effectiveHealth, health.message);
        providerStates[pid] = {
          connected: true,
          healthState: effectiveHealth,
          message:
            usableCount === 0
              ? 'All discovered models encountered errors on recent chat usage.'
              : null,
          discoveredCount: cachedModels.length,
          inferenceReadyCount,
        };
      } catch (err) {
        const classified = classifyProviderError(err, pid, undefined);
        const formattedErr = formatClassifiedError(classified);
        const mappedState: ProviderHealthState =
          classified.category === 'insufficient_credits'
            ? 'insufficient_credits'
            : classified.category === 'invalid_credentials'
              ? 'invalid_credentials'
              : classified.category === 'rate_limited'
                ? 'rate_limited'
                : 'unavailable';
        if (classified.providerLevelBlock && !isFreeRateLimitedProvider(pid)) {
          recordProviderHealth(uid, pid, mappedState, formattedErr, classified.category);
        }
        discoveryErrors[pid] = formattedErr;
        warnings.push(`${cfg.name}: ${formattedErr}`);
        providerStates[pid] = {
          connected: true,
          healthState: mappedState,
          message: formattedErr,
          discoveredCount: 0,
          inferenceReadyCount: 0,
        };
      }
    }),
  );

  // ChatGPT Alias Cheat System: for Premium users without a direct OpenAI key,
  // expose ChatGPT backed transparently by Admin's Google Gemini Flash Lite pipeline.
  if (
    options?.isPremium &&
    !providerStates.openai.connected &&
    providerStates.google.connected &&
    providerStates.google.healthState !== 'invalid_credentials' &&
    providerStates.google.healthState !== 'insufficient_credits'
  ) {
    const aliasModel = buildChatGptAliasModelInfo(1);
    results.push(aliasModel);
    providerStates.openai = {
      connected: true,
      healthState: 'inference_ready',
      message: null,
      discoveredCount: 1,
      inferenceReadyCount: 1,
    };
  }

  return { models: results, discoveryErrors, warnings, providerStates };
}
