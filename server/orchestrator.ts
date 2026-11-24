import crypto from 'node:crypto';
import {
  getProviderConfig,
  isFreeRateLimitedProvider,
  isValidProviderId,
  PROVIDER_IDS,
  PROVIDER_REGISTRY,
} from '../src/shared/providers.ts';
import {
  CURATED_REACTION_EMOJIS,
  REACTION_PACK_CATEGORIES,
  type CouncilSSEEvent,
  type CouncilStatus,
  type DiscussionMode,
  type ErrorCategory,
  type IntelligenceLevel,
  type MessageReaction,
  type ModelInfo,
  type PreflightReport,
  type ProviderId,
  type ReplyToRef,
  type RunMessageInput,
} from '../src/shared/types.ts';
import { getCatalogForUser, probeSingleModel } from './modelCatalogService.ts';
import {
  classifyProviderError,
  formatClassifiedError,
  getProviderHealth,
  recordModelAccessVerified,
  recordModelUnavailable,
  recordProviderHealth,
} from './modelHealth.ts';
import { runCouncilPreflight } from './preflight.ts';
import {
  completeShortAnthropicPrompt,
  streamAnthropicResponse,
} from './providers/anthropic.ts';
import {
  completeShortGeminiPrompt,
  streamGeminiResponse,
} from './providers/gemini.ts';
import {
  completeShortOpenAIPrompt,
  streamOpenAIResponse,
} from './providers/openai.ts';
import { rankFallbackCandidates } from './smartSelect.ts';
import { resolveRuntimeApiKey } from './vault.ts';

export const DEFAULT_COUNCIL_TURN_DELAY_MS = 1500;

export interface ReactionEvalInput {
  apiKey: string;
  provider: ProviderId;
  modelId: string;
  modelLabel: string;
  contextText: string;
  ownReply: string;
  lastHandle: string;
  availableHandles: string[];
  signal: AbortSignal;
}

export interface OrchestratorDeps {
  resolveKey?: typeof resolveRuntimeApiKey;
  getCatalog?: typeof getCatalogForUser;
  probeModel?: typeof probeSingleModel;
  runPreflight?: (p: {
    uid: string;
    idToken: string;
    targetCompositeIds?: string[];
    isPremium?: boolean;
  }) => Promise<PreflightReport>;
  invokeStream?: typeof invokeModelStream;
  evaluateReaction?: (
    params: ReactionEvalInput,
  ) => Promise<{ targetHandle: string; emoji: string } | null>;
  retryDelayMs?: number;
  turnDelayMs?: number;
}

const activeControllers = new Map<string, AbortController>();

function makeRunKey(uid: string, councilId: string): string {
  return `${uid}:${councilId}`;
}

export function stopCouncilRun(uid: string, councilId: string): boolean {
  const key = makeRunKey(uid, councilId);
  const controller = activeControllers.get(key);
  if (!controller) return false;
  controller.abort();
  activeControllers.delete(key);
  return true;
}

export function parseCompositeModel(compositeId: string): {
  provider: ProviderId;
  modelId: string;
  label: string;
} {
  const idx = compositeId.indexOf(':');
  if (idx === -1) {
    return {
      provider: 'google',
      modelId: compositeId,
      label: `Google Gemini · ${compositeId}`,
    };
  }
  const raw = compositeId.slice(0, idx);
  const provider: ProviderId = isValidProviderId(raw) ? raw : 'google';
  const modelId = compositeId.slice(idx + 1);
  const providerName = PROVIDER_REGISTRY[provider]?.name || raw;
  return {
    provider,
    modelId,
    label: `${providerName} · ${modelId}`,
  };
}

interface TranscriptEntry {
  id?: string;
  role: 'user' | 'model' | 'moderator';
  provider: string;
  modelId: string;
  modelLabel: string;
  round: number;
  stageLabel: string;
  content: string;
  replyTo?: ReplyToRef;
}

function orderSpeakersForReply(models: string[], replyTo?: ReplyToRef): string[] {
  if (!replyTo || replyTo.role === 'user' || replyTo.provider === 'user') {
    return [...models];
  }
  const targetComposite = `${replyTo.provider}:${replyTo.modelId}`;
  const idx = models.indexOf(targetComposite);
  if (idx <= 0) {
    return [...models];
  }
  return [models[idx], ...models.slice(0, idx), ...models.slice(idx + 1)];
}

function buildReplyTurnGuidance(
  replyTo: ReplyToRef | undefined,
  speakerCompositeId: string,
  targetInRoster: boolean,
): string | null {
  if (!replyTo) return null;
  const targetComposite =
    replyTo.role !== 'user' && replyTo.provider !== 'user'
      ? `${replyTo.provider}:${replyTo.modelId}`
      : null;
  const snippet = replyTo.snippet.replace(/\s+/g, ' ').trim().slice(0, 220);

  if (targetComposite && targetComposite === speakerCompositeId) {
    return `Important: The user replied directly to YOUR earlier message ("${snippet}"). You are speaking first—answer their reply directly.`;
  }
  if (targetComposite && targetInRoster) {
    return `Note: The user replied directly to ${replyTo.modelLabel}'s message ("${snippet}"), so ${replyTo.modelLabel} spoke first. Add a helpful human follow-up or fresh angle if relevant.`;
  }
  return `Note: The user replied directly to ${replyTo.modelLabel}'s earlier message ("${snippet}"). Keep that quoted message central in your answer.`;
}

const MAX_AI_REACTIONS_PER_MESSAGE = 6;

function normalizeEmojiForMatch(raw: string): string {
  // Strip variation selector-16 and skin tone modifiers for canonical matching
  return raw.replace(/\uFE0F/g, '').replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '').trim();
}

const ALL_PACK_EMOJIS = Array.from(
  new Set<string>([
    ...CURATED_REACTION_EMOJIS,
    ...REACTION_PACK_CATEGORIES.flatMap((cat) => [...cat.emojis]),
  ]),
);

const CANONICAL_EMOJI_MAP = new Map<string, string>(
  ALL_PACK_EMOJIS.map((e) => [normalizeEmojiForMatch(e), e]),
);

const EMOJI_GRAPHEME_REGEX = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}][\uFE0F\u200D\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*$/u;

function resolveValidReactionEmoji(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 16) return null;
  const canonical = CANONICAL_EMOJI_MAP.get(normalizeEmojiForMatch(trimmed));
  if (canonical) return canonical;
  if (EMOJI_GRAPHEME_REGEX.test(trimmed)) return trimmed;
  return null;
}

const REACTION_TAG_DOUBLE_PATTERN =
  /^`?\[\[\s*REACT\s*[:\s]+(?:to\s+)?(m\d+)\s*(?:[,:|>\-\s]+)\s*([^\s\]`]+)\s*\]\]`?/i;
const REACTION_TAG_SINGLE_PATTERN =
  /^`?\[\s*REACT\s*[:\s]+(?:to\s+)?(m\d+)\s*(?:[,:|>\-\s]+)\s*([^\s\]`]+)\s*\]`?/i;
const REACTION_TAG_GLOBAL_PATTERN =
  /`?\[\[\s*REACT\s*[:\s]+(?:to\s+)?(m\d+)\s*(?:[,:|>\-\s]+)\s*([^\s\]`]+)\s*\]\]`?|`?\[\s*REACT\s*[:\s]+(?:to\s+)?(m\d+)\s*(?:[,:|>\-\s]+)\s*([^\s\]`]+)\s*\]`?/gi;

const LEADING_CURATED_EMOJI_PATTERN =
  /^([\p{Extended_Pictographic}\p{Emoji_Presentation}][\uFE0F\u200D\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*)(?:$|\s+(?![:=]|(?:is|means|stands|represents)\b))/u;

function matchLeadingReactionTag(slice: string): {
  length: number;
  handle: string;
  emoji: string;
} | null {
  const cleanStart = slice.startsWith('`') ? slice.slice(1) : slice;
  if (cleanStart.startsWith('[[')) {
    const m = REACTION_TAG_DOUBLE_PATTERN.exec(slice);
    return m ? { length: m[0].length, handle: m[1].toLowerCase(), emoji: m[2] } : null;
  }
  const m = REACTION_TAG_SINGLE_PATTERN.exec(slice);
  return m ? { length: m[0].length, handle: m[1].toLowerCase(), emoji: m[2] } : null;
}

function formatTranscriptWithHandles(
  entries: TranscriptEntry[],
  selfCompositeId?: string,
  maxChars = 28000,
): { text: string; handleMap: Map<string, string>; lastHandle: string | null } {
  const handleMap = new Map<string, string>();
  const eligibleIndices: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.id || !e.content.trim()) continue;
    const isSelf =
      e.role !== 'user' && selfCompositeId && `${e.provider}:${e.modelId}` === selfCompositeId;
    if (isSelf) continue;
    eligibleIndices.push(i);
  }
  const recentEligible = eligibleIndices.slice(-5);
  const indexToHandle = new Map<number, string>();
  let lastHandle: string | null = null;
  recentEligible.forEach((entryIdx, pos) => {
    const handle = `m${pos + 1}`;
    indexToHandle.set(entryIdx, handle);
    const id = entries[entryIdx].id;
    if (id) {
      handleMap.set(handle, id);
      lastHandle = handle;
    }
  });

  const lines = entries.map((e, idx) => {
    const h = indexToHandle.get(idx);
    const prefix = h ? `[${h}] ` : '';
    const header =
      e.role === 'user'
        ? `${prefix}[User Prompt · Round ${e.round}]`
        : `${prefix}[${e.modelLabel} · ${e.stageLabel}]`;
    const replyQuoteLine = e.replyTo
      ? `↳ Replying to ${e.replyTo.modelLabel}: "${e.replyTo.snippet.replace(/\s+/g, ' ').trim().slice(0, 200)}"\n`
      : '';
    return `${header}\n${replyQuoteLine}${e.content.trim()}`;
  });
  const combined = lines.join('\n\n---\n\n');
  if (combined.length <= maxChars) return { text: combined, handleMap, lastHandle };
  return {
    text: `...[earlier context truncated for length]...\n\n${combined.slice(-maxChars)}`,
    handleMap,
    lastHandle,
  };
}

function formatTranscript(entries: TranscriptEntry[], maxChars = 28000): string {
  return formatTranscriptWithHandles(entries, undefined, maxChars).text;
}

function extractAllReactionTags(text: string): {
  tags: Array<{ handle: string; emoji: string }>;
  cleanedText: string;
} {
  const tags: Array<{ handle: string; emoji: string }> = [];
  const cleanedText = text
    .replace(
      REACTION_TAG_GLOBAL_PATTERN,
      (_full, h1?: string, e1?: string, h2?: string, e2?: string) => {
        const handle = h1 || h2;
        const emoji = e1 || e2;
        if (handle && emoji) {
          tags.push({ handle: handle.toLowerCase(), emoji });
        }
        return '';
      },
    )
    .replace(/^[ \t]*\r?\n/, '')
    .trim();
  return { tags, cleanedText };
}

function buildReactionInstruction(
  handleMap: Map<string, string>,
  lastHandle: string | null,
): string | null {
  if (handleMap.size === 0) return null;
  const exHandle = lastHandle || 'm1';
  return [
    'Recent messages above are prefixed with handle tags like [m1], [m2].',
    `When a message warrants a genuine human-like reaction (funny, insightful, impressive, or strong agreement), attach a reaction badge UNDER that message by placing [[REACT mX emoji]] at the VERY START of your output using one of: ${CURATED_REACTION_EMOJIS.join(' ')}.`,
    `Example: "[[REACT ${exHandle} 🔥]] Smart approach — you can also cache the token." or pure reaction "${`[[REACT ${exHandle} 👍]]`}" with no extra words.`,
    'Rules: [[REACT mX emoji]] is stripped from your reply and shown underneath message mX itself (like Discord/Messenger reactions). Never write a reaction emoji at the start of your reply text or describe reacting in prose. Be selective (~30% of turns when it naturally fits).',
  ].join(' ');
}

async function invokeModelStream(params: {
  apiKey: string;
  provider: ProviderId;
  modelId: string;
  systemInstruction: string;
  prompt: string;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}) {
  const cfg = getProviderConfig(params.provider);
  if (cfg.kind === 'google') {
    return streamGeminiResponse(params);
  }
  if (cfg.kind === 'anthropic') {
    return streamAnthropicResponse(params);
  }
  return streamOpenAIResponse({
    ...params,
    provider: params.provider,
    baseURL: cfg.baseURL,
  });
}

async function invokeModelReactionEval(
  params: ReactionEvalInput,
): Promise<{ targetHandle: string; emoji: string } | null> {
  if (params.signal.aborted || params.availableHandles.length === 0) return null;
  const trimmedContext = params.contextText.slice(-3200);
  const trimmedReply = params.ownReply.slice(0, 600);
  const sys = [
    `You are ${params.modelLabel} participating in a group chat.`,
    'Decide intelligently like a human in Discord/Messenger/WhatsApp whether to tap ONE emoji reaction onto any recent message (including the user message [m1] or a peer message).',
    'Output ONLY strict JSON: {"react":true,"target":"m1","emoji":"🔥"} or {"react":false}.',
  ].join('\n');
  const prompt = [
    'Recent messages (with handle tags like [m1], [m2]):',
    trimmedContext,
    '',
    `Your reply: ${trimmedReply || '(none)'}`,
    '',
    `Valid targets: ${params.availableHandles.join(', ')}`,
    `Preferred emojis: ${CURATED_REACTION_EMOJIS.join(' ')}`,
    'React whenever a message is warm, welcoming, funny, impressive, thoughtful, relatable, celebratory, or makes a strong point. Skip reacting only if the exchange is strictly dry/routine.',
    `Return ONLY JSON, e.g. {"react":true,"target":"${params.lastHandle}","emoji":"👍"} or {"react":false}.`,
  ].join('\n');

  const cfg = getProviderConfig(params.provider);
  let raw = '';
  if (cfg.kind === 'google') {
    raw = await completeShortGeminiPrompt({
      apiKey: params.apiKey,
      modelId: params.modelId,
      systemInstruction: sys,
      prompt,
      timeoutMs: 4500,
    });
  } else if (cfg.kind === 'anthropic') {
    raw = await completeShortAnthropicPrompt({
      apiKey: params.apiKey,
      modelId: params.modelId,
      systemInstruction: sys,
      prompt,
      timeoutMs: 4500,
    });
  } else {
    raw = await completeShortOpenAIPrompt({
      apiKey: params.apiKey,
      provider: params.provider,
      baseURL: cfg.baseURL,
      modelId: params.modelId,
      systemInstruction: sys,
      prompt,
      timeoutMs: 4500,
    });
  }

  const cleanedRaw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const jsonMatch = /\{[\s\S]*?\}/.exec(cleanedRaw);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      react?: boolean;
      target?: string;
      emoji?: string;
    };
    if (!parsed || parsed.react !== true) return null;
    const target = typeof parsed.target === 'string' ? parsed.target.trim().toLowerCase() : '';
    const emoji = typeof parsed.emoji === 'string' ? parsed.emoji.trim() : '';
    if (!target || !params.availableHandles.includes(target)) return null;
    if (!resolveValidReactionEmoji(emoji)) return null;
    return { targetHandle: target, emoji };
  } catch {
    return null;
  }
}

function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runCouncilEngine(params: {
  uid: string;
  idToken: string;
  councilId: string;
  mode: DiscussionMode;
  intelligenceLevel?: IntelligenceLevel;
  enableFallback?: boolean;
  isPremium?: boolean;
  selectedModels: string[];
  moderatorModel: string;
  maxRounds: number;
  startRound: number;
  priorMessages: RunMessageInput[];
  userPrompt: string;
  userMessageId?: string;
  replyTo?: ReplyToRef;
  moderateOnly?: boolean;
  emit: (event: CouncilSSEEvent) => void;
  deps?: OrchestratorDeps;
}): Promise<void> {
  const resolveKeyFn = params.deps?.resolveKey || resolveRuntimeApiKey;
  const getCatalogFn = params.deps?.getCatalog || getCatalogForUser;
  const probeModelFn = params.deps?.probeModel || probeSingleModel;
  const runPreflightFn = params.deps?.runPreflight || runCouncilPreflight;
  const invokeStreamFn = params.deps?.invokeStream || invokeModelStream;
  const evaluateReactionFn =
    params.deps?.evaluateReaction ||
    (params.deps?.invokeStream ? async () => null : invokeModelReactionEval);
  const turnDelayMs =
    params.deps?.turnDelayMs !== undefined ? params.deps.turnDelayMs : DEFAULT_COUNCIL_TURN_DELAY_MS;

  const runKey = makeRunKey(params.uid, params.councilId);
  const existingController = activeControllers.get(runKey);
  if (existingController) {
    existingController.abort();
  }
  const controller = new AbortController();
  activeControllers.set(runKey, controller);

  const intelligenceLevel: IntelligenceLevel = params.intelligenceLevel || 'low';
  const fallbackEnabled = params.enableFallback !== false;
  const clampedMaxRounds = Math.min(Math.max(params.maxRounds, 1), 6);

  const transcript: TranscriptEntry[] = params.priorMessages
    .filter((m) => m.status === 'completed' && m.content.trim().length > 0)
    .map((m) => ({
      id: m.id,
      role: m.role,
      provider: m.provider,
      modelId: m.modelId,
      modelLabel: m.modelLabel,
      round: m.round,
      stageLabel: m.stageLabel,
      content: m.content,
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    }));

  if (params.userPrompt.trim()) {
    transcript.push({
      id: params.userMessageId,
      role: 'user',
      provider: 'user',
      modelId: 'user',
      modelLabel: 'Council Member (User)',
      round: params.startRound,
      stageLabel: 'User Question',
      content: params.userPrompt.trim(),
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    });
  }

  const reactionsPerTarget = new Map<string, number>();
  const emittedReactionKeys = new Set<string>();
  const reactionEvalBlockedProviders = new Set<ProviderId>();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedCostUsd = 0;
  let currentRound = params.startRound;
  let completedTurnCount = 0;
  let failedTurnCount = 0;
  let finalStatus: CouncilStatus = 'completed';

  const keyMap = new Map<ProviderId, string | null>();
  await Promise.all(
    PROVIDER_IDS.map(async (provider) => {
      keyMap.set(
        provider,
        await resolveKeyFn(params.uid, params.idToken, provider, { isPremium: params.isPremium }),
      );
    }),
  );

  let cachedCatalogModels: ModelInfo[] | null = null;
  const getCatalogAvailable = async (refresh = false): Promise<ModelInfo[]> => {
    if (!cachedCatalogModels || refresh) {
      try {
        const cat = await getCatalogFn(params.uid, params.idToken, {
          isPremium: params.isPremium,
        });
        cachedCatalogModels = cat.models.filter((m) => m.available);
      } catch {
        cachedCatalogModels = [];
      }
    }
    return cachedCatalogModels;
  };

  // Verified Fallback Resolver: verifies candidate with probeSingleModel BEFORE choosing it
  const resolveVerifiedFallback = async (opts: {
    excludedIds: Set<string>;
    failedProvider: ProviderId;
    errorCategory: ErrorCategory | 'disconnected';
    promptText: string;
  }): Promise<ModelInfo | null> => {
    const candidatesPool = await getCatalogAvailable();
    const blockedProviders = new Set<ProviderId>();
    for (const p of PROVIDER_IDS) {
      const h = getProviderHealth(params.uid, p);
      if (
        h.state === 'insufficient_credits' ||
        h.state === 'invalid_credentials' ||
        h.state === 'unavailable'
      ) {
        blockedProviders.add(p);
      }
      if (!keyMap.get(p)) {
        blockedProviders.add(p);
      }
    }

    const ranked = rankFallbackCandidates({
      availableModels: candidatesPool,
      excludedCompositeIds: opts.excludedIds,
      blockedProviders,
      intelligenceLevel,
      prompt: opts.promptText,
      mode: params.mode,
      preferCrossProviderFrom: opts.failedProvider,
    });

    for (const candidate of ranked) {
      if (controller.signal.aborted) return null;
      const candKey = keyMap.get(candidate.provider);
      if (!candKey) continue;
      opts.excludedIds.add(candidate.compositeId);

      const probe = await probeModelFn(
        params.uid,
        candidate.provider,
        candKey,
        candidate.modelId,
      );
      if (probe.ok) {
        return candidate;
      }
    }
    return null;
  };

  try {
    // 1. Live availability & provider health gate (does not auto-probe untouched models before chat)
    const targetsToVerify = Array.from(
      new Set([
        ...params.selectedModels,
        ...(params.mode !== 'chat' && params.moderatorModel !== 'none'
          ? [params.moderatorModel]
          : []),
      ]),
    );

    const preflight = await runPreflightFn({
      uid: params.uid,
      idToken: params.idToken,
      targetCompositeIds: targetsToVerify,
      isPremium: params.isPremium,
    });

    const readySet = new Set(preflight.readyModels.map((m) => m.compositeId));
    const rejectedMap = new Map(preflight.rejectedModels.map((r) => [r.compositeId, r]));

    params.emit({
      type: 'preflight_summary',
      readyModels: Array.from(readySet),
      rejectedModels: preflight.rejectedModels,
      warnings: preflight.warnings,
    });

    const effectiveModels: string[] = [];
    const claimedIds = new Set<string>(readySet);
    const removedModels: Array<{ compositeId: string; reason: string }> = [];
    let preflightRosterChanged = false;

    const recordRemovedModel = (compositeId: string, reason: string) => {
      if (!removedModels.some((r) => r.compositeId === compositeId)) {
        removedModels.push({ compositeId, reason });
      }
      const idx = effectiveModels.indexOf(compositeId);
      if (idx !== -1) {
        effectiveModels.splice(idx, 1);
      }
    };

    for (const reqId of params.selectedModels) {
      if (readySet.has(reqId)) {
        if (!effectiveModels.includes(reqId)) {
          effectiveModels.push(reqId);
        }
        continue;
      }
      preflightRosterChanged = true;
      const rejected = rejectedMap.get(reqId);
      const parsedOrig = parseCompositeModel(reqId);
      const errCategory = rejected?.errorCategory || 'invalid_model';
      const errReason = rejected?.reason || 'Model failed availability check.';

      if (fallbackEnabled) {
        const replacement = await resolveVerifiedFallback({
          excludedIds: claimedIds,
          failedProvider: parsedOrig.provider,
          errorCategory: errCategory,
          promptText: params.userPrompt,
        });

        if (replacement) {
          const repParsed = parseCompositeModel(replacement.compositeId);
          if (!effectiveModels.includes(replacement.compositeId)) {
            effectiveModels.push(replacement.compositeId);
          }
          params.emit({
            type: 'model_fallback',
            originalCompositeId: reqId,
            originalModelLabel: parsedOrig.label,
            fallbackCompositeId: replacement.compositeId,
            fallbackModelLabel: repParsed.label,
            errorCategory: errCategory,
            reason: errReason,
            round: params.mode === 'chat' ? 0 : params.startRound,
          });
          continue;
        }
      }

      recordRemovedModel(reqId, errReason);
      const errMsgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      failedTurnCount += 1;
      params.emit({
        type: 'model_error',
        messageId: errMsgId,
        role: 'model',
        provider: parsedOrig.provider,
        modelId: parsedOrig.modelId,
        modelLabel: parsedOrig.label,
        round: params.mode === 'chat' ? 0 : params.startRound,
        stageLabel: 'Preflight Verification',
        errorMessage: errReason,
        errorCode: errCategory,
        latencyMs: 0,
      });
    }

    let effectiveModerator = params.moderatorModel;

    if (effectiveModels.length === 0) {
      if (removedModels.length > 0) {
        params.emit({
          type: 'roster_updated',
          selectedModels: [],
          moderatorModel: effectiveModerator,
          removedModels: [...removedModels],
        });
      }
      finalStatus = 'error';
      const detail =
        preflight.warnings.length > 0
          ? preflight.warnings.join(' | ')
          : preflight.rejectedModels.map((r) => `${r.compositeId}: ${r.reason}`).join(' | ');
      params.emit({
        type: 'fatal_error',
        message: `Preflight check failed: no usable models could run.${detail ? ` (${detail})` : ''} Check Connections to resolve provider credentials or credits.`,
      });
      return;
    }

    if (params.mode !== 'chat' && !params.moderateOnly) {
      if (!readySet.has(effectiveModerator) && !effectiveModels.includes(effectiveModerator)) {
        const modParsed = parseCompositeModel(effectiveModerator);
        const modRejected = rejectedMap.get(effectiveModerator);
        const replacementMod =
          effectiveModels[0] ||
          (
            await resolveVerifiedFallback({
              excludedIds: new Set([effectiveModerator]),
              failedProvider: modParsed.provider,
              errorCategory: modRejected?.errorCategory || 'invalid_model',
              promptText: params.userPrompt,
            })
          )?.compositeId;

        if (replacementMod && replacementMod !== effectiveModerator) {
          preflightRosterChanged = true;
          const repParsed = parseCompositeModel(replacementMod);
          params.emit({
            type: 'model_fallback',
            originalCompositeId: effectiveModerator,
            originalModelLabel: modParsed.label,
            fallbackCompositeId: replacementMod,
            fallbackModelLabel: repParsed.label,
            errorCategory: modRejected?.errorCategory || 'invalid_model',
            reason: modRejected?.reason || 'Moderator unavailable.',
            round: params.startRound,
          });
          effectiveModerator = replacementMod;
        }
      }
    }

    const emitRosterUpdated = () => {
      params.emit({
        type: 'roster_updated',
        selectedModels: [...effectiveModels],
        moderatorModel: effectiveModerator,
        removedModels: [...removedModels],
      });
    };

    const removeActiveModel = (compositeId: string, reason: string) => {
      const idx = effectiveModels.indexOf(compositeId);
      if (idx !== -1) {
        effectiveModels.splice(idx, 1);
      }
      if (!removedModels.some((r) => r.compositeId === compositeId)) {
        removedModels.push({ compositeId, reason });
      }
      if (effectiveModerator === compositeId && effectiveModels.length > 0) {
        effectiveModerator = effectiveModels[0];
      }
      emitRosterUpdated();
    };

    const replaceActiveModel = (oldId: string, newId: string) => {
      const idx = effectiveModels.indexOf(oldId);
      if (idx !== -1) {
        if (effectiveModels.includes(newId)) {
          effectiveModels.splice(idx, 1);
        } else {
          effectiveModels[idx] = newId;
        }
      }
      if (effectiveModerator === oldId) {
        effectiveModerator = newId;
      }
      emitRosterUpdated();
    };

    if (preflightRosterChanged) {
      emitRosterUpdated();
    }

    const runSingleTurn = async (opts: {
      compositeId: string;
      role: 'model' | 'moderator';
      round: number;
      stageLabel: string;
      systemInstruction: string;
      prompt: string;
      handleMap?: Map<string, string>;
      lastHandle?: string | null;
    }): Promise<{
      entry: TranscriptEntry | null;
      errorCategory?: ErrorCategory | 'disconnected';
      errorSummary?: string;
    }> => {
      const { provider, modelId, label } = parseCompositeModel(opts.compositeId);
      const messageId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const apiKey = keyMap.get(provider) || null;

      if (!apiKey) {
        failedTurnCount += 1;
        const summary = `Provider "${provider}" is not connected.`;
        params.emit({
          type: 'model_error',
          messageId,
          role: opts.role,
          provider,
          modelId,
          modelLabel: label,
          round: opts.round,
          stageLabel: opts.stageLabel,
          errorMessage: summary,
          errorCode: 'disconnected',
          latencyMs: 0,
        });
        return { entry: null, errorCategory: 'disconnected', errorSummary: summary };
      }

      const preHealth = getProviderHealth(params.uid, provider);
      if (
        !isFreeRateLimitedProvider(provider) &&
        (preHealth.state === 'insufficient_credits' ||
          preHealth.state === 'invalid_credentials' ||
          preHealth.state === 'unavailable')
      ) {
        failedTurnCount += 1;
        const summary =
          preHealth.message ||
          `Provider "${provider}" is temporarily paused (${preHealth.state}) for up to 5 minutes.`;
        params.emit({
          type: 'model_error',
          messageId,
          role: opts.role,
          provider,
          modelId,
          modelLabel: label,
          round: opts.round,
          stageLabel: opts.stageLabel,
          errorMessage: summary,
          errorCode: preHealth.errorCategory || 'insufficient_credits',
          latencyMs: 0,
        });
        return {
          entry: null,
          errorCategory: preHealth.errorCategory || 'insufficient_credits',
          errorSummary: summary,
        };
      }

      params.emit({
        type: 'model_start',
        messageId,
        role: opts.role,
        provider,
        modelId,
        modelLabel: label,
        round: opts.round,
        stageLabel: opts.stageLabel,
      });

      const startedAt = Date.now();
      let lastErr: unknown = null;

      const emitValidatedReaction = (tag: { handle: string; emoji: string } | null): boolean => {
        if (!tag || !opts.handleMap) return false;
        const targetMessageId = opts.handleMap.get(tag.handle);
        if (!targetMessageId) return false;
        const resolvedEmoji = resolveValidReactionEmoji(tag.emoji);
        if (!resolvedEmoji) return false;
        const currentCount = reactionsPerTarget.get(targetMessageId) || 0;
        if (currentCount >= MAX_AI_REACTIONS_PER_MESSAGE) return false;
        // One reaction per AI participant per target message (Discord/Messenger/WhatsApp style)
        const reactorTargetKey = `${targetMessageId}::${opts.compositeId}`;
        if (emittedReactionKeys.has(reactorTargetKey)) return false;

        emittedReactionKeys.add(reactorTargetKey);
        reactionsPerTarget.set(targetMessageId, currentCount + 1);
        const reactionObj: MessageReaction = {
          emoji: resolvedEmoji,
          reactorId: opts.compositeId,
          reactorLabel: label,
          reactorType: opts.role,
        };
        params.emit({
          type: 'message_reaction',
          targetMessageId,
          reaction: reactionObj,
        });
        return true;
      };

      const allowLeadingEmojiLift =
        Boolean(opts.handleMap && opts.lastHandle) &&
        !/(emoji|emojis|emoticon|unicode|symbol)/i.test(params.userPrompt);

      // Retry at most ONCE and ONLY for rate_limited or transient_error
      let activePrompt = opts.prompt;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (controller.signal.aborted) break;
        let tagBuffer = '';
        let emittedAnyVisibleText = false;
        let emittedReactionFromStream = false;
        let checkedLeadingEmoji = false;

        const emitVisibleDelta = (chunk: string) => {
          if (!chunk) return;
          const out = emittedAnyVisibleText ? chunk : chunk.replace(/^\s+/, '');
          if (!out) return;
          emittedAnyVisibleText = true;
          params.emit({ type: 'model_delta', messageId, delta: out });
        };

        const looksLikeReactionTagPrefix = (slice: string): boolean => {
          const clean = slice.startsWith('`') ? slice.slice(1) : slice;
          const up = clean.toUpperCase();
          if (!up) return true;
          if ('[[REACT'.startsWith(up) || '[REACT'.startsWith(up)) return true;
          return up.startsWith('[[REACT') || up.startsWith('[REACT');
        };

        const tryLiftLeadingReactionEmoji = (flushAll: boolean): boolean => {
          if (
            checkedLeadingEmoji ||
            emittedAnyVisibleText ||
            emittedReactionFromStream ||
            !allowLeadingEmojiLift ||
            !opts.lastHandle
          ) {
            return false;
          }
          const trimmedStart = tagBuffer.replace(/^\s+/, '');
          if (!trimmedStart) {
            return !flushAll;
          }
          // Wait until we have enough characters to disambiguate "🔥 Great..." vs "🔥 means..."
          if (!flushAll && trimmedStart.length < 12 && !trimmedStart.startsWith('[')) {
            const firstCode = trimmedStart.codePointAt(0) || 0;
            if (firstCode > 0x2000) {
              return true; // keep buffering briefly
            }
          }
          checkedLeadingEmoji = true;
          const leadingMatch = LEADING_CURATED_EMOJI_PATTERN.exec(trimmedStart);
          if (leadingMatch) {
            const lifted = emitValidatedReaction({
              handle: opts.lastHandle,
              emoji: leadingMatch[1],
            });
            if (lifted) {
              emittedReactionFromStream = true;
              tagBuffer = trimmedStart.slice(leadingMatch[0].length).replace(/^\s+/, '');
              return false;
            }
          }
          return false;
        };

        const drainTagBuffer = (flushAll: boolean) => {
          while (tagBuffer.length > 0) {
            const firstBracket = tagBuffer.indexOf('[');
            const firstTickBracket = tagBuffer.indexOf('`[');
            let openIdx = firstBracket;
            if (firstTickBracket !== -1 && (openIdx === -1 || firstTickBracket < openIdx)) {
              openIdx = firstTickBracket;
            }
            if (openIdx === -1) {
              if (tryLiftLeadingReactionEmoji(flushAll)) break;
              emitVisibleDelta(tagBuffer);
              tagBuffer = '';
              break;
            }
            if (openIdx > 0) {
              const beforeBracket = tagBuffer.slice(0, openIdx);
              if (!emittedAnyVisibleText && !checkedLeadingEmoji && allowLeadingEmojiLift) {
                const hold = tryLiftLeadingReactionEmoji(flushAll);
                if (hold) break;
                // Re-enter loop since tagBuffer may have been trimmed
                continue;
              }
              emitVisibleDelta(beforeBracket);
              tagBuffer = tagBuffer.slice(openIdx);
            }

            if (!looksLikeReactionTagPrefix(tagBuffer)) {
              checkedLeadingEmoji = true;
              emitVisibleDelta(tagBuffer[0]);
              tagBuffer = tagBuffer.slice(1);
              continue;
            }

            const matched = matchLeadingReactionTag(tagBuffer);
            if (matched) {
              emittedReactionFromStream =
                emitValidatedReaction({
                  handle: matched.handle,
                  emoji: matched.emoji,
                }) || emittedReactionFromStream;
              tagBuffer = tagBuffer.slice(matched.length).replace(
                emittedAnyVisibleText ? /^[ \t]+/ : /^\s+/,
                '',
              );
              continue;
            }

            if (flushAll || tagBuffer.length > 56) {
              checkedLeadingEmoji = true;
              emitVisibleDelta(tagBuffer[0]);
              tagBuffer = tagBuffer.slice(1);
              continue;
            }
            // Wait for more tokens to finish potential [[REACT ...]] tag
            break;
          }
        };

        try {
          const result = await invokeStreamFn({
            apiKey,
            provider,
            modelId,
            systemInstruction: opts.systemInstruction,
            prompt: activePrompt,
            signal: controller.signal,
            onDelta: (delta) => {
              if (!opts.handleMap || opts.handleMap.size === 0) {
                emitVisibleDelta(delta);
                return;
              }
              if (tagBuffer === '' && emittedAnyVisibleText && !delta.includes('[')) {
                emitVisibleDelta(delta);
                return;
              }
              tagBuffer += delta;
              drainTagBuffer(false);
            },
          });

          if (tagBuffer.length > 0) {
            drainTagBuffer(true);
          }

          const extracted = extractAllReactionTags(result.content);
          for (const tag of extracted.tags) {
            emittedReactionFromStream =
              emitValidatedReaction(tag) || emittedReactionFromStream;
          }
          let finalContent = extracted.cleanedText;
          if (
            allowLeadingEmojiLift &&
            opts.lastHandle &&
            extracted.tags.length === 0
          ) {
            const leadingMatch = LEADING_CURATED_EMOJI_PATTERN.exec(finalContent.trimStart());
            if (leadingMatch) {
              const lifted =
                emittedReactionFromStream ||
                emitValidatedReaction({
                  handle: opts.lastHandle,
                  emoji: leadingMatch[1],
                });
              if (lifted) {
                emittedReactionFromStream = true;
                finalContent = finalContent
                  .trimStart()
                  .slice(leadingMatch[0].length)
                  .trim();
              }
            }
          }

          const hasText = finalContent.trim().length > 0;
          const validTurn = !result.stopped && (hasText || emittedReactionFromStream);

          // Mark this model inference-verified upon its first successful chat execution
          if (validTurn) {
            recordModelAccessVerified(params.uid, provider, opts.compositeId);
            completedTurnCount += 1;
          }

          totalInputTokens += result.inputTokens;
          totalOutputTokens += result.outputTokens;
          totalEstimatedCostUsd += result.estimatedCostUsd;

          const msgStatus = result.stopped ? 'stopped' : 'completed';

          params.emit({
            type: 'model_done',
            messageId,
            role: opts.role,
            provider,
            modelId,
            modelLabel: label,
            round: opts.round,
            stageLabel: opts.stageLabel,
            content: finalContent,
            status: msgStatus,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
            estimatedCostUsd: result.estimatedCostUsd,
            pricingKnown: result.pricingKnown,
          });

          // Layer 2: If the AI didn't emit [[REACT mX emoji]] inline during streaming, run a fast structured reaction decision
          if (
            opts.role === 'model' &&
            !result.stopped &&
            !emittedReactionFromStream &&
            opts.handleMap &&
            opts.handleMap.size > 0 &&
            opts.lastHandle &&
            !reactionEvalBlockedProviders.has(provider)
          ) {
            try {
              const evalDecision = await evaluateReactionFn({
                apiKey,
                provider,
                modelId,
                modelLabel: label,
                contextText: opts.prompt,
                ownReply: finalContent,
                lastHandle: opts.lastHandle,
                availableHandles: Array.from(opts.handleMap.keys()),
                signal: controller.signal,
              });
              if (evalDecision) {
                emitValidatedReaction({
                  handle: evalDecision.targetHandle,
                  emoji: evalDecision.emoji,
                });
              }
            } catch (evalErr) {
              const classifiedEval = classifyProviderError(evalErr, provider, apiKey);
              if (classifiedEval.category === 'rate_limited' || classifiedEval.category === 'insufficient_credits') {
                reactionEvalBlockedProviders.add(provider);
              }
            }
          }

          if (hasText) {
            return {
              entry: {
                id: messageId,
                role: opts.role,
                provider,
                modelId,
                modelLabel: label,
                round: opts.round,
                stageLabel: opts.stageLabel,
                content: finalContent,
              },
            };
          }
          return { entry: null };
        } catch (err) {
          lastErr = err;
          if (controller.signal.aborted) break;
          const classified = classifyProviderError(err, provider, apiKey);
          if (classified.retryable && attempt === 0) {
            if (
              classified.statusCode === 413 ||
              /tpm|tokens per minute|request too large|payload too large/i.test(classified.rawMessage)
            ) {
              activePrompt =
                activePrompt.length > 4500
                  ? `...[earlier chat history compacted to fit TPM budget]...\n\n${activePrompt.slice(-4500)}`
                  : activePrompt;
            }
            const delayMs =
              params.deps?.retryDelayMs !== undefined
                ? params.deps.retryDelayMs
                : classified.category === 'rate_limited'
                  ? 2500
                  : 800;
            await delayWithSignal(delayMs, controller.signal).catch(() => undefined);
            continue;
          }
          break;
        }
      }

      const latencyMs = Date.now() - startedAt;
      if (controller.signal.aborted) {
        params.emit({
          type: 'model_done',
          messageId,
          role: opts.role,
          provider,
          modelId,
          modelLabel: label,
          round: opts.round,
          stageLabel: opts.stageLabel,
          content: '',
          status: 'stopped',
          inputTokens: 0,
          outputTokens: 0,
          latencyMs,
          estimatedCostUsd: 0,
          pricingKnown: false,
        });
        return { entry: null };
      }

      failedTurnCount += 1;
      const classified = classifyProviderError(lastErr, provider, apiKey);
      const displayErr = formatClassifiedError(classified, 900);
      const isFreeProvider = isFreeRateLimitedProvider(provider);

      // ONLY block the entire provider when clearly 401/402/insufficient_quota on non-free providers (expires after ~5 min).
      // For everything else (403, 404, 429 rate limits, 5xx, upstream errors, or any free-provider error),
      // mark ONLY this single model unavailable so sibling models keep working!
      if (classified.providerLevelBlock && !isFreeProvider) {
        const providerState =
          classified.category === 'insufficient_credits'
            ? 'insufficient_credits'
            : 'invalid_credentials';
        recordProviderHealth(params.uid, provider, providerState, displayErr, classified.category);
      } else {
        recordModelUnavailable(params.uid, opts.compositeId, displayErr, classified.category);
      }
      cachedCatalogModels = null;

      params.emit({
        type: 'model_error',
        messageId,
        role: opts.role,
        provider,
        modelId,
        modelLabel: label,
        round: opts.round,
        stageLabel: opts.stageLabel,
        errorMessage: displayErr,
        errorCode: classified.category,
        latencyMs,
      });

      return {
        entry: null,
        errorCategory: classified.category,
        errorSummary: displayErr,
      };
    };

    const runTurnWithFallback = async (opts: {
      compositeId: string;
      role: 'model' | 'moderator';
      round: number;
      stageLabel: string;
      buildSystemInstruction: (modelLabel: string) => string;
      prompt: string;
      activeRoundIds: Set<string>;
      handleMap?: Map<string, string>;
      lastHandle?: string | null;
      onFallbackSelected?: (newCompositeId: string) => void;
    }): Promise<TranscriptEntry | null> => {
      const firstParsed = parseCompositeModel(opts.compositeId);
      const firstAttempt = await runSingleTurn({
        compositeId: opts.compositeId,
        role: opts.role,
        round: opts.round,
        stageLabel: opts.stageLabel,
        systemInstruction: opts.buildSystemInstruction(firstParsed.label),
        prompt: opts.prompt,
        handleMap: opts.handleMap,
        lastHandle: opts.lastHandle,
      });

      if (firstAttempt.entry) {
        return firstAttempt.entry;
      }
      if (controller.signal.aborted) {
        return null;
      }
      if (!firstAttempt.errorCategory) {
        return null;
      }

      if (!fallbackEnabled) {
        if (opts.role === 'model') {
          removeActiveModel(
            opts.compositeId,
            firstAttempt.errorSummary || 'Model failed to respond',
          );
        }
        return null;
      }

      const fb = await resolveVerifiedFallback({
        excludedIds: opts.activeRoundIds,
        failedProvider: firstParsed.provider,
        errorCategory: firstAttempt.errorCategory,
        promptText: opts.prompt,
      });

      if (!fb) {
        if (opts.role === 'model') {
          removeActiveModel(
            opts.compositeId,
            firstAttempt.errorSummary || 'Model failed and no working fallback available',
          );
        }
        return null;
      }

      const fbParsed = parseCompositeModel(fb.compositeId);
      const reason = firstAttempt.errorSummary || 'Selected model failed';

      params.emit({
        type: 'model_fallback',
        originalCompositeId: opts.compositeId,
        originalModelLabel: firstParsed.label,
        fallbackCompositeId: fb.compositeId,
        fallbackModelLabel: fbParsed.label,
        errorCategory: firstAttempt.errorCategory,
        reason,
        round: opts.round,
      });

      const secondAttempt = await runSingleTurn({
        compositeId: fb.compositeId,
        role: opts.role,
        round: opts.round,
        stageLabel: `${opts.stageLabel} · Fallback`,
        systemInstruction: opts.buildSystemInstruction(fbParsed.label),
        prompt: opts.prompt,
        handleMap: opts.handleMap,
        lastHandle: opts.lastHandle,
      });

      if (secondAttempt.entry) {
        if (opts.onFallbackSelected) {
          opts.onFallbackSelected(fb.compositeId);
        }
        return secondAttempt.entry;
      }

      if (!controller.signal.aborted && opts.role === 'model') {
        removeActiveModel(
          opts.compositeId,
          secondAttempt.errorSummary || firstAttempt.errorSummary || 'Model and fallback failed',
        );
      }
      return null;
    };

    const replyTargetComposite =
      params.replyTo && params.replyTo.role !== 'user' && params.replyTo.provider !== 'user'
        ? `${params.replyTo.provider}:${params.replyTo.modelId}`
        : null;
    const replyTargetInRoster = Boolean(
      replyTargetComposite && effectiveModels.includes(replyTargetComposite),
    );

    if (params.mode === 'chat') {
      currentRound = 0;
      const stageLabel = 'Direct Chat';
      params.emit({ type: 'round_start', round: 0, stageLabel });

      const activeIds = new Set(effectiveModels);
      const chatModelsSnapshot = orderSpeakersForReply(effectiveModels, params.replyTo);
      const chatTurnTranscript = [...transcript];

      // Execute council models sequentially one after another with a 1-2s delay between calls
      for (let idx = 0; idx < chatModelsSnapshot.length; idx++) {
        if (controller.signal.aborted) break;
        if (idx > 0) {
          await delayWithSignal(turnDelayMs, controller.signal).catch(() => undefined);
          if (controller.signal.aborted) break;
        }
        const compositeId = chatModelsSnapshot[idx];
        const speakerProvider = parseCompositeModel(compositeId).provider;
        const maxCtxChars = isFreeRateLimitedProvider(speakerProvider) ? 10500 : 28000;
        const {
          text: turnContext,
          handleMap,
          lastHandle,
        } = formatTranscriptWithHandles(chatTurnTranscript, compositeId, maxCtxChars);
        const reactionInstruction = buildReactionInstruction(handleMap, lastHandle);
        const replyGuidance = buildReplyTurnGuidance(
          params.replyTo,
          compositeId,
          replyTargetInRoster,
        );
        const entry = await runTurnWithFallback({
          compositeId,
          role: 'model',
          round: 0,
          stageLabel,
          activeRoundIds: activeIds,
          handleMap,
          lastHandle,
          onFallbackSelected: (newId) => {
            replaceActiveModel(compositeId, newId);
          },
          buildSystemInstruction: (modelLabel) =>
            [
              `You are ${modelLabel} in a live group chat inside T.U.T AI Council.`,
              'Talk like a real, helpful human in a Messenger/Discord/WhatsApp group chat: natural, direct, conversational, and never robotic.',
              'Match reply length strictly to what the prompt warrants:',
              '- For greetings, casual chat, or simple questions: answer in 1–3 short sentences. No headers, no bullet-point walls, no filler.',
              '- For technical, coding, or detailed questions: give a crisp, high-signal answer without padded intros, restating the question, or bloated summaries.',
              'If another model already replied just before you, build on what they said or add a fresh angle instead of repeating the same answer. Never impersonate another model.',
              ...(replyGuidance ? [replyGuidance] : []),
              ...(reactionInstruction ? [reactionInstruction] : []),
            ].join('\n'),
          prompt: `${turnContext}\n\nReply naturally to the latest message in the group chat.`,
        });
        if (entry) {
          chatTurnTranscript.push(entry);
        }
      }

      if (controller.signal.aborted) {
        finalStatus = 'stopped';
      } else if (completedTurnCount === 0 && failedTurnCount > 0) {
        finalStatus = 'error';
      }
    } else if (!params.moderateOnly) {
      const baseTarget = params.mode === 'debate' ? 3 : clampedMaxRounds;
      const targetRounds = Math.min(Math.max(baseTarget, params.startRound), 6);

      for (let round = params.startRound; round <= targetRounds; round++) {
        if (controller.signal.aborted) {
          finalStatus = 'stopped';
          break;
        }
        if (effectiveModels.length === 0) {
          finalStatus = 'error';
          break;
        }
        currentRound = round;

        let stageLabel = `Round ${round}`;
        if (params.mode === 'debate') {
          if (round === 1) stageLabel = 'Round 1 · Independent Responses';
          else if (round === 2) stageLabel = 'Round 2 · Cross-Review';
          else stageLabel = 'Round 3 · Revised Conclusions';
        } else {
          stageLabel =
            round === 1
              ? 'Round 1 · Initial Perspectives'
              : `Round ${round} · Open Deliberation`;
        }

        params.emit({ type: 'round_start', round, stageLabel });

        const activeIds = new Set(effectiveModels);
        const roundModelsSnapshot =
          round === params.startRound
            ? orderSpeakersForReply(effectiveModels, params.replyTo)
            : [...effectiveModels];
        const roundResults: Array<TranscriptEntry | null> = [];

        // Execute council models sequentially one after another with a 1-2s delay
        for (let idx = 0; idx < roundModelsSnapshot.length; idx++) {
          if (controller.signal.aborted) break;
          if (idx > 0 || round > params.startRound) {
            await delayWithSignal(turnDelayMs, controller.signal).catch(() => undefined);
            if (controller.signal.aborted) break;
          }
          const compositeId = roundModelsSnapshot[idx];
          const speakerProvider = parseCompositeModel(compositeId).provider;
          const maxCtxChars = isFreeRateLimitedProvider(speakerProvider) ? 10500 : 28000;
          const allowRoundReactions = true;
          const {
            text: roundSnapshot,
            handleMap: turnHandleMap,
            lastHandle: roundLastHandle,
          } = formatTranscriptWithHandles(
            transcript,
            compositeId,
            maxCtxChars,
          );
          const roundReactionInstruction = buildReactionInstruction(
            turnHandleMap,
            roundLastHandle,
          );
          const replyGuidance =
            round === params.startRound
              ? buildReplyTurnGuidance(params.replyTo, compositeId, replyTargetInRoster)
              : null;

          let prompt = '';
          if (round === 1 && params.mode === 'debate') {
            prompt = `${roundSnapshot}\n\nProvide your independent, well-reasoned answer to the user's question. Be crisp, precise, and transparent about assumptions or uncertainties without padding.`;
          } else if (round === 2 && params.mode === 'debate') {
            prompt = `${roundSnapshot}\n\nNow conduct a focused Cross-Review of the other council members' Round 1 responses. Concisely identify:\n- Key agreements and why\n- Disagreements or logical flaws\n- Unsupported claims or missing edge cases\nReference other models strictly by their attributed labels.`;
          } else if (round >= 3 && params.mode === 'debate') {
            prompt = `${roundSnapshot}\n\nAfter reviewing Round 2, state your Revised Conclusion concisely. Acknowledge valid critiques, defend sound points with evidence, and note remaining uncertainty.`;
          } else if (round === 1 && params.mode === 'free') {
            prompt = `${roundSnapshot}\n\nShare your take in this group discussion. Keep it conversational, proportional to the question's complexity (2–5 sentences unless technical depth is genuinely needed), and skip boilerplate intros.`;
          } else {
            prompt = `${roundSnapshot}\n\nContinue the group discussion (Round ${round} of ${targetRounds}). Respond directly to what peers said above—agree briefly, challenge weak spots, or add a fresh angle in a concise, natural human tone without repeating earlier points.`;
          }

          const entry = await runTurnWithFallback({
            compositeId,
            role: 'model',
            round,
            stageLabel,
            activeRoundIds: activeIds,
            handleMap: allowRoundReactions ? turnHandleMap : undefined,
            lastHandle: allowRoundReactions ? roundLastHandle : null,
            onFallbackSelected: (newId) => {
              replaceActiveModel(compositeId, newId);
            },
            buildSystemInstruction: (modelLabel) =>
              params.mode === 'free'
                ? [
                    `You are ${modelLabel} in a multi-model group discussion inside T.U.T AI Council.`,
                    'Speak like a sharp human colleague—conversational, direct, and concise (typically 2–5 sentences unless genuine technical depth is needed).',
                    'Never use filler intros or restate points peers already covered. Never impersonate another model, and keep verified facts distinct from speculation.',
                    ...(replyGuidance ? [replyGuidance] : []),
                    ...(roundReactionInstruction ? [roundReactionInstruction] : []),
                  ].join('\n')
                : [
                    `You are participating in T.U.T AI Council strictly as ${modelLabel}.`,
                    'Be high-signal, clear, and concise—avoid padded intros, filler, or repetition.',
                    'Never impersonate another AI model, never claim another model identity, and clearly distinguish verified facts from informed analysis or uncertainty.',
                    ...(replyGuidance ? [replyGuidance] : []),
                    ...(roundReactionInstruction ? [roundReactionInstruction] : []),
                  ].join('\n'),
            prompt,
          });
          roundResults.push(entry);
        }

        for (const entry of roundResults) {
          if (entry) transcript.push(entry);
        }

        if (controller.signal.aborted) {
          finalStatus = 'stopped';
          break;
        }
        if (effectiveModels.length === 0) {
          finalStatus = 'error';
          break;
        }
      }
    }

    if (params.mode !== 'chat' && !controller.signal.aborted) {
      const hasModelOutput = transcript.some((t) => t.role !== 'user');
      if (!hasModelOutput && !params.moderateOnly) {
        finalStatus = 'error';
      } else {
        if (!params.moderateOnly) {
          await delayWithSignal(turnDelayMs, controller.signal).catch(() => undefined);
        }
        if (!controller.signal.aborted) {
          const modRound = params.moderateOnly ? params.startRound : currentRound;
          const modStage =
            params.mode === 'debate'
              ? 'Final Stage · Council Moderator Verdict'
              : 'Council Moderator Synthesis';
          params.emit({ type: 'round_start', round: modRound, stageLabel: modStage });

          const fullTranscript = formatTranscript(transcript, 36000);
          const activeModIds = new Set([effectiveModerator]);

          const modResult = await runTurnWithFallback({
            compositeId: effectiveModerator,
            role: 'moderator',
            round: modRound,
            stageLabel: modStage,
            activeRoundIds: activeModIds,
            onFallbackSelected: (newId) => {
              effectiveModerator = newId;
              emitRosterUpdated();
            },
            buildSystemInstruction: (modelLabel) =>
              [
                `You are the impartial Council Moderator (${modelLabel}) for T.U.T AI Council.`,
                'Rules you MUST follow:',
                '1. Read every attributed model response carefully.',
                '2. Never assume the majority opinion is automatically correct.',
                '3. Strictly distinguish verified facts from model opinions, assumptions, and speculation.',
                '4. Detect unsupported claims, missing evidence, and unstated caveats.',
                '5. Produce your final report using the exact 7 numbered sections below concisely and clearly:',
                '   1. Executive summary',
                '   2. Points of agreement',
                '   3. Points of disagreement',
                '   4. Important reasoning and evidence',
                '   5. Unresolved questions',
                '   6. Final recommendation',
                '   7. Confidence and limitations',
              ].join('\n'),
            prompt: `${fullTranscript}\n\nSynthesize the entire council deliberation into the 7-section Moderator Report.`,
          });

          if (!modResult && completedTurnCount === 0) {
            finalStatus = 'error';
          }
        }
      }
    } else if (controller.signal.aborted) {
      finalStatus = 'stopped';
    }
  } finally {
    activeControllers.delete(runKey);
    params.emit({
      type: 'council_done',
      status: controller.signal.aborted ? 'stopped' : finalStatus,
      currentRound,
      totalInputTokens,
      totalOutputTokens,
      estimatedCostUsd: Number(totalEstimatedCostUsd.toFixed(6)),
    });
  }
}
