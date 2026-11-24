import {
  isChatGptAliasModelId,
  isManagedSeatModelId,
  PROVIDER_REGISTRY,
} from '../src/shared/providers.ts';
import type { ModelInfo, ProviderId } from '../src/shared/types.ts';
import { getDiscoveredCatalogCache, setDiscoveredCatalogCache } from './modelHealth.ts';
import { discoverGeminiModels } from './providers/gemini.ts';

export function isChatGptAliasComposite(compositeId: string): boolean {
  const idx = compositeId.indexOf(':');
  if (idx === -1) return false;
  return compositeId.slice(0, idx) === 'openai' && isChatGptAliasModelId(compositeId.slice(idx + 1));
}

export function isManagedSeatComposite(compositeId: string): boolean {
  const idx = compositeId.indexOf(':');
  if (idx === -1) return false;
  return isManagedSeatModelId(compositeId.slice(idx + 1));
}

export function pickBestGeminiFlashLiteModelId(
  googleModels: Array<{ modelId: string; available?: boolean }>,
): string {
  const envOverride = process.env.CHATGPT_ALIAS_GEMINI_MODEL?.trim();
  if (envOverride) return envOverride;

  const usable = googleModels.filter((m) => m.available !== false);
  const candidates = usable.length > 0 ? usable : googleModels;

  const isPreview = (id: string) => /(?:preview|exp)/i.test(id);

  const matchers: Array<(id: string) => boolean> = [
    (id) => /gemini-3\.5-flash-lite/i.test(id) && !isPreview(id),
    (id) => /gemini-3\.5-flash-lite/i.test(id),
    (id) => /gemini-2\.5-flash-lite/i.test(id) && !isPreview(id),
    (id) => /gemini-2\.5-flash-lite/i.test(id),
    (id) => /flash-lite/i.test(id) && !isPreview(id),
    (id) => /flash-lite/i.test(id),
    (id) => /gemini-2\.5-flash/i.test(id) && !isPreview(id),
    (id) => /flash/i.test(id) && !isPreview(id),
    (id) => /flash/i.test(id),
  ];

  for (const matcher of matchers) {
    const found = candidates.find((m) => matcher(m.modelId));
    if (found) return found.modelId;
  }

  return 'gemini-2.5-flash-lite';
}

export async function resolveChatGptAliasGeminiModelId(
  uid: string,
  googleApiKey: string,
  knownGoogleModels?: Array<{ modelId: string; available?: boolean }>,
): Promise<string> {
  if (knownGoogleModels && knownGoogleModels.length > 0) {
    return pickBestGeminiFlashLiteModelId(knownGoogleModels);
  }
  const cached = getDiscoveredCatalogCache(uid, 'google');
  if (cached && cached.length > 0) {
    return pickBestGeminiFlashLiteModelId(cached);
  }
  try {
    const discovered = await discoverGeminiModels(googleApiKey);
    if (discovered.length > 0) {
      setDiscoveredCatalogCache(uid, 'google', discovered);
      return pickBestGeminiFlashLiteModelId(discovered);
    }
  } catch {
    // Fall back to default flash-lite model identifier
  }
  return pickBestGeminiFlashLiteModelId([]);
}

export function buildChatGptAliasModelInfo(slot = 1): ModelInfo {
  const modelId = `chatgpt-${slot}`;
  return {
    compositeId: `openai:${modelId}`,
    provider: 'openai',
    modelId,
    displayName: 'ChatGPT',
    description: 'Managed ChatGPT assistant powered by T.U.T AI Council.',
    capabilities: ['Text', 'Streaming', 'Reasoning'],
    contextWindowTokens: 1000000,
    supportsMultimodal: true,
    source: 'live_discovered',
    available: true,
    availabilityState: 'inference_ready',
    tier: 'low',
    isFreeTier: true,
    freeTierNote: 'Premium Managed',
    inputPricePer1MUsd: null,
    outputPricePer1MUsd: null,
    pricingVerified: false,
  };
}

export function buildManagedSeatModelInfo(providerId: ProviderId, modelId: string): ModelInfo {
  const isChatGpt = providerId === 'openai' && isChatGptAliasModelId(modelId);
  return {
    compositeId: `${providerId}:${modelId}`,
    provider: providerId,
    modelId,
    displayName: isChatGpt ? 'ChatGPT' : PROVIDER_REGISTRY[providerId]?.name || providerId,
    description: `Managed ${isChatGpt ? 'ChatGPT' : PROVIDER_REGISTRY[providerId]?.name || providerId} seat.`,
    capabilities: ['Text', 'Streaming', 'Reasoning'],
    contextWindowTokens: null,
    supportsMultimodal: true,
    source: 'live_discovered',
    available: true,
    availabilityState: 'inference_ready',
    tier: 'low',
    isFreeTier: true,
    freeTierNote: 'Premium Managed',
    inputPricePer1MUsd: null,
    outputPricePer1MUsd: null,
    pricingVerified: false,
  };
}
