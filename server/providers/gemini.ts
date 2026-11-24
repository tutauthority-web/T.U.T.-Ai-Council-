import { GoogleGenAI } from '@google/genai';
import { inferModelFreeTier } from '../../src/shared/providers.ts';
import type { ModelInfo, ProviderHealthState } from '../../src/shared/types.ts';
import { estimateModelCost, lookupVerifiedPricing } from '../catalog.ts';
import { classifyProviderError, formatClassifiedError } from '../modelHealth.ts';

export const GEMINI_PROBE_TIMEOUT_MS = 20_000;

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function probeGeminiModel(apiKey: string, modelId: string): Promise<void> {
  const ai = createGeminiClient(apiKey);
  const resp = await Promise.race([
    ai.models.generateContent({
      model: modelId,
      contents: 'Reply with OK.',
      config: {
        maxOutputTokens: 128,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Inference probe timeout for Google Gemini')), GEMINI_PROBE_TIMEOUT_MS),
    ),
  ]);
  const hasCandidate = Boolean(resp.candidates && resp.candidates.length > 0);
  const hasText = typeof resp.text === 'string' && resp.text.trim().length > 0;
  if (!hasCandidate && !hasText) {
    throw new Error(`Model ${modelId} returned an empty probe response.`);
  }
}

export async function verifyGeminiConnection(apiKey: string): Promise<{
  valid: boolean;
  verifiedAuth: boolean;
  modelsCount: number;
  healthState: ProviderHealthState;
  probedModelIds: string[];
  error?: string;
}> {
  try {
    const models = await discoverGeminiModels(apiKey);
    if (models.length === 0) {
      return {
        valid: false,
        verifiedAuth: true,
        modelsCount: 0,
        healthState: 'unavailable',
        probedModelIds: [],
        error: 'No generative Gemini chat models were returned by models.list() for this key.',
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
    const classified = classifyProviderError(err, 'google', apiKey);
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

export async function discoverGeminiModels(apiKey: string): Promise<ModelInfo[]> {
  const ai = createGeminiClient(apiKey);
  const discovered: ModelInfo[] = [];
  const seen = new Set<string>();

  const pager = await ai.models.list();
  for await (const rawModel of pager) {
    const rawName = rawModel.name || '';
    const modelId = rawName.replace(/^models\//, '');
    if (!modelId || seen.has(modelId)) continue;
    const actions = rawModel.supportedActions || [];
    if (actions.length > 0 && !actions.includes('generateContent')) continue;
    if (
      modelId.includes('embedding') ||
      modelId.includes('imagen') ||
      modelId.includes('veo') ||
      modelId.includes('lyria') ||
      modelId.includes('tts') ||
      modelId.includes('transcribe') ||
      modelId.includes('native-audio') ||
      modelId.includes('robotics') ||
      modelId.includes('computer-use') ||
      modelId.includes('deep-research') ||
      modelId.includes('aqa') ||
      modelId.includes('bison') ||
      modelId.includes('gecko') ||
      modelId.includes('-image') ||
      modelId.includes('gemini-1.0') ||
      modelId.includes('pro-vision') ||
      modelId.includes('learnlm') ||
      modelId.includes('shieldgemma') ||
      modelId.includes('gemma-3-1b')
    ) {
      continue;
    }

    seen.add(modelId);
    const pricing = lookupVerifiedPricing('google', modelId);
    const caps = ['Text', 'Streaming', 'Reasoning'];
    if (modelId.includes('pro')) caps.push('Coding', 'Analysis');
    if (modelId.includes('2.5')) caps.push('Deep Reasoning');
    const freeMeta = inferModelFreeTier('google', modelId);

    discovered.push({
      compositeId: `google:${modelId}`,
      provider: 'google',
      modelId,
      displayName: rawModel.displayName || modelId,
      description: rawModel.description || 'Discovered Google Gemini generative model.',
      capabilities: caps,
      contextWindowTokens: rawModel.inputTokenLimit ?? null,
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

export async function streamGeminiResponse(params: {
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
  const ai = createGeminiClient(params.apiKey);
  let fullContent = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopped = false;

  const isGemma = params.modelId.toLowerCase().includes('gemma');
  const stream = await ai.models.generateContentStream({
    model: params.modelId,
    contents: isGemma
      ? `[Role & Rules]\n${params.systemInstruction}\n\n${params.prompt}`
      : params.prompt,
    config: isGemma
      ? undefined
      : {
          systemInstruction: params.systemInstruction,
        },
  });

  for await (const chunk of stream) {
    if (params.signal.aborted) {
      stopped = true;
      break;
    }
    const piece = chunk.text || '';
    if (piece) {
      fullContent += piece;
      params.onDelta(piece);
    }
    if (chunk.usageMetadata) {
      if (typeof chunk.usageMetadata.promptTokenCount === 'number') {
        inputTokens = chunk.usageMetadata.promptTokenCount;
      }
      if (typeof chunk.usageMetadata.candidatesTokenCount === 'number') {
        outputTokens = chunk.usageMetadata.candidatesTokenCount;
      }
    }
  }

  const latencyMs = Date.now() - startedAt;
  const pricing = estimateModelCost('google', params.modelId, inputTokens, outputTokens);

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

export async function completeShortGeminiPrompt(params: {
  apiKey: string;
  modelId: string;
  systemInstruction: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const ai = createGeminiClient(params.apiKey);
  const isGemma = params.modelId.toLowerCase().includes('gemma');
  const resp = await Promise.race([
    ai.models.generateContent({
      model: params.modelId,
      contents: isGemma
        ? `[Role & Rules]\n${params.systemInstruction}\n\n${params.prompt}`
        : params.prompt,
      config: isGemma
        ? { maxOutputTokens: 200, temperature: 0.35 }
        : {
            systemInstruction: params.systemInstruction,
            maxOutputTokens: 200,
            temperature: 0.35,
          },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Gemini reaction evaluation timeout')),
        params.timeoutMs ?? 4500,
      ),
    ),
  ]);
  return typeof resp.text === 'string' ? resp.text : '';
}
