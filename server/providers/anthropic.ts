import Anthropic from '@anthropic-ai/sdk';
import { inferModelFreeTier } from '../../src/shared/providers.ts';
import type { ModelInfo, ProviderHealthState } from '../../src/shared/types.ts';
import { estimateModelCost, lookupVerifiedPricing } from '../catalog.ts';
import { classifyProviderError, formatClassifiedError } from '../modelHealth.ts';

export const ANTHROPIC_PROBE_TIMEOUT_MS = 20_000;

export async function probeAnthropicModel(apiKey: string, modelId: string): Promise<void> {
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create(
    {
      model: modelId,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    },
    { signal: AbortSignal.timeout(ANTHROPIC_PROBE_TIMEOUT_MS) },
  );
  if (!resp.content || resp.content.length === 0) {
    throw new Error(`Anthropic model ${modelId} returned empty probe content.`);
  }
}

export async function verifyAnthropicConnection(apiKey: string): Promise<{
  valid: boolean;
  verifiedAuth: boolean;
  modelsCount: number;
  healthState: ProviderHealthState;
  probedModelIds: string[];
  error?: string;
}> {
  if (apiKey.trim().startsWith('sk-ant-usr-')) {
    return {
      valid: false,
      verifiedAuth: false,
      modelsCount: 0,
      healthState: 'invalid_credentials',
      probedModelIds: [],
      error:
        'Tokens starting with sk-ant-usr- are Claude Code/user session tokens, not Anthropic API keys. Create an API key starting with sk-ant-api03- in console.anthropic.com.',
    };
  }
  try {
    const models = await discoverAnthropicModels(apiKey);
    if (models.length === 0) {
      return {
        valid: false,
        verifiedAuth: true,
        modelsCount: 0,
        healthState: 'unavailable',
        probedModelIds: [],
        error: 'No Anthropic models were returned by models.list() for this API key.',
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
    const classified = classifyProviderError(err, 'anthropic', apiKey);
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
      error: formatClassifiedError(classified),
    };
  }
}

export async function discoverAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const client = new Anthropic({ apiKey });
  const discovered: ModelInfo[] = [];
  const seen = new Set<string>();

  for await (const model of client.models.list({ limit: 100 })) {
    const id = model.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const pricing = lookupVerifiedPricing('anthropic', id);
    const freeMeta = inferModelFreeTier('anthropic', id);
    discovered.push({
      compositeId: `anthropic:${id}`,
      provider: 'anthropic',
      modelId: id,
      displayName: model.display_name || id,
      description: 'Discovered Anthropic Claude model.',
      capabilities: ['Reasoning', 'Analysis', 'Coding', 'Streaming'],
      contextWindowTokens: 200000,
      supportsMultimodal: true,
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

export async function streamAnthropicResponse(params: {
  apiKey: string;
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
  const client = new Anthropic({ apiKey: params.apiKey });
  let fullContent = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopped = false;

  const stream = client.messages.stream(
    {
      model: params.modelId,
      max_tokens: 4096,
      system: params.systemInstruction,
      messages: [{ role: 'user', content: params.prompt }],
    },
    { signal: params.signal },
  );

  try {
    for await (const event of stream) {
      if (params.signal.aborted) {
        stopped = true;
        break;
      }
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const piece = event.delta.text;
        fullContent += piece;
        params.onDelta(piece);
      } else if (event.type === 'message_start' && event.message.usage) {
        inputTokens = event.message.usage.input_tokens ?? inputTokens;
      } else if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens ?? outputTokens;
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
  const pricing = estimateModelCost('anthropic', params.modelId, inputTokens, outputTokens);

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

export async function completeShortAnthropicPrompt(params: {
  apiKey: string;
  modelId: string;
  systemInstruction: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const client = new Anthropic({ apiKey: params.apiKey });
  const resp = await client.messages.create(
    {
      model: params.modelId,
      max_tokens: 120,
      system: params.systemInstruction,
      messages: [{ role: 'user', content: params.prompt }],
    },
    { signal: AbortSignal.timeout(params.timeoutMs ?? 4500) },
  );
  const textBlock = resp.content.find((b) => b.type === 'text');
  return textBlock && 'text' in textBlock ? textBlock.text : '';
}
