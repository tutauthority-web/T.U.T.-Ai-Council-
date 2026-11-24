import OpenAI from 'openai';
import { getProviderConfig, inferModelFreeTier } from '../../src/shared/providers.ts';
import type { ModelInfo, ProviderHealthState, ProviderId } from '../../src/shared/types.ts';
import { estimateModelCost, lookupVerifiedPricing } from '../catalog.ts';
import { redactSensitiveText } from '../crypto.ts';
import { classifyProviderError, formatClassifiedError } from '../modelHealth.ts';

export const PROBE_TIMEOUT_MS = 20_000;

export interface OpenAIProbeClient {
  chat: {
    completions: {
      create: (
        body: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) => Promise<{ choices?: unknown[] }>;
    };
  };
}

function isUnsupportedMaxCompletionTokensError(err: unknown): boolean {
  const anyErr = err as Record<string, any> | null | undefined;
  const code = String(anyErr?.code ?? anyErr?.error?.code ?? '').toLowerCase();
  const param = String(anyErr?.param ?? anyErr?.error?.param ?? '').toLowerCase();
  const msg = String(anyErr?.error?.message ?? anyErr?.message ?? err ?? '').toLowerCase();

  if (code === 'unsupported_parameter' && (param === 'max_completion_tokens' || msg.includes('max_completion_tokens'))) {
    return true;
  }
  return (
    msg.includes('max_completion_tokens') &&
    (msg.includes('unsupported') ||
      msg.includes('unknown parameter') ||
      msg.includes('unrecognized') ||
      msg.includes('invalid') ||
      msg.includes('not supported') ||
      msg.includes('extra fields') ||
      msg.includes('additional properties') ||
      msg.includes('unexpected') ||
      msg.includes('not permitted'))
  );
}

export async function probeOpenAIModel(
  apiKey: string,
  modelId: string,
  options?: {
    baseURL?: string;
    providerId?: ProviderId;
    client?: OpenAIProbeClient;
  },
): Promise<void> {
  const client: OpenAIProbeClient =
    options?.client ||
    (new OpenAI({
      apiKey,
      baseURL: options?.baseURL,
    }) as unknown as OpenAIProbeClient);

  const basePayload = {
    model: modelId,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
  };

  let resp: { choices?: unknown[] };
  try {
    resp = await client.chat.completions.create(
      {
        ...basePayload,
        max_completion_tokens: 128,
      },
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
    );
  } catch (err) {
    if (!isUnsupportedMaxCompletionTokensError(err)) {
      throw err;
    }
    resp = await client.chat.completions.create(
      {
        ...basePayload,
        max_tokens: 128,
      },
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
    );
  }

  if (!resp.choices || resp.choices.length === 0) {
    const pName = options?.providerId ? getProviderConfig(options.providerId).name : 'OpenAI';
    throw new Error(`${pName} model ${modelId} returned no choices during inference probe.`);
  }
}

export async function verifyOpenAIConnection(
  apiKey: string,
  options?: {
    providerId?: ProviderId;
    baseURL?: string;
    modelIdEndsWith?: string;
  },
): Promise<{
  valid: boolean;
  verifiedAuth: boolean;
  modelsCount: number;
  healthState: ProviderHealthState;
  probedModelIds: string[];
  error?: string;
}> {
  const providerId: ProviderId = options?.providerId || 'openai';
  const cfg = getProviderConfig(providerId);
  const baseURL = options?.baseURL ?? cfg.baseURL;
  const modelIdEndsWith = options?.modelIdEndsWith ?? cfg.modelIdEndsWith;

  try {
    // Authenticate and discover models from live GET {baseURL}/models without auto-testing all models on load
    const models = await discoverOpenAIModels(apiKey, {
      providerId,
      baseURL,
      modelIdEndsWith,
    });
    if (models.length === 0) {
      return {
        valid: false,
        verifiedAuth: true,
        modelsCount: 0,
        healthState: 'unavailable',
        probedModelIds: [],
        error: modelIdEndsWith
          ? `No compatible ${cfg.name} models ending with "${modelIdEndsWith}" were returned by /models.`
          : `No compatible ${cfg.name} chat or reasoning models were returned by /models.`,
      };
    }

    return {
      valid: true,
      verifiedAuth: true,
      modelsCount: models.length,
      healthState: 'verified',
      probedModelIds: [],
    };
  } catch (err) {
    const classified = classifyProviderError(err, providerId, apiKey);
    const fullError = formatClassifiedError(classified);
    return {
      valid: false,
      verifiedAuth: false,
      modelsCount: 0,
      healthState:
        classified.category === 'insufficient_credits'
          ? 'insufficient_credits'
          : classified.category === 'rate_limited'
            ? 'rate_limited'
            : classified.category === 'invalid_credentials'
              ? 'invalid_credentials'
              : 'unavailable',
      probedModelIds: [],
      error: fullError,
    };
  }
}

function isZeroPricingObject(pricing?: { prompt?: string | number; completion?: string | number }): boolean {
  if (!pricing) return false;
  const p = pricing.prompt !== undefined ? Number(pricing.prompt) : NaN;
  const c = pricing.completion !== undefined ? Number(pricing.completion) : NaN;
  return Number.isFinite(p) && Number.isFinite(c) && p === 0 && c === 0;
}

function isCompatibleChatModelId(
  id: string,
  providerId: ProviderId,
  modelIdEndsWith?: string,
  modelPricing?: { prompt?: string | number; completion?: string | number },
): boolean {
  if (!id) return false;
  if (modelIdEndsWith) {
    const matchesSuffix = id.endsWith(modelIdEndsWith);
    const isOpenRouterFreeAlias =
      providerId === 'openrouter' &&
      (id === 'openrouter/free' || (isZeroPricingObject(modelPricing) && !id.includes('openrouter/auto')));
    if (!matchesSuffix && !isOpenRouterFreeAlias) {
      return false;
    }
  }
  const lower = id.toLowerCase();
  if (
    lower.includes('whisper') ||
    lower.includes('transcribe') ||
    lower.includes('realtime') ||
    lower.includes('embedding') ||
    lower.includes('moderation') ||
    lower.includes('guard') ||
    lower.includes('safeguard') ||
    lower.includes('sora') ||
    lower.includes('dall-e') ||
    lower.includes('voxtral') ||
    lower.includes('deep-research') ||
    lower.includes('orpheus') ||
    lower.includes('kokoro') ||
    lower.includes('playai') ||
    lower.includes('rerank') ||
    lower.includes('classifier') ||
    lower.includes('compound') ||
    lower.includes('allam') ||
    /(?:^|[\/_.-])(tts|ocr|embed|audio|babbage|davinci|curie|ada)(?:$|[\/_.-])/.test(lower)
  ) {
    return false;
  }

  if (providerId === 'openai') {
    return (
      /^(gpt-4|gpt-5|o1|o3|o4|chatgpt-)/.test(id) &&
      !lower.includes('image') &&
      !lower.includes('search') &&
      !lower.includes('instruct') &&
      !lower.includes('codex')
    );
  }

  return true;
}

type RawDiscoveredModel = {
  id: string;
  active?: boolean;
  context_length?: number;
  max_context_length?: number;
  context_window?: number;
  name?: string;
  pricing?: { prompt?: string | number; completion?: string | number };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

export async function discoverOpenAIModels(
  apiKey: string,
  options?: {
    providerId?: ProviderId;
    baseURL?: string;
    modelIdEndsWith?: string;
    rawModelsList?: RawDiscoveredModel[];
  },
): Promise<ModelInfo[]> {
  const providerId: ProviderId = options?.providerId || 'openai';
  const cfg = getProviderConfig(providerId);
  const baseURL = options?.baseURL ?? cfg.baseURL;
  const modelIdEndsWith = options?.modelIdEndsWith ?? cfg.modelIdEndsWith;

  let rawData: RawDiscoveredModel[];
  if (options?.rawModelsList) {
    rawData = options.rawModelsList;
  } else {
    const client = new OpenAI({ apiKey, baseURL });
    const page = await client.models.list();
    rawData = (page.data || []) as unknown as RawDiscoveredModel[];
  }

  const discovered: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const model of rawData) {
    if (model.active === false) continue;
    const outputModalities = model.architecture?.output_modalities;
    if (Array.isArray(outputModalities) && outputModalities.length > 0 && !outputModalities.includes('text')) {
      continue;
    }
    const id = model.id;
    if (!isCompatibleChatModelId(id, providerId, modelIdEndsWith, model.pricing) || seen.has(id)) continue;
    seen.add(id);

    const lower = id.toLowerCase();
    const zeroPriced = isZeroPricingObject(model.pricing);
    const pricing = zeroPriced
      ? { inputPricePer1MUsd: 0, outputPricePer1MUsd: 0, pricingVerified: true }
      : lookupVerifiedPricing(providerId, id);
    const freeMeta = inferModelFreeTier(providerId, id, {
      isZeroPricing:
        zeroPriced ||
        (pricing.pricingVerified && pricing.inputPricePer1MUsd === 0 && pricing.outputPricePer1MUsd === 0),
    });
    const contextLen =
      typeof model.context_length === 'number'
        ? model.context_length
        : typeof model.max_context_length === 'number'
          ? model.max_context_length
          : typeof model.context_window === 'number'
            ? model.context_window
            : null;
    const inputModalities = model.architecture?.input_modalities;
    const hasImageInput = Array.isArray(inputModalities) && inputModalities.includes('image');

    discovered.push({
      compositeId: `${providerId}:${id}`,
      provider: providerId,
      modelId: id,
      displayName: model.name || id,
      description: cfg.descriptionNote,
      capabilities: /^(o1|o3|o4|gpt-5)/.test(lower) || lower.includes('r1') || lower.includes('reason')
        ? ['Advanced Reasoning', 'Coding', 'Text', 'Streaming']
        : lower.includes('coder') || lower.includes('codestral') || lower.includes('devstral')
          ? ['Coding', 'Reasoning', 'Text', 'Streaming']
          : ['Reasoning', 'Text', 'Streaming'],
      contextWindowTokens: contextLen,
      supportsMultimodal:
        hasImageInput ||
        lower.includes('gpt-4o') ||
        lower.includes('gpt-4.1') ||
        lower.includes('gpt-5') ||
        lower.includes('vision') ||
        lower.includes('pixtral'),
      source: 'live_discovered',
      available: true,
      availabilityState: 'verified',
      isFreeTier: freeMeta.isFreeTier,
      freeTierNote: freeMeta.freeTierNote,
      inputPricePer1MUsd: pricing.inputPricePer1MUsd,
      outputPricePer1MUsd: pricing.outputPricePer1MUsd,
      pricingVerified: pricing.pricingVerified,
    });
  }

  discovered.sort((a, b) => a.modelId.localeCompare(b.modelId));
  return discovered;
}

export async function streamOpenAIResponse(params: {
  apiKey: string;
  provider?: ProviderId;
  baseURL?: string;
  modelId: string;
  systemInstruction: string;
  prompt: string;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}): Promise<{
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  pricingKnown: boolean;
  stopped: boolean;
}> {
  const startedAt = Date.now();
  const providerId: ProviderId = params.provider || 'openai';
  const cfg = getProviderConfig(providerId);
  const baseURL = params.baseURL ?? cfg.baseURL;
  const client = new OpenAI({ apiKey: params.apiKey, baseURL });
  let fullContent = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopped = false;

  const baseReq = {
    model: params.modelId,
    stream: true as const,
    messages: [
      { role: 'system' as const, content: params.systemInstruction },
      { role: 'user' as const, content: params.prompt },
    ],
  };

  let stream;
  try {
    stream = await client.chat.completions.create(
      {
        ...baseReq,
        stream_options: { include_usage: true },
      },
      { signal: params.signal },
    );
  } catch (err) {
    const rawMsg = redactSensitiveText(err instanceof Error ? err.message : String(err), params.apiKey).toLowerCase();
    if (rawMsg.includes('stream_options') || rawMsg.includes('include_usage')) {
      stream = await client.chat.completions.create(baseReq, { signal: params.signal });
    } else {
      throw err;
    }
  }

  try {
    for await (const chunk of stream) {
      if (params.signal.aborted) {
        stopped = true;
        break;
      }
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) {
        fullContent += delta;
        params.onDelta(delta);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
    }
  } catch (err) {
    if (params.signal.aborted) {
      stopped = true;
    } else {
      throw err;
    }
  }

  const latencyMs = Date.now() - startedAt;
  const pricing = estimateModelCost(providerId, params.modelId, inputTokens, outputTokens);

  return {
    content: fullContent,
    inputTokens,
    outputTokens,
    latencyMs,
    estimatedCostUsd: pricing.estimatedCostUsd,
    pricingKnown: pricing.pricingKnown,
    stopped,
  };
}

export async function completeShortOpenAIPrompt(params: {
  apiKey: string;
  provider?: ProviderId;
  baseURL?: string;
  modelId: string;
  systemInstruction: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const providerId: ProviderId = params.provider || 'openai';
  const cfg = getProviderConfig(providerId);
  const baseURL = params.baseURL ?? cfg.baseURL;
  const client = new OpenAI({ apiKey: params.apiKey, baseURL });
  const timeoutMs = params.timeoutMs ?? 4500;
  const messages = [
    { role: 'system' as const, content: params.systemInstruction },
    { role: 'user' as const, content: params.prompt },
  ];

  let resp;
  try {
    resp = await client.chat.completions.create(
      {
        model: params.modelId,
        messages,
        max_completion_tokens: 256,
        temperature: 0.35,
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch (err) {
    const errMsg = redactSensitiveText(
      err instanceof Error ? err.message : String(err),
      params.apiKey,
    ).toLowerCase();
    const retryWithoutTemp = errMsg.includes('temperature');
    if (!isUnsupportedMaxCompletionTokensError(err) && !retryWithoutTemp) {
      throw err;
    }
    resp = await client.chat.completions.create(
      {
        model: params.modelId,
        messages,
        ...(isUnsupportedMaxCompletionTokensError(err)
          ? { max_tokens: 256 }
          : { max_completion_tokens: 256 }),
        ...(retryWithoutTemp ? {} : { temperature: 0.35 }),
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
  }
  return resp.choices?.[0]?.message?.content || '';
}
