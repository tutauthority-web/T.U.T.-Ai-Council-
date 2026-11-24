import { isModelFreeTier, PROVIDER_IDS } from '../shared/providers';
import type { IntelligenceLevel, ModelInfo, ProviderId } from '../shared/types';

export type ModelAccessFilter = 'all' | 'free' | 'paid';
export type ModelSortOption = 'recommended' | 'free_first' | 'context' | 'alpha';

export function isModelSelectableClient(m: ModelInfo): boolean {
  return (
    m.available &&
    (m.availabilityState === 'inference_ready' || m.availabilityState === 'verified')
  );
}

export function formatContextWindow(tokens: number | null): string | null {
  if (tokens === null || !Number.isFinite(tokens) || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M ctx`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K ctx`;
  }
  return `${tokens} ctx`;
}

export function scoreModelForManualBrowse(m: ModelInfo): number {
  const id = m.modelId.toLowerCase();
  let score = 0;

  if (m.available && isModelSelectableClient(m)) score += 100;
  if (m.availabilityState === 'inference_ready') score += 18;
  if (isModelFreeTier(m)) score += 12;

  if (
    /gpt-4o|gpt-4\.1|gpt-5|gpt-oss|claude-sonnet|claude-opus|gemini-2\.5|gemini-2\.0-flash|gemma-3|llama-3\.3-70b|llama-4|deepseek|qwen|mistral-large|mistral-small|devstral|nemotron|glm-4|kimi-k2/.test(
      id,
    )
  ) {
    score += 14;
  }

  if (m.tier === 'high') score += 6;
  else if (m.tier === 'medium') score += 5;
  else if (m.tier === 'extreme') score += 4;
  else if (m.tier === 'low') score += 2;

  if (m.contextWindowTokens && m.contextWindowTokens >= 64_000) score += 4;
  if (id === 'openrouter/free') score -= 3;
  if (/(?:^|[-_/:])(1b|2b|3b|4b|nano|micro)(?:$|[-_/:])/.test(id)) score -= 6;
  if (/-\d{4}-\d{2}-\d{2}|-\d{8}$/.test(id)) score -= 4;

  return score;
}

export function sortModelsForPicker(
  list: ModelInfo[],
  sortBy: ModelSortOption,
): ModelInfo[] {
  const copy = [...list];
  if (sortBy === 'alpha') {
    return copy.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  if (sortBy === 'context') {
    return copy.sort(
      (a, b) =>
        (b.contextWindowTokens || 0) - (a.contextWindowTokens || 0) ||
        scoreModelForManualBrowse(b) - scoreModelForManualBrowse(a),
    );
  }
  if (sortBy === 'free_first') {
    return copy.sort((a, b) => {
      const freeDiff = Number(isModelFreeTier(b)) - Number(isModelFreeTier(a));
      if (freeDiff !== 0) return freeDiff;
      return scoreModelForManualBrowse(b) - scoreModelForManualBrowse(a);
    });
  }
  return copy.sort(
    (a, b) =>
      scoreModelForManualBrowse(b) - scoreModelForManualBrowse(a) ||
      a.displayName.localeCompare(b.displayName),
  );
}

export function pickQuickMixIds(
  models: ModelInfo[],
  preset: 'best_free' | 'fast_free' | 'all_providers',
  maxCount = 4,
): string[] {
  const ready = models.filter(isModelSelectableClient);
  const pool =
    preset === 'all_providers' ? ready : ready.filter((m) => isModelFreeTier(m));

  if (pool.length === 0) return [];

  const ranked = [...pool].sort((a, b) => {
    let sa = scoreModelForManualBrowse(a);
    let sb = scoreModelForManualBrowse(b);
    if (preset === 'fast_free') {
      const fastTier = (tier?: IntelligenceLevel) =>
        tier === 'low' ? 14 : tier === 'medium' ? 12 : tier === 'high' ? 2 : -8;
      sa += fastTier(a.tier);
      sb += fastTier(b.tier);
    }
    return sb - sa;
  });

  const chosen: string[] = [];
  const used = new Set<string>();
  const usedProviders = new Set<ProviderId>();

  // 1st pass: 1 best model per connected provider so OpenRouter, Groq, Cerebras, Mistral, Google all get a slot
  for (const pid of PROVIDER_IDS) {
    if (chosen.length >= maxCount) break;
    const match = ranked.find((m) => m.provider === pid && !used.has(m.compositeId));
    if (match && !usedProviders.has(match.provider)) {
      chosen.push(match.compositeId);
      used.add(match.compositeId);
      usedProviders.add(match.provider);
    }
  }

  // 2nd pass: fill remaining up to maxCount by overall score
  for (const m of ranked) {
    if (chosen.length >= maxCount) break;
    if (!used.has(m.compositeId)) {
      chosen.push(m.compositeId);
      used.add(m.compositeId);
    }
  }

  return chosen;
}
