import { GoogleGenAI, Type } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  getProviderConfig,
  isFreeRateLimitedProvider,
  isModelFreeTier,
  PROVIDER_IDS,
} from '../src/shared/providers.ts';
import type {
  DiscussionMode,
  IntelligenceLevel,
  ModelInfo,
  ProviderId,
  SmartSelectResult,
} from '../src/shared/types.ts';
import { inferModelTier, probeSingleModel } from './modelCatalogService.ts';
import {
  classifyProviderError,
  getProviderHealth,
  recordModelUnavailable,
} from './modelHealth.ts';
import { isModelSelectable, runCouncilPreflight } from './preflight.ts';
import { resolveRuntimeApiKey } from './vault.ts';

export const INTELLIGENCE_LEVEL_META: Record<
  IntelligenceLevel,
  { label: string; shortDescription: string }
> = {
  low: {
    label: 'Low',
    shortDescription: 'Casual conversations and simple questions.',
  },
  medium: {
    label: 'Medium',
    shortDescription: 'Everyday reasoning, explanations and general research.',
  },
  high: {
    label: 'High',
    shortDescription: 'Complex analysis, coding and advanced problem-solving.',
  },
  extreme: {
    label: 'Extreme',
    shortDescription: 'Deep reasoning, challenging problems and intensive multi-model deliberation.',
  },
};

const TIER_RANK: Record<IntelligenceLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  extreme: 3,
};

export function scoreModelForSelection(
  model: ModelInfo,
  prompt: string,
  mode: DiscussionMode,
  intelligenceLevel: IntelligenceLevel,
): number {
  const p = prompt.toLowerCase();
  const id = model.modelId.toLowerCase();
  const tier = model.tier || inferModelTier(model.modelId);
  const capsLower = model.capabilities.map((c) => c.toLowerCase()).join(' ');

  const isCodingOrTechnical =
    /\b(code|coding|bug|debug|refactor|typescript|python|sql|database|algorithm|architecture|security|audit|api|system)\b/.test(
      p,
    );
  const isLongContext = prompt.length > 2000;

  let score = 20;

  // Gentle tie-breaker for models that have already passed live inference testing
  // (keep modest so newly connected providers like OpenRouter are not locked out)
  if (model.availabilityState === 'inference_ready') {
    score += 6;
  }

  if (isModelFreeTier(model)) {
    score += 3;
  }

  if (intelligenceLevel === 'low') {
    if (tier === 'low') score += 40;
    else if (tier === 'medium') score += 26;
    else if (tier === 'high') score -= 12;
    else score -= 34;

    if (model.pricingVerified && model.outputPricePer1MUsd !== null) {
      score -= Math.min(model.outputPricePer1MUsd * 1.4, 22);
    }
  } else if (intelligenceLevel === 'medium') {
    if (tier === 'medium') score += 36;
    else if (tier === 'low') score += 22;
    else if (tier === 'high') score += 24;
    else score += 6;

    if (model.pricingVerified && model.outputPricePer1MUsd !== null) {
      score -= Math.min(model.outputPricePer1MUsd * 0.45, 10);
    }
  } else if (intelligenceLevel === 'high') {
    if (tier === 'high') score += 38;
    else if (tier === 'extreme') score += 28;
    else if (tier === 'medium') score += 16;
    else score -= 8;

    if (
      isCodingOrTechnical &&
      (capsLower.includes('coding') ||
        capsLower.includes('reasoning') ||
        id.includes('sonnet') ||
        id.includes('pro') ||
        id.includes('gpt-4o') ||
        id.includes('gpt-4.1') ||
        id.includes('o3') ||
        id.includes('deepseek') ||
        id.includes('qwen'))
    ) {
      score += 8;
    }
  } else {
    if (tier === 'extreme') score += 44;
    else if (tier === 'high') score += 32;
    else if (tier === 'medium') score += 10;
    else score -= 22;

    if (
      capsLower.includes('deep') ||
      capsLower.includes('architecture') ||
      capsLower.includes('advanced') ||
      id.includes('opus') ||
      id.startsWith('o3') ||
      id.startsWith('o4') ||
      id.includes('pro') ||
      id.includes('r1') ||
      id.includes('deepseek')
    ) {
      score += 8;
    }
  }

  if (mode === 'debate' && TIER_RANK[tier] >= 1) {
    score += 4;
  }

  // Prefer strong flagship/workhorse chat models across both paid and open-weight/free ecosystems
  if (
    /gpt-4o|gpt-4\.1|gpt-5|gpt-oss|claude-sonnet|claude-haiku|claude-opus|gemini-2\.5-flash|gemini-2\.5-pro|gemini-2\.0-flash|gemma-3|llama-3\.3-70b|llama-3\.1-8b|llama-4|kimi-k2|mistral-large|mistral-small|devstral|deepseek|qwen|nemotron|glm-4|hermes/.test(
      id,
    )
  ) {
    score += 4;
  }

  // Prefer concrete named OpenRouter :free slugs before generic auto-router alias
  if (id === 'openrouter/free') {
    score -= 2;
  }

  if (/-\d{4}-\d{2}-\d{2}|-\d{8}$|-\d{3}$/.test(id)) score -= 8;
  const isExperimentalTag =
    id.includes('experimental') || /(?:^|[-_/:])(preview|exp)(?:$|[-_/:])/.test(id);
  if (isExperimentalTag) {
    score -= /:free$/.test(id) ? 3 : 10;
  }
  if (
    intelligenceLevel !== 'low' &&
    /:free$/.test(id) &&
    /(?:^|[-_/:])(1b|2b|3b|4b|nano|micro)(?:$|[-_/:])/.test(id)
  ) {
    score -= 12;
  }

  if (isLongContext && model.contextWindowTokens !== null && model.contextWindowTokens < 32000) {
    score -= 25;
  }

  return score;
}

export function selectModelsHeuristically(
  available: ModelInfo[],
  prompt: string,
  mode: DiscussionMode,
  intelligenceLevel: IntelligenceLevel,
  warnings: string[] = [],
  options?: { freeOnly?: boolean },
): SmartSelectResult {
  const ready = available.filter(
    (m) => isModelSelectable(m) && (!options?.freeOnly || isModelFreeTier(m)),
  );
  const scored = ready
    .map((m) => ({ model: m, score: scoreModelForSelection(m, prompt, mode, intelligenceLevel) }))
    .sort((a, b) => b.score - a.score);

  if (ready.length === 1 && mode === 'chat') {
    const solo = ready[0];
    return {
      selectedModels: [solo.compositeId],
      moderatorModel: 'none',
      intelligenceLevel,
      rationale: `Single Model Chat active: ${solo.compositeId} selected.`,
      warnings,
      method: 'capability_heuristic',
      singleModelMode: true,
      freeOnly: Boolean(options?.freeOnly),
    };
  }

  const uniqueProviderCount = new Set(ready.map((m) => m.provider)).size;
  const desiredCount =
    intelligenceLevel === 'low'
      ? Math.min(2, ready.length)
      : intelligenceLevel === 'extreme'
        ? Math.min(4, ready.length)
        : Math.min(Math.max(3, Math.min(4, uniqueProviderCount)), ready.length);

  const providersByBestScore: Array<{ provider: ProviderId; best: typeof scored[number] }> = [];
  for (const pid of PROVIDER_IDS) {
    const top = scored.find((s) => s.model.provider === pid);
    if (top) providersByBestScore.push({ provider: pid, best: top });
  }
  providersByBestScore.sort((a, b) => b.best.score - a.best.score);

  const chosen: ModelInfo[] = [];
  const usedIds = new Set<string>();

  for (const entry of providersByBestScore) {
    if (chosen.length >= desiredCount) break;
    chosen.push(entry.best.model);
    usedIds.add(entry.best.model.compositeId);
  }

  const targetCount = Math.max(Math.min(2, ready.length), desiredCount);
  for (const item of scored) {
    if (chosen.length >= targetCount) break;
    if (!usedIds.has(item.model.compositeId)) {
      chosen.push(item.model);
      usedIds.add(item.model.compositeId);
    }
  }

  const selectedIds = chosen.map((m) => m.compositeId);
  const moderatorCandidate =
    [...chosen].sort(
      (a, b) =>
        TIER_RANK[b.tier || inferModelTier(b.modelId)] -
        TIER_RANK[a.tier || inferModelTier(a.modelId)],
    )[0] || chosen[0];

  const moderatorModel = mode === 'chat' ? 'none' : moderatorCandidate.compositeId;
  const providerNames = Array.from(new Set(chosen.map((m) => m.provider))).join(', ');

  return {
    selectedModels: selectedIds,
    moderatorModel,
    intelligenceLevel,
    rationale: `${INTELLIGENCE_LEVEL_META[intelligenceLevel].label} intelligence${options?.freeOnly ? ' (free tier only)' : ''} routing selected ${chosen.length} verified models across ${providerNames || 'connected providers'}.`,
    warnings,
    method: 'capability_heuristic',
    singleModelMode: chosen.length === 1,
    freeOnly: Boolean(options?.freeOnly),
  };
}

export function rankFallbackCandidates(params: {
  availableModels: ModelInfo[];
  excludedCompositeIds: Set<string>;
  blockedProviders: Set<ProviderId>;
  intelligenceLevel: IntelligenceLevel;
  prompt: string;
  mode: DiscussionMode;
  preferCrossProviderFrom?: ProviderId;
}): ModelInfo[] {
  const candidates = params.availableModels.filter(
    (m) =>
      isModelSelectable(m) &&
      !params.excludedCompositeIds.has(m.compositeId) &&
      !params.blockedProviders.has(m.provider),
  );

  return candidates
    .map((m) => {
      let score = scoreModelForSelection(m, params.prompt, params.mode, params.intelligenceLevel);
      if (params.preferCrossProviderFrom && m.provider !== params.preferCrossProviderFrom) {
        score += 10;
      }
      return { model: m, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.model);
}

export function pickFallbackModel(params: {
  availableModels: ModelInfo[];
  excludedCompositeIds: Set<string>;
  blockedProviders: Set<ProviderId>;
  intelligenceLevel: IntelligenceLevel;
  prompt: string;
  mode: DiscussionMode;
  preferCrossProviderFrom?: ProviderId;
}): ModelInfo | null {
  return rankFallbackCandidates(params)[0] || null;
}

function isRouterSelectionCompatible(
  selected: ModelInfo[],
  allAvailable: ModelInfo[],
  intelligenceLevel: IntelligenceLevel,
): boolean {
  if (selected.length < 2) return false;
  if (intelligenceLevel === 'low') {
    const hasAffordable = allAvailable.some(
      (m) => TIER_RANK[m.tier || inferModelTier(m.modelId)] <= 1,
    );
    const pickedExtreme = selected.some(
      (m) => TIER_RANK[m.tier || inferModelTier(m.modelId)] === 3,
    );
    if (hasAffordable && pickedExtreme) return false;
  }
  return true;
}

function buildBalancedRouterCandidates(
  rankedPool: ModelInfo[],
  maxTotal = 30,
): ModelInfo[] {
  const byProvider = new Map<ProviderId, ModelInfo[]>();
  for (const m of rankedPool) {
    const list = byProvider.get(m.provider) || [];
    list.push(m);
    byProvider.set(m.provider, list);
  }
  const picked: ModelInfo[] = [];
  const queues = Array.from(byProvider.values());
  let idx = 0;
  while (picked.length < maxTotal) {
    let addedInPass = false;
    for (const q of queues) {
      if (idx < q.length) {
        picked.push(q[idx]);
        addedInPass = true;
        if (picked.length >= maxTotal) break;
      }
    }
    if (!addedInPass) break;
    idx += 1;
  }
  return picked;
}

export async function smartSelectModels(params: {
  uid: string;
  idToken: string;
  prompt: string;
  mode: DiscussionMode;
  intelligenceLevel?: IntelligenceLevel;
  freeOnly?: boolean;
  preferredProviders?: ProviderId[];
  priorityOrder?: readonly ProviderId[];
  seatCount?: number;
  isPremium?: boolean;
  runPreflightFn?: typeof runCouncilPreflight;
  probeModelFn?: typeof probeSingleModel;
  resolveKeyFn?: typeof resolveRuntimeApiKey;
  verifyUnprobed?: boolean;
}): Promise<SmartSelectResult> {
  const intelligenceLevel: IntelligenceLevel = params.intelligenceLevel || 'low';
  const freeOnly = Boolean(params.freeOnly);
  const preflight = await (params.runPreflightFn || runCouncilPreflight)({
    uid: params.uid,
    idToken: params.idToken,
    isPremium: params.isPremium,
  });

  const allSelectable = preflight.readyModels.filter(isModelSelectable);
  const providerSet =
    params.preferredProviders && params.preferredProviders.length > 0
      ? new Set<ProviderId>(params.preferredProviders)
      : null;

  const available = allSelectable.filter((m) => {
    if (freeOnly && !isModelFreeTier(m)) return false;
    if (providerSet && !providerSet.has(m.provider)) return false;
    return true;
  });

  const statusParts = PROVIDER_IDS.map((pid) => {
    const st = preflight.providerStates[pid];
    if (!st || !st.connected) return `${pid}: disconnected`;
    return `${pid}: ${st.healthState} (${st.discoveredCount} listed)`;
  }).join(' | ');

  if (available.length === 0) {
    if (freeOnly && allSelectable.length > 0) {
      throw new Error(
        `No free-tier (no-subscription) models are currently available. Connected paid models exist, or connect a free API key (Groq, OpenRouter :free, Cerebras, Mistral, or Google Gemini free tier). Status: ${statusParts}.`,
      );
    }
    throw new Error(
      `No usable models are available. Provider status: ${statusParts}. Connect or resolve provider issues in Connections.`,
    );
  }

  const resolveKey = params.resolveKeyFn || resolveRuntimeApiKey;
  const probeModel = params.probeModelFn || probeSingleModel;
  const shouldVerifyUnprobed = params.verifyUnprobed !== false;
  const probeCache = new Map<string, boolean>();
  const keyCache = new Map<ProviderId, string | null>();
  const failedProbes: string[] = [];
  const lastProbeByProvider = new Map<ProviderId, number>();
  const probesByProvider = new Map<ProviderId, number>();
  let totalProbesRun = 0;
  const MAX_PROBES_PER_PROVIDER = 4;
  const MAX_TOTAL_PROBES = 16;

  const isCandidateUsable = async (model: ModelInfo): Promise<boolean> => {
    if (model.availabilityState === 'inference_ready' || !shouldVerifyUnprobed) {
      return true;
    }
    const cached = probeCache.get(model.compositeId);
    if (cached !== undefined) return cached;

    const providerProbes = probesByProvider.get(model.provider) || 0;
    if (providerProbes >= MAX_PROBES_PER_PROVIDER || totalProbesRun >= MAX_TOTAL_PROBES) {
      return false;
    }

    let apiKey = keyCache.get(model.provider);
    if (apiKey === undefined) {
      apiKey = await resolveKey(params.uid, params.idToken, model.provider, {
        isPremium: params.isPremium,
      });
      keyCache.set(model.provider, apiKey);
    }

    // If a test injected runPreflightFn without keys and without probeModelFn, don't block
    if (!apiKey && !params.probeModelFn) {
      probeCache.set(model.compositeId, true);
      return true;
    }

    if (isFreeRateLimitedProvider(model.provider)) {
      const prevTs = lastProbeByProvider.get(model.provider) || 0;
      if (prevTs > 0) {
        const elapsed = Date.now() - prevTs;
        if (elapsed < 400) {
          await new Promise((r) => setTimeout(r, 400 - elapsed));
        }
      }
      lastProbeByProvider.set(model.provider, Date.now());
    }

    probesByProvider.set(model.provider, providerProbes + 1);
    totalProbesRun += 1;
    const probe = await probeModel(
      params.uid,
      model.provider,
      apiKey || 'test-key',
      model.modelId,
    );
    probeCache.set(model.compositeId, probe.ok);
    if (!probe.ok) {
      failedProbes.push(`${model.compositeId}: ${probe.reason || 'probe failed'}`);
    }
    return probe.ok;
  };

  const rankedPool = [...available].sort(
    (a, b) =>
      scoreModelForSelection(b, params.prompt, params.mode, intelligenceLevel) -
      scoreModelForSelection(a, params.prompt, params.mode, intelligenceLevel),
  );
  const availableMap = new Map(available.map((m) => [m.compositeId, m]));

  const verifyAndBuildResult = async (
    preferredIds: string[],
    preferredMod: string,
    targetCount: number,
    method: SmartSelectResult['method'],
    rationale: string,
  ): Promise<SmartSelectResult> => {
    const accepted: ModelInfo[] = [];
    const seen = new Set<string>();
    const representedProviders = new Set<ProviderId>();
    const deferredSameProvider: ModelInfo[] = [];

    const tryAccept = async (model: ModelInfo): Promise<boolean> => {
      if (seen.has(model.compositeId)) return false;
      seen.add(model.compositeId);
      if (await isCandidateUsable(model)) {
        accepted.push(model);
        representedProviders.add(model.provider);
        return true;
      }
      return false;
    };

    // Pass 1: Take at most 1 model per provider from preferredIds so no provider locks out others (e.g. OpenRouter)
    for (const id of preferredIds) {
      if (accepted.length >= targetCount) break;
      const m = availableMap.get(id);
      if (!m) continue;
      if (!representedProviders.has(m.provider)) {
        await tryAccept(m);
      } else {
        deferredSameProvider.push(m);
      }
    }

    // Pass 2: Represent any remaining connected providers from rankedPool before doubling up on a provider
    if (accepted.length < targetCount) {
      for (const m of rankedPool) {
        if (accepted.length >= targetCount) break;
        if (!representedProviders.has(m.provider)) {
          await tryAccept(m);
        }
      }
    }

    // Pass 3: Fill any remaining slots with deferred preferred models, then overall highest-scored pool
    if (accepted.length < targetCount) {
      for (const m of deferredSameProvider) {
        if (accepted.length >= targetCount) break;
        await tryAccept(m);
      }
      for (const m of rankedPool) {
        if (accepted.length >= targetCount) break;
        await tryAccept(m);
      }
    }

    if (accepted.length === 0) {
      throw new Error(
        `No working models passed live inference verification.${failedProbes.length > 0 ? ` (${failedProbes.slice(0, 3).join(' | ')})` : ''} Status: ${statusParts}.`,
      );
    }

    if (accepted.length === 1 && params.mode !== 'chat') {
      throw new Error(
        `Multi-model ${params.mode === 'debate' ? 'Structured Debate' : 'Free Discussion'} requires at least 2 usable models, but only 1 (${accepted[0].compositeId}) passed verification. Switch to Single Model Chat or connect another model. Status: ${statusParts}.`,
      );
    }

    const acceptedSet = new Set(accepted.map((m) => m.compositeId));
    const bestMod =
      [...accepted].sort(
        (a, b) =>
          TIER_RANK[b.tier || inferModelTier(b.modelId)] -
          TIER_RANK[a.tier || inferModelTier(a.modelId)],
      )[0]?.compositeId || accepted[0].compositeId;

    const moderatorModel =
      params.mode === 'chat'
        ? 'none'
        : acceptedSet.has(preferredMod)
          ? preferredMod
          : bestMod;

    const warnings = [...preflight.warnings];
    if (failedProbes.length > 0) {
      warnings.push(`Skipped unresponsive models: ${failedProbes.slice(0, 3).join('; ')}`);
    }

    return {
      selectedModels: accepted.map((m) => m.compositeId),
      moderatorModel,
      intelligenceLevel,
      rationale,
      warnings: Array.from(new Set(warnings)),
      method,
      singleModelMode: accepted.length === 1,
      freeOnly,
    };
  };

  if (available.length === 1) {
    if (params.mode !== 'chat') {
      throw new Error(
        `Multi-model ${params.mode === 'debate' ? 'Structured Debate' : 'Free Discussion'} requires at least 2 usable models, but only 1 (${available[0].compositeId}) is available. Switch to Single Model Chat or connect another model. Status: ${statusParts}.`,
      );
    }
    return verifyAndBuildResult(
      [available[0].compositeId],
      'none',
      1,
      'capability_heuristic',
      `Single Model Chat active: ${available[0].compositeId} selected.`,
    );
  }

  // Deterministic cycling priority-order auto-selection (used by Premium managed seats: Gemini -> Groq -> OpenRouter -> Cohere)
  if (params.priorityOrder && params.priorityOrder.length > 0) {
    const requestedSeats = params.seatCount
      ? Math.min(Math.max(Math.round(params.seatCount), 1), Math.min(6, available.length))
      : Math.min(3, available.length);
    const seen = new Set<string>();
    const picked: ModelInfo[] = [];

    const takeTopForProvider = async (pid: ProviderId): Promise<ModelInfo | null> => {
      for (const m of rankedPool) {
        if (m.provider !== pid || seen.has(m.compositeId)) continue;
        seen.add(m.compositeId);
        if (await isCandidateUsable(m)) {
          return m;
        }
      }
      return null;
    };

    const takeTopAny = async (): Promise<ModelInfo | null> => {
      for (const m of rankedPool) {
        if (seen.has(m.compositeId)) continue;
        seen.add(m.compositeId);
        if (await isCandidateUsable(m)) {
          return m;
        }
      }
      return null;
    };

    for (let slot = 0; slot < requestedSeats; slot++) {
      const targetPid = params.priorityOrder[slot % params.priorityOrder.length];
      let chosenModel = await takeTopForProvider(targetPid);
      if (!chosenModel) {
        for (const fallbackPid of params.priorityOrder) {
          if (fallbackPid === targetPid) continue;
          chosenModel = await takeTopForProvider(fallbackPid);
          if (chosenModel) break;
        }
      }
      if (!chosenModel) {
        chosenModel = await takeTopAny();
      }
      if (chosenModel) {
        picked.push(chosenModel);
      }
    }

    if (picked.length === 0) {
      throw new Error(
        `No working models passed live inference verification.${failedProbes.length > 0 ? ` (${failedProbes.slice(0, 3).join(' | ')})` : ''} Status: ${statusParts}.`,
      );
    }
    if (picked.length === 1 && params.mode !== 'chat') {
      throw new Error(
        `Multi-model ${params.mode === 'debate' ? 'Structured Debate' : 'Free Discussion'} requires at least 2 usable models, but only 1 (${picked[0].compositeId}) passed verification. Status: ${statusParts}.`,
      );
    }

    const bestMod =
      [...picked].sort(
        (a, b) =>
          TIER_RANK[b.tier || inferModelTier(b.modelId)] -
          TIER_RANK[a.tier || inferModelTier(a.modelId)],
      )[0]?.compositeId || picked[0].compositeId;

    const warnings = [...preflight.warnings];
    if (failedProbes.length > 0) {
      warnings.push(`Skipped unresponsive models: ${failedProbes.slice(0, 3).join('; ')}`);
    }

    return {
      selectedModels: picked.map((m) => m.compositeId),
      moderatorModel: params.mode === 'chat' ? 'none' : bestMod,
      intelligenceLevel,
      rationale: `${INTELLIGENCE_LEVEL_META[intelligenceLevel].label} intelligence auto-filled ${picked.length} seats following priority order (${params.priorityOrder.join(' → ')}).`,
      warnings: Array.from(new Set(warnings)),
      method: 'capability_heuristic',
      singleModelMode: picked.length === 1,
      freeOnly,
    };
  }

  const fallback = selectModelsHeuristically(
    available,
    params.prompt,
    params.mode,
    intelligenceLevel,
    preflight.warnings,
    { freeOnly },
  );

  const uniqueProviderCount = new Set(available.map((m) => m.provider)).size;
  const requestedSeatTarget = params.seatCount
    ? Math.min(Math.max(Math.round(params.seatCount), 2), Math.min(6, available.length))
    : null;
  const desiredCount =
    requestedSeatTarget ??
    (intelligenceLevel === 'low'
      ? Math.min(2, available.length)
      : intelligenceLevel === 'extreme'
        ? Math.min(4, available.length)
        : Math.min(Math.max(3, Math.min(4, uniqueProviderCount)), available.length));

  const desiredCountDesc =
    intelligenceLevel === 'low'
      ? '2 fast, cost-efficient models'
      : intelligenceLevel === 'extreme'
        ? '3 to 4 deepest-reasoning models'
        : `${desiredCount} complementary models across connected providers`;

  const candidateSummary = buildBalancedRouterCandidates(rankedPool, 30)
    .map(
      (m) =>
        `- ${m.compositeId} [provider=${m.provider}, tier=${m.tier || inferModelTier(m.modelId)}, free=${isModelFreeTier(m) ? 'yes' : 'no'}]: ${m.description} (${m.capabilities.join(', ')})`,
    )
    .join('\n');

  const routerInstruction = [
    'You are the Smart Model Router for T.U.T AI Council.',
    `Intelligence Level: ${intelligenceLevel.toUpperCase()} — ${INTELLIGENCE_LEVEL_META[intelligenceLevel].shortDescription}`,
    `Select ${desiredCountDesc} strictly from the exact candidate compositeIds listed.`,
    'Rules:',
    '- Prioritize cross-provider diversity when multiple providers exist (include connected free-tier providers like openrouter, groq, cerebras, mistral, google whenever listed); otherwise select diverse tiers from the same provider.',
    '- Match model tier and cost to the intelligence level: for LOW avoid expensive/extreme models; for MEDIUM balance capability and speed; for HIGH prioritize strong coding/analysis models; for EXTREME prioritize deepest reasoning models.',
    '- Return ONLY exact compositeIds from the candidate list.',
  ].join('\n');

  const userTask = `Mode: ${params.mode}\nIntelligence Level: ${intelligenceLevel}\nFree Only: ${freeOnly}\nUser Prompt: "${params.prompt.slice(0, 1200)}"\n\nAvailable Candidates:\n${candidateSummary}`;

  const tryParseAndValidate = (raw: {
    selectedModels?: string[];
    moderatorModel?: string;
    rationale?: string;
  }): SmartSelectResult | null => {
    const cleanIds = Array.from(
      new Set((raw.selectedModels || []).filter((id) => availableMap.has(id))),
    ).slice(0, 4);
    const chosenModels = cleanIds.map((id) => availableMap.get(id)!).filter(Boolean);

    if (!isRouterSelectionCompatible(chosenModels, available, intelligenceLevel)) {
      return null;
    }

    const mod =
      params.mode === 'chat'
        ? 'none'
        : raw.moderatorModel && availableMap.has(raw.moderatorModel)
          ? raw.moderatorModel
          : cleanIds[0];

    return {
      selectedModels: cleanIds,
      moderatorModel: mod,
      intelligenceLevel,
      rationale: (raw.rationale || fallback.rationale).slice(0, 260),
      warnings: preflight.warnings,
      method: 'ai_router',
      singleModelMode: false,
      freeOnly,
    };
  };

  // Only ask an already inference_ready model to act as router so we never auto-test untouched models before chat
  const healthyProviders = PROVIDER_IDS.filter(
    (pid) =>
      getProviderHealth(params.uid, pid).state === 'inference_ready' &&
      available.some((m) => m.provider === pid && m.availabilityState === 'inference_ready'),
  );

  for (const routerPid of healthyProviders) {
    const cfg = getProviderConfig(routerPid);
    const apiKey = await resolveKey(params.uid, params.idToken, routerPid, {
      isPremium: params.isPremium,
    });
    if (!apiKey) continue;

    const routerCandidates = available
      .filter((m) => m.provider === routerPid && m.availabilityState === 'inference_ready')
      .sort(
        (a, b) =>
          TIER_RANK[a.tier || inferModelTier(a.modelId)] -
          TIER_RANK[b.tier || inferModelTier(b.modelId)],
      );
    const routerModel = routerCandidates[0]?.modelId;
    if (!routerModel) continue;

    try {
      if (cfg.kind === 'google') {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });
        const resp = await Promise.race([
          ai.models.generateContent({
            model: routerModel,
            contents: userTask,
            config: {
              systemInstruction: routerInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  selectedModels: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  moderatorModel: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: ['selectedModels', 'rationale'],
              },
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Router timeout')), 4500),
          ),
        ]);
        const parsed = JSON.parse((resp.text || '{}').trim()) as {
          selectedModels?: string[];
          moderatorModel?: string;
          rationale?: string;
        };
        const validated = tryParseAndValidate(parsed);
        if (validated) {
          return verifyAndBuildResult(
            validated.selectedModels,
            validated.moderatorModel,
            Math.max(desiredCount, validated.selectedModels.length),
            'ai_router',
            validated.rationale,
          );
        }
      } else if (cfg.kind === 'anthropic') {
        const client = new Anthropic({ apiKey });
        const resp = await client.messages.create(
          {
            model: routerModel,
            max_tokens: 400,
            system: `${routerInstruction}\nRespond ONLY with raw JSON: {"selectedModels": string[], "moderatorModel": string, "rationale": string}`,
            messages: [{ role: 'user', content: userTask }],
          },
          { signal: AbortSignal.timeout(4500) },
        );
        const textBlock = resp.content.find((b) => b.type === 'text');
        const rawJson = (textBlock && 'text' in textBlock ? textBlock.text : '{}').replace(
          /^```json\s*|\s*```$/g,
          '',
        );
        const parsed = JSON.parse(rawJson) as {
          selectedModels?: string[];
          moderatorModel?: string;
          rationale?: string;
        };
        const validated = tryParseAndValidate(parsed);
        if (validated) {
          return verifyAndBuildResult(
            validated.selectedModels,
            validated.moderatorModel,
            Math.max(desiredCount, validated.selectedModels.length),
            'ai_router',
            validated.rationale,
          );
        }
      } else {
        const client = new OpenAI({ apiKey, baseURL: cfg.baseURL });
        const routerMessages = [
          {
            role: 'system' as const,
            content: `${routerInstruction}\nRespond ONLY with raw JSON: {"selectedModels": string[], "moderatorModel": string, "rationale": string}`,
          },
          { role: 'user' as const, content: userTask },
        ];
        let resp;
        try {
          resp = await client.chat.completions.create(
            {
              model: routerModel,
              response_format: { type: 'json_object' },
              messages: routerMessages,
            },
            { signal: AbortSignal.timeout(4500) },
          );
        } catch (routerErr) {
          const rMsg = String(
            routerErr instanceof Error ? routerErr.message : routerErr,
          ).toLowerCase();
          if (rMsg.includes('response_format') || rMsg.includes('json_object') || rMsg.includes('json')) {
            resp = await client.chat.completions.create(
              {
                model: routerModel,
                messages: routerMessages,
              },
              { signal: AbortSignal.timeout(4500) },
            );
          } else {
            throw routerErr;
          }
        }
        const rawContent = (resp.choices[0]?.message?.content || '{}')
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/^```json\s*|\s*```$/gi, '')
          .trim();
        const jsonObjMatch = /\{[\s\S]*\}/.exec(rawContent);
        const parsed = JSON.parse(jsonObjMatch ? jsonObjMatch[0] : rawContent) as {
          selectedModels?: string[];
          moderatorModel?: string;
          rationale?: string;
        };
        const validated = tryParseAndValidate(parsed);
        if (validated) {
          return verifyAndBuildResult(
            validated.selectedModels,
            validated.moderatorModel,
            Math.max(desiredCount, validated.selectedModels.length),
            'ai_router',
            validated.rationale,
          );
        }
      }
    } catch (err) {
      const classified = classifyProviderError(err, routerPid, apiKey);
      if (classified.category === 'invalid_model') {
        recordModelUnavailable(
          params.uid,
          `${routerPid}:${routerModel}`,
          classified.summary,
          classified.category,
        );
      }
    }
  }

  return verifyAndBuildResult(
    fallback.selectedModels,
    fallback.moderatorModel,
    desiredCount,
    'capability_heuristic',
    fallback.rationale,
  );
}
