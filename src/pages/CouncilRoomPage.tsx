import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AppShell, type AppRoute } from '../components/AppShell';
import {
  getDuplicateProviderCompositeSet,
  getModelVisualIdentity,
  getProviderVisual,
} from '../components/ProviderBadge';
import { ChatHeader } from '../components/chat/ChatHeader';
import {
  Composer,
  EmptyWelcomeState,
  type MentionModelOption,
} from '../components/chat/Composer';
import { MessageBubble } from '../components/chat/MessageBubble';
import { RoundNav, type FilterModelChip } from '../components/chat/RoundNav';
import { RunDetailsDrawer } from '../components/chat/RunDetailsDrawer';
import type {
  FallbackRecord,
  PreflightViewState,
  ProviderErrorRecord,
  RemovedModelRecord,
  StreamingBufferItem,
} from '../components/chat/types';
import { useAuth } from '../contexts/AuthContext';
import { stopCouncilRunApi, streamCouncilRun } from '../lib/apiClient';
import {
  generateSafeId,
  recordUsageEntry,
  saveCouncilMessage,
  subscribeCouncilMessages,
  updateCouncilRunState,
  updateMessageReactions,
} from '../lib/firestoreService';
import { isValidProviderId, PROVIDER_REGISTRY } from '../shared/providers';
import type {
  CouncilMessageDoc,
  CouncilSSEEvent,
  MessageReaction,
  ProviderId,
  ReplyToRef,
} from '../shared/types';

function resolveFilterModelChip(compositeId: string): FilterModelChip {
  const idx = compositeId.indexOf(':');
  if (idx === -1) {
    return {
      compositeId,
      providerId: 'google',
      label: compositeId,
    };
  }
  const raw = compositeId.slice(0, idx);
  const modelId = compositeId.slice(idx + 1);
  const providerId: ProviderId = isValidProviderId(raw) ? raw : 'google';
  const shortProvider = PROVIDER_REGISTRY[providerId]?.shortName || raw;
  return {
    compositeId,
    providerId,
    label: `${shortProvider} · ${modelId}`,
  };
}

function mergeReaction(
  existing: MessageReaction[] | undefined,
  incoming: MessageReaction,
): MessageReaction[] {
  const base = existing ? [...existing] : [];
  const duplicate = base.some(
    (r) => r.reactorId === incoming.reactorId && r.emoji === incoming.emoji,
  );
  if (duplicate || base.length >= 16) return base;
  return [...base, incoming];
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CouncilRoomPage({
  councilId,
  initialAutoPrompt,
  onClearInitialPrompt,
  onNavigate,
}: {
  councilId: string;
  initialAutoPrompt: string | null;
  onClearInitialPrompt: () => void;
  onNavigate: (route: AppRoute) => void;
}) {
  const { user, councils, addSessionUsage, refreshProviderState } = useAuth();
  const council = councils.find((c) => c.id === councilId) || null;

  const [messages, setMessages] = useState<CouncilMessageDoc[]>([]);
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<CouncilMessageDoc | null>(null);
  const [streamingMap, setStreamingMap] = useState<Record<string, StreamingBufferItem>>({});
  const [preflightState, setPreflightState] = useState<PreflightViewState | null>(null);
  const [fallbackHistory, setFallbackHistory] = useState<FallbackRecord[]>([]);
  const [removedModels, setRemovedModels] = useState<RemovedModelRecord[]>([]);
  const [liveErrors, setLiveErrors] = useState<ProviderErrorRecord[]>([]);
  const [externalDraft, setExternalDraft] = useState<{ text: string; seq: number } | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [activeRound, setActiveRound] = useState<number | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyToRef | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState<{
    text: string;
    replyTo?: ReplyToRef;
  } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // Smart turn-anchored smooth auto-scroll state
  const [activeTurnUserId, setActiveTurnUserId] = useState<string | null>(null);
  const [bottomSpacerPx, setBottomSpacerPx] = useState<number>(12);
  const highlightTimerRef = useRef<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const autoStartedRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const feedInnerRef = useRef<HTMLDivElement | null>(null);
  const roundRefs = useRef<Record<number, HTMLElement | null>>({});
  const messageElsRef = useRef<Record<string, HTMLElement | null>>({});

  // Scroll controller refs
  const userScrolledAwayRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const anchorGlideActiveRef = useRef(false);
  const anchorGlideStartTimeRef = useRef(0);
  const anchorGlideStartTopRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);

  // Reaction consistency refs across Firestore round-trips
  const [optimisticReactions, setOptimisticReactions] = useState<
    Record<string, MessageReaction[]>
  >({});
  const messagesRef = useRef<CouncilMessageDoc[]>(messages);
  messagesRef.current = messages;
  const pendingReactionsRef = useRef<Map<string, MessageReaction[]>>(new Map());
  const reactionsCacheRef = useRef<Map<string, MessageReaction[]>>(new Map());
  const inflightReactionWritesRef = useRef<Map<string, number>>(new Map());

  const persistMessageReactions = useCallback(
    (msgId: string, nextReactions: MessageReaction[]) => {
      if (!council) return;
      const prevCount = inflightReactionWritesRef.current.get(msgId) || 0;
      inflightReactionWritesRef.current.set(msgId, prevCount + 1);
      reactionsCacheRef.current.set(msgId, nextReactions);
      setOptimisticReactions((prev) => ({ ...prev, [msgId]: nextReactions }));

      void updateMessageReactions(council.id, msgId, nextReactions)
        .catch((err) => {
          console.warn('Failed to persist message reaction update:', err);
        })
        .finally(() => {
          const cur = inflightReactionWritesRef.current.get(msgId) || 1;
          if (cur <= 1) {
            inflightReactionWritesRef.current.delete(msgId);
          } else {
            inflightReactionWritesRef.current.set(msgId, cur - 1);
          }
        });
    },
    [council],
  );

  useEffect(() => {
    if (!user || !councilId) return;
    const unsub = subscribeCouncilMessages(user.uid, councilId, setMessages);
    return () => unsub();
  }, [user, councilId]);

  useEffect(() => {
    setOptimisticUserMsg(null);
    setOptimisticReactions({});
    setStreamingMap({});
    setPreflightState(null);
    setFallbackHistory([]);
    setRemovedModels([]);
    setLiveErrors([]);
    setRunError(null);
    setRunDetailsOpen(false);
    setSelectedFilter('all');
    setActiveRound(null);
    setShowScrollButton(false);
    setHasNewMessages(false);
    setActiveTurnUserId(null);
    setBottomSpacerPx(12);
    setReplyTarget(null);
    setQueuedPrompt(null);
    setHighlightedMessageId(null);
    userScrolledAwayRef.current = false;
    anchorGlideActiveRef.current = false;
    pendingReactionsRef.current.clear();
    reactionsCacheRef.current.clear();
    inflightReactionWritesRef.current.clear();
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, [councilId]);

  // Prune streaming buffers and optimistic messages cleanly once persisted by Firestore onSnapshot
  useEffect(() => {
    if (messages.length === 0) return;
    const persistedIds = new Set(messages.map((m) => m.id));
    const clearedOptIds: string[] = [];

    for (const m of messages) {
      const pending = pendingReactionsRef.current.get(m.id);
      if (pending && pending.length > 0) {
        pendingReactionsRef.current.delete(m.id);
        let merged = m.reactions ? [...m.reactions] : [];
        let changed = false;
        for (const r of pending) {
          const next = mergeReaction(merged, r);
          if (next.length !== merged.length) {
            merged = next;
            changed = true;
          }
        }
        if (changed) {
          persistMessageReactions(m.id, merged);
          continue;
        }
      }

      if ((inflightReactionWritesRef.current.get(m.id) || 0) === 0) {
        reactionsCacheRef.current.set(m.id, m.reactions ? [...m.reactions] : []);
        clearedOptIds.push(m.id);
      }
    }

    if (clearedOptIds.length > 0) {
      setOptimisticReactions((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of clearedOptIds) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    if (optimisticUserMsg && persistedIds.has(optimisticUserMsg.id)) {
      setOptimisticUserMsg(null);
    }

    setStreamingMap((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      let changed = false;
      const next: Record<string, StreamingBufferItem> = {};
      for (const k of keys) {
        if (persistedIds.has(k) && prev[k].status !== 'streaming') {
          changed = true;
        } else {
          next[k] = prev[k];
        }
      }
      return changed ? next : prev;
    });
  }, [messages, optimisticUserMsg, persistMessageReactions]);

  const computeTurnMetrics = useCallback(() => {
    const containerEl = scrollContainerRef.current;
    const innerEl = feedInnerRef.current;
    if (!containerEl || !innerEl) {
      return { targetTop: 0, spacerPx: 12 };
    }
    const containerRect = containerEl.getBoundingClientRect();
    const containerHeight = containerEl.clientHeight;
    const innerRect = innerEl.getBoundingClientRect();
    const innerBottomInContent = innerRect.bottom - containerRect.top + containerEl.scrollTop;

    if (activeTurnUserId) {
      const userEl = messageElsRef.current[activeTurnUserId];
      if (userEl) {
        const userRect = userEl.getBoundingClientRect();
        const userTopInContent = userRect.top - containerRect.top + containerEl.scrollTop;
        const turnHeight = Math.max(0, innerBottomInContent - userTopInContent);
        const topMargin = 12;
        const anchorTop = Math.max(0, Math.round(userTopInContent - topMargin));
        const spacerPx = Math.max(12, Math.ceil(containerHeight - turnHeight - topMargin));
        const expectedMaxScroll = Math.max(
          0,
          Math.round(innerBottomInContent + spacerPx - containerHeight),
        );
        return {
          targetTop: Math.max(anchorTop, expectedMaxScroll),
          spacerPx,
        };
      }
    }

    const maxScroll = Math.max(0, Math.round(innerBottomInContent + 12 - containerHeight));
    return { targetTop: maxScroll, spacerPx: 12 };
  }, [activeTurnUserId]);

  const setContainerScrollTop = useCallback((el: HTMLDivElement, value: number) => {
    programmaticScrollRef.current = true;
    el.scrollTop = value;
    prevScrollTopRef.current = el.scrollTop;
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, []);

  const stopScrollAnimation = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    anchorGlideActiveRef.current = false;
  }, []);

  const startSmoothScroll = useCallback(
    (mode: 'anchor_glide' | 'follow') => {
      const el = scrollContainerRef.current;
      if (!el) return;

      if (prefersReducedMotion()) {
        stopScrollAnimation();
        const { targetTop } = computeTurnMetrics();
        setContainerScrollTop(el, targetTop);
        return;
      }

      if (mode === 'anchor_glide') {
        anchorGlideActiveRef.current = true;
        anchorGlideStartTimeRef.current = performance.now();
        anchorGlideStartTopRef.current = el.scrollTop;
      }

      if (scrollRafRef.current !== null) return;

      const step = (now: number) => {
        const container = scrollContainerRef.current;
        if (!container || userScrolledAwayRef.current) {
          scrollRafRef.current = null;
          anchorGlideActiveRef.current = false;
          return;
        }

        const { targetTop } = computeTurnMetrics();
        const maxPossible = Math.max(0, container.scrollHeight - container.clientHeight);
        const clampedTarget = Math.min(targetTop, maxPossible);

        if (anchorGlideActiveRef.current) {
          const duration = 380;
          const t = Math.min(1, (now - anchorGlideStartTimeRef.current) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          const nextTop =
            anchorGlideStartTopRef.current + (clampedTarget - anchorGlideStartTopRef.current) * eased;
          setContainerScrollTop(container, nextTop);
          if (t < 1) {
            scrollRafRef.current = requestAnimationFrame(step);
            return;
          }
          anchorGlideActiveRef.current = false;
          setContainerScrollTop(container, clampedTarget);
          scrollRafRef.current = null;
          return;
        }

        const diff = clampedTarget - container.scrollTop;
        if (Math.abs(diff) <= 0.75) {
          setContainerScrollTop(container, clampedTarget);
          scrollRafRef.current = null;
          return;
        }

        setContainerScrollTop(container, container.scrollTop + diff * 0.24);
        scrollRafRef.current = requestAnimationFrame(step);
      };

      scrollRafRef.current = requestAnimationFrame(step);
    },
    [computeTurnMetrics, setContainerScrollTop, stopScrollAnimation],
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    const inner = feedInnerRef.current;
    if (!container || !inner || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => {
      const { spacerPx } = computeTurnMetrics();
      setBottomSpacerPx((prev) => (Math.abs(spacerPx - prev) >= 1 ? spacerPx : prev));
      if (!userScrolledAwayRef.current) {
        startSmoothScroll(anchorGlideActiveRef.current ? 'anchor_glide' : 'follow');
      }
    });

    ro.observe(container);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [computeTurnMetrics, startSmoothScroll]);

  const executeCouncilRun = async (opts: {
    promptText: string;
    startRound: number;
    moderateOnly?: boolean;
    existingHistory: CouncilMessageDoc[];
    presetUserMsgId?: string;
    replyTo?: ReplyToRef;
  }) => {
    if (!user || !council || isRunning) return;
    setIsRunning(true);
    setRunError(null);
    setStreamingMap({});
    setPreflightState(null);
    setLiveErrors([]);

    const controller = new AbortController();
    abortRef.current = controller;

    let runInputTokens = 0;
    let runOutputTokens = 0;
    let runCostUsd = 0;
    let latestRound = opts.startRound;
    let sawModelError = false;

    const userMsgId =
      !opts.moderateOnly && opts.promptText.trim()
        ? opts.presetUserMsgId || generateSafeId('msg')
        : undefined;

    try {
      await updateCouncilRunState(council.id, {
        status: 'running',
        currentRound: council.mode === 'chat' ? 0 : opts.startRound,
      });

      if (userMsgId && opts.promptText.trim()) {
        const userPayload = {
          id: userMsgId,
          role: 'user' as const,
          provider: 'user' as const,
          modelId: 'user',
          modelLabel: 'Council Member (User)',
          round: council.mode === 'chat' ? 0 : opts.startRound,
          stageLabel:
            council.mode === 'chat'
              ? 'Direct Chat'
              : `Round ${opts.startRound} · User Question`,
          content: opts.promptText.trim(),
          status: 'completed' as const,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          estimatedCostUsd: 0,
          pricingKnown: false,
          ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
        };
        setOptimisticUserMsg({
          ...userPayload,
          councilId: council.id,
          userId: user.uid,
          createdAt: null,
        });
        setActiveTurnUserId(userMsgId);
        userScrolledAwayRef.current = false;
        setShowScrollButton(false);
        setHasNewMessages(false);
        requestAnimationFrame(() => startSmoothScroll('anchor_glide'));

        await saveCouncilMessage(user.uid, council.id, userPayload);
      }

      const priorPayload = opts.existingHistory.map((m) => ({
        id: m.id,
        role: m.role,
        provider: m.provider,
        modelId: m.modelId,
        modelLabel: m.modelLabel,
        round: m.round,
        stageLabel: m.stageLabel,
        content: m.content,
        status: m.status,
        ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      }));

      await streamCouncilRun(
        council.id,
        {
          mode: council.mode,
          intelligenceLevel: council.intelligenceLevel || 'medium',
          selectedModels: council.selectedModels,
          moderatorModel: council.moderatorModel,
          maxRounds: council.maxRounds,
          startRound: council.mode === 'chat' ? 0 : opts.startRound,
          priorMessages: priorPayload,
          userPrompt: opts.promptText.trim(),
          userMessageId: userMsgId,
          ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
          moderateOnly: opts.moderateOnly,
        },
        (ev: CouncilSSEEvent) => {
          if (ev.type === 'preflight_summary') {
            setPreflightState({
              readyModels: ev.readyModels,
              rejectedModels: ev.rejectedModels,
              warnings: ev.warnings,
            });
          } else if (ev.type === 'round_start') {
            latestRound = ev.round;
          } else if (ev.type === 'model_start') {
            setStreamingMap((prev) => ({
              ...prev,
              [ev.messageId]: {
                messageId: ev.messageId,
                role: ev.role,
                provider: ev.provider,
                modelId: ev.modelId,
                modelLabel: ev.modelLabel,
                round: ev.round,
                stageLabel: ev.stageLabel,
                content: '',
                status: 'streaming',
              },
            }));
          } else if (ev.type === 'model_delta') {
            setStreamingMap((prev) => {
              const cur = prev[ev.messageId];
              if (!cur) return prev;
              return {
                ...prev,
                [ev.messageId]: {
                  ...cur,
                  content: cur.content + ev.delta,
                },
              };
            });
          } else if (ev.type === 'message_reaction') {
            const targetId = ev.targetMessageId;
            const targetPersisted = messagesRef.current.find((m) => m.id === targetId);
            if (targetPersisted) {
              const base =
                reactionsCacheRef.current.get(targetId) ?? targetPersisted.reactions ?? [];
              const nextReactions = mergeReaction(base, ev.reaction);
              if (nextReactions.length !== base.length) {
                persistMessageReactions(targetId, nextReactions);
              }
            } else {
              const pending =
                reactionsCacheRef.current.get(targetId) ??
                pendingReactionsRef.current.get(targetId) ??
                [];
              const nextPending = mergeReaction(pending, ev.reaction);
              reactionsCacheRef.current.set(targetId, nextPending);
              pendingReactionsRef.current.set(targetId, nextPending);

              setOptimisticReactions((prev) => ({
                ...prev,
                [targetId]: mergeReaction(prev[targetId], ev.reaction),
              }));

              setOptimisticUserMsg((prev) =>
                prev && prev.id === targetId
                  ? { ...prev, reactions: mergeReaction(prev.reactions, ev.reaction) }
                  : prev,
              );

              setStreamingMap((prev) => {
                const cur = prev[targetId];
                if (!cur) return prev;
                return {
                  ...prev,
                  [targetId]: {
                    ...cur,
                    reactions: mergeReaction(cur.reactions, ev.reaction),
                  },
                };
              });
            }
          } else if (ev.type === 'model_done') {
            runInputTokens += ev.inputTokens;
            runOutputTokens += ev.outputTokens;
            runCostUsd += ev.estimatedCostUsd;
            addSessionUsage({
              requests: 1,
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
              estimatedCostUsd: ev.estimatedCostUsd,
            });

            void recordUsageEntry(user.uid, {
              councilId: council.id,
              provider: ev.provider,
              modelId: ev.modelId,
              round: ev.round,
              status: ev.status === 'stopped' ? 'stopped' : 'success',
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
              estimatedCostUsd: ev.estimatedCostUsd,
              pricingKnown: ev.pricingKnown,
              latencyMs: ev.latencyMs,
            });

            // Pure reaction turn (empty body): clear typing bubble without persisting an empty card
            if (!ev.content.trim()) {
              setStreamingMap((prev) => {
                const next = { ...prev };
                delete next[ev.messageId];
                return next;
              });
              return;
            }

            // Keep finalized bubble in streamingMap until Firestore onSnapshot delivers ev.messageId
            // so the card NEVER disappears for a frame and causes height collapse/shake.
            const pendingReactions = pendingReactionsRef.current.get(ev.messageId);
            if (pendingReactions) {
              pendingReactionsRef.current.delete(ev.messageId);
            }

            setStreamingMap((prev) => {
              const cur = prev[ev.messageId];
              return {
                ...prev,
                [ev.messageId]: {
                  messageId: ev.messageId,
                  role: ev.role,
                  provider: ev.provider,
                  modelId: ev.modelId,
                  modelLabel: ev.modelLabel,
                  round: ev.round,
                  stageLabel: ev.stageLabel,
                  content: ev.content,
                  status: ev.status,
                  inputTokens: ev.inputTokens,
                  outputTokens: ev.outputTokens,
                  latencyMs: ev.latencyMs,
                  estimatedCostUsd: ev.estimatedCostUsd,
                  reactions: cur?.reactions || pendingReactions,
                },
              };
            });

            void saveCouncilMessage(user.uid, council.id, {
              id: ev.messageId,
              role: ev.role,
              provider: ev.provider,
              modelId: ev.modelId,
              modelLabel: ev.modelLabel,
              round: ev.round,
              stageLabel: ev.stageLabel,
              content: ev.content,
              status: ev.status,
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
              latencyMs: ev.latencyMs,
              estimatedCostUsd: ev.estimatedCostUsd,
              pricingKnown: ev.pricingKnown,
              ...(pendingReactions && pendingReactions.length > 0
                ? { reactions: pendingReactions }
                : {}),
            });
          } else if (ev.type === 'model_error') {
            sawModelError = true;
            addSessionUsage({ requests: 1 });
            setLiveErrors((prev) => [
              ...prev,
              {
                id: ev.messageId,
                provider: ev.provider,
                modelId: ev.modelId,
                round: ev.round,
                stageLabel: ev.stageLabel,
                errorCode: ev.errorCode || 'upstream_error',
                message: ev.errorMessage,
              },
            ]);
            setStreamingMap((prev) => ({
              ...prev,
              [ev.messageId]: {
                messageId: ev.messageId,
                role: ev.role,
                provider: ev.provider,
                modelId: ev.modelId,
                modelLabel: ev.modelLabel,
                round: ev.round,
                stageLabel: ev.stageLabel,
                content: '',
                status: 'error',
                errorMessage: ev.errorMessage,
              },
            }));

            void saveCouncilMessage(user.uid, council.id, {
              id: ev.messageId,
              role: ev.role,
              provider: ev.provider,
              modelId: ev.modelId,
              modelLabel: ev.modelLabel,
              round: ev.round,
              stageLabel: ev.stageLabel,
              content: '',
              status: 'error',
              errorMessage: ev.errorMessage,
              inputTokens: 0,
              outputTokens: 0,
              latencyMs: ev.latencyMs,
              estimatedCostUsd: 0,
              pricingKnown: false,
            });

            void recordUsageEntry(user.uid, {
              councilId: council.id,
              provider: ev.provider,
              modelId: ev.modelId,
              round: ev.round,
              status: 'error',
              inputTokens: 0,
              outputTokens: 0,
              estimatedCostUsd: 0,
              pricingKnown: false,
              latencyMs: ev.latencyMs,
            });
          } else if (ev.type === 'model_fallback') {
            setFallbackHistory((prev) => [
              ...prev,
              {
                id: `${ev.round}-${ev.originalCompositeId}-${ev.fallbackCompositeId}-${prev.length}`,
                round: ev.round,
                originalCompositeId: ev.originalCompositeId,
                originalModelLabel: ev.originalModelLabel,
                fallbackCompositeId: ev.fallbackCompositeId,
                fallbackModelLabel: ev.fallbackModelLabel,
                errorCategory: ev.errorCategory,
                reason: ev.reason,
              },
            ]);
          } else if (ev.type === 'roster_updated') {
            if (ev.removedModels.length > 0) {
              setRemovedModels((prev) => {
                const map = new Map(prev.map((item) => [item.compositeId, item]));
                for (const rm of ev.removedModels) {
                  map.set(rm.compositeId, rm);
                }
                return Array.from(map.values());
              });
            }
            const minRequiredForRule = council.mode === 'chat' ? 1 : 2;
            const rosterUpdate: {
              selectedModels?: string[];
              moderatorModel?: string;
            } = {};
            if (ev.selectedModels.length >= minRequiredForRule && ev.selectedModels.length <= 6) {
              rosterUpdate.selectedModels = ev.selectedModels;
            }
            if (
              council.mode !== 'chat' &&
              ev.moderatorModel &&
              ev.moderatorModel !== 'none'
            ) {
              rosterUpdate.moderatorModel = ev.moderatorModel;
            }
            if (rosterUpdate.selectedModels || rosterUpdate.moderatorModel) {
              void updateCouncilRunState(council.id, rosterUpdate);
            }
          } else if (ev.type === 'council_done') {
            void updateCouncilRunState(council.id, {
              status: ev.status,
              currentRound: ev.currentRound,
              totalInputTokens: (council.totalInputTokens || 0) + runInputTokens,
              totalOutputTokens: (council.totalOutputTokens || 0) + runOutputTokens,
              estimatedCostUsd: Number(
                ((council.estimatedCostUsd || 0) + runCostUsd).toFixed(6),
              ),
            });
            if (sawModelError) {
              void refreshProviderState(true);
            }
          } else if (ev.type === 'fatal_error') {
            setRunError(ev.message);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        setRunError(msg);
        await updateCouncilRunState(council.id, {
          status: 'error',
          currentRound: latestRound,
        });
      }
    } finally {
      abortRef.current = null;
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (
      initialAutoPrompt &&
      initialAutoPrompt.trim() &&
      council &&
      autoStartedRef.current !== council.id &&
      !isRunning &&
      messages.length === 0
    ) {
      autoStartedRef.current = council.id;
      const p = initialAutoPrompt;
      onClearInitialPrompt();
      void executeCouncilRun({
        promptText: p,
        startRound: council.mode === 'chat' ? 0 : 1,
        existingHistory: [],
      });
    }
  }, [initialAutoPrompt, council, isRunning, messages.length]);

  const handleStop = async () => {
    if (!council) return;
    abortRef.current?.abort();
    await stopCouncilRunApi(council.id).catch(() => undefined);
    setStreamingMap((prev) => {
      const next: Record<string, StreamingBufferItem> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v.status !== 'streaming') {
          next[k] = v;
        }
      }
      return next;
    });
    setIsRunning(false);
    await updateCouncilRunState(council.id, { status: 'stopped' }).catch(() => undefined);
  };

  const handleCopy = useCallback(async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }, []);

  const handleRegisterMessageEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) messageElsRef.current[id] = el;
    else delete messageElsRef.current[id];
  }, []);

  const handleCopyMessage = useCallback(
    (id: string, text: string) => {
      void handleCopy(id, text);
    },
    [handleCopy],
  );

  const handleToggleUserReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!council) return;
      const targetMsg = messagesRef.current.find((m) => m.id === messageId);
      const base =
        reactionsCacheRef.current.get(messageId) ??
        targetMsg?.reactions ??
        pendingReactionsRef.current.get(messageId) ??
        [];
      const alreadyReacted = base.some(
        (r) => (r.reactorId === 'user' || r.reactorType === 'user') && r.emoji === emoji,
      );
      let next: MessageReaction[];
      if (alreadyReacted) {
        next = base.filter(
          (r) => !((r.reactorId === 'user' || r.reactorType === 'user') && r.emoji === emoji),
        );
      } else {
        if (base.length >= 16) return;
        next = [
          ...base,
          {
            emoji,
            reactorId: 'user',
            reactorLabel: 'You',
            reactorType: 'user',
          },
        ];
      }

      if (targetMsg) {
        persistMessageReactions(messageId, next);
      } else {
        reactionsCacheRef.current.set(messageId, next);
        if (next.length > 0) {
          pendingReactionsRef.current.set(messageId, next);
        } else {
          pendingReactionsRef.current.delete(messageId);
        }
        setOptimisticReactions((prev) => ({ ...prev, [messageId]: next }));
        setOptimisticUserMsg((prev) =>
          prev && prev.id === messageId ? { ...prev, reactions: next } : prev,
        );
        setStreamingMap((prev) => {
          const cur = prev[messageId];
          if (!cur) return prev;
          return { ...prev, [messageId]: { ...cur, reactions: next } };
        });
      }
    },
    [council, persistMessageReactions],
  );

  const handleExportMarkdown = () => {
    if (!council) return;
    const modeName =
      council.mode === 'chat'
        ? council.selectedModels.length === 1
          ? 'Single Model Chat'
          : 'Free Chat'
        : council.mode === 'debate'
          ? 'Structured Debate'
          : 'Free Discussion';
    const lines: string[] = [
      `# ${council.title}`,
      `Mode: ${modeName}`,
      `Models: ${council.selectedModels.join(', ')}`,
      ...(council.mode !== 'chat' ? [`Moderator: ${council.moderatorModel}`] : []),
      '',
    ];
    for (const m of messages) {
      lines.push(`## ${m.stageLabel} — ${m.modelLabel} (${m.status})`);
      lines.push('');
      lines.push(m.content || (m.errorMessage ? `Error: ${m.errorMessage}` : '(empty)'));
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${council.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJSON = () => {
    if (!council) return;
    const payload = { council, messages, fallbackHistory };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${council.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allItems = useMemo<Array<CouncilMessageDoc | StreamingBufferItem>>(() => {
    const persistedIds = new Set(messages.map((m) => m.id));
    const list: Array<CouncilMessageDoc | StreamingBufferItem> = messages.map((m) => {
      const opt = optimisticReactions[m.id];
      return opt ? { ...m, reactions: opt } : m;
    });
    if (optimisticUserMsg && !persistedIds.has(optimisticUserMsg.id)) {
      const opt = optimisticReactions[optimisticUserMsg.id];
      list.push(opt ? { ...optimisticUserMsg, reactions: opt } : optimisticUserMsg);
    }
    for (const s of Object.values(streamingMap)) {
      if (!persistedIds.has(s.messageId)) {
        const opt = optimisticReactions[s.messageId];
        list.push(opt ? { ...s, reactions: opt } : s);
      }
    }
    return list;
  }, [messages, optimisticUserMsg, streamingMap, optimisticReactions]);

  const activeFallbacksByOriginal = useMemo(() => {
    const map = new Map<string, FallbackRecord>();
    for (const fb of fallbackHistory) {
      map.set(fb.originalCompositeId, fb);
    }
    return map;
  }, [fallbackHistory]);

  const duplicateModelSet = useMemo(() => {
    if (!council) return new Set<string>();
    return getDuplicateProviderCompositeSet(
      council.selectedModels.map(
        (cid) => activeFallbacksByOriginal.get(cid)?.fallbackCompositeId || cid,
      ),
    );
  }, [council, activeFallbacksByOriginal]);

  const mentionModels = useMemo<MentionModelOption[]>(() => {
    if (!council) return [];
    const seen = new Set<string>();
    const options: MentionModelOption[] = [];
    for (const originalId of council.selectedModels) {
      const fb = activeFallbacksByOriginal.get(originalId);
      const activeId = fb ? fb.fallbackCompositeId : originalId;
      if (seen.has(activeId)) continue;
      seen.add(activeId);
      const idx = activeId.indexOf(':');
      const rawProvider = idx === -1 ? 'google' : activeId.slice(0, idx);
      const modelId = idx === -1 ? activeId : activeId.slice(idx + 1);
      const providerId: ProviderId = isValidProviderId(rawProvider) ? rawProvider : 'google';
      const baseVisual = getProviderVisual(providerId);
      const useModelLogo = duplicateModelSet.has(activeId);
      const modelVisual = useModelLogo
        ? getModelVisualIdentity(providerId, modelId, true)
        : null;
      options.push({
        compositeId: activeId,
        providerId,
        modelId,
        shortName: baseVisual.shortName,
        accentHex: modelVisual ? modelVisual.accentHex : baseVisual.accentHex,
        useModelLogo,
      });
    }
    return options;
  }, [council, activeFallbacksByOriginal, duplicateModelSet]);

  const lastUserMessageText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user' && messages[i].content.trim()) {
        return messages[i].content;
      }
    }
    return '';
  }, [messages]);

  const filterModelChips = useMemo<FilterModelChip[]>(() => {
    if (!council) return [];
    const seen = new Set<string>();
    const list: FilterModelChip[] = [];
    for (const originalId of council.selectedModels) {
      const fb = activeFallbacksByOriginal.get(originalId);
      const activeId = fb ? fb.fallbackCompositeId : originalId;
      if (!seen.has(activeId)) {
        seen.add(activeId);
        list.push(resolveFilterModelChip(activeId));
      }
    }
    return list;
  }, [council, activeFallbacksByOriginal]);

  const visibleItems = useMemo(() => {
    if (selectedFilter === 'all') return allItems;
    return allItems.filter((item) => {
      if (item.role === 'user') return true;
      return `${item.provider}:${item.modelId}` === selectedFilter;
    });
  }, [allItems, selectedFilter]);

  const groupedRounds = useMemo(() => {
    const groups = new Map<number, Array<CouncilMessageDoc | StreamingBufferItem>>();
    for (const item of visibleItems) {
      const list = groups.get(item.round) || [];
      list.push(item);
      groups.set(item.round, list);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [visibleItems]);

  const roundNumbers = useMemo(
    () => groupedRounds.map(([roundNum]) => roundNum),
    [groupedRounds],
  );

  const persistedErrors = useMemo(() => {
    if (liveErrors.length > 0) return liveErrors;
    return messages
      .filter((m) => m.status === 'error')
      .map((m) => ({
        id: m.id,
        provider: m.provider,
        modelId: m.modelId,
        round: m.round,
        stageLabel: m.stageLabel,
        errorCode: 'error',
        message: m.errorMessage || 'Provider request failed.',
      }));
  }, [liveErrors, messages]);

  const streamingContentLength = useMemo(
    () => Object.values(streamingMap).reduce((sum, s) => sum + s.content.length, 0),
    [streamingMap],
  );

  // Sync dynamic spacer height synchronously after layout whenever items change or container resizes
  useLayoutEffect(() => {
    const { spacerPx } = computeTurnMetrics();
    if (Math.abs(spacerPx - bottomSpacerPx) >= 1) {
      setBottomSpacerPx(spacerPx);
    }
  }, [allItems.length, streamingContentLength, activeTurnUserId, bottomSpacerPx, computeTurnMetrics]);

  const scrollToLatest = useCallback(() => {
    userScrolledAwayRef.current = false;
    setShowScrollButton(false);
    setHasNewMessages(false);
    startSmoothScroll('anchor_glide');
  }, [startSmoothScroll]);

  // Smoothly follow new items / streaming deltas unless the user scrolled away manually
  useEffect(() => {
    if (allItems.length === 0) return;
    if (userScrolledAwayRef.current) {
      if (isRunning) setHasNewMessages(true);
      return;
    }
    startSmoothScroll(anchorGlideActiveRef.current ? 'anchor_glide' : 'follow');
  }, [allItems.length, streamingContentLength, isRunning, activeTurnUserId, startSmoothScroll]);

  useEffect(() => {
    if (roundNumbers.length === 0) {
      setActiveRound(null);
    } else if (activeRound === null || !roundNumbers.includes(activeRound)) {
      setActiveRound(roundNumbers[roundNumbers.length - 1]);
    }
  }, [roundNumbers, activeRound]);

  const handleUserScrollIntent = () => {
    if (scrollRafRef.current !== null) {
      stopScrollAnimation();
    }
  };

  const handleContainerScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const currentTop = el.scrollTop;
    const { targetTop } = computeTurnMetrics();
    const maxPossible = Math.max(0, el.scrollHeight - el.clientHeight);
    const effectiveTarget = Math.min(targetTop, maxPossible);
    const distanceFromTarget = effectiveTarget - currentTop;

    if (!programmaticScrollRef.current) {
      const scrolledUp = currentTop < prevScrollTopRef.current - 4;
      if (scrolledUp && distanceFromTarget > 48) {
        stopScrollAnimation();
        userScrolledAwayRef.current = true;
      } else if (distanceFromTarget <= 36) {
        userScrolledAwayRef.current = false;
      }
    }
    prevScrollTopRef.current = currentTop;

    setShowScrollButton(distanceFromTarget > 140);
    if (distanceFromTarget <= 48) {
      setHasNewMessages(false);
    }

    if (roundNumbers.length > 0) {
      const containerTop = el.getBoundingClientRect().top;
      let currentActive = roundNumbers[0];
      for (const r of roundNumbers) {
        const node = roundRefs.current[r];
        if (!node) continue;
        const offset = node.getBoundingClientRect().top - containerTop;
        if (offset <= 96) {
          currentActive = r;
        }
      }
      setActiveRound(currentActive);
    }
  };

  const handleJumpToRound = (round: number) => {
    setActiveRound(round);
    userScrolledAwayRef.current = true;
    stopScrollAnimation();
    const target = roundRefs.current[round];
    if (target) {
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    }
  };

  if (!council) {
    return (
      <AppShell
        currentRoute="council-room"
        pageTitle="Council Room"
        breadcrumb="History"
        onNavigate={onNavigate}
        fullBleed
      >
        <div className="council-chat-mesh w-full h-full flex items-center justify-center px-4">
          <div className="bg-white/[0.05] backdrop-blur-xl border border-white/10 rounded-2xl p-8 text-center space-y-3 max-w-md w-full">
            <p className="text-sm text-[#CBD5E1]">Loading Council Room or room not found.</p>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="px-4 py-2 text-xs font-medium bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Back to History
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  const isChatMode = council.mode === 'chat';
  const isSingleModelChat = isChatMode && council.selectedModels.length === 1;
  const modeLabel = isSingleModelChat
    ? 'Single Model Chat'
    : isChatMode
      ? 'Free Chat'
      : council.mode === 'debate'
        ? 'Structured Debate'
        : 'Free Discussion';
  const nextRound = Math.min(Math.max(council.currentRound, 1), 6);

  const warningCount =
    (preflightState?.rejectedModels.length || 0) +
    fallbackHistory.length +
    removedModels.length;
  const errorCount = persistedErrors.length;

  const handleSelectReplyTarget = useCallback(
    (item: CouncilMessageDoc | StreamingBufferItem) => {
      const id = 'id' in item ? item.id : item.messageId;
      const snippet = item.content.replace(/\s+/g, ' ').trim().slice(0, 220);
      setReplyTarget({
        messageId: id,
        role: item.role,
        provider: item.provider,
        modelId: item.modelId,
        modelLabel: item.modelLabel,
        snippet,
      });
    },
    [],
  );

  const handleJumpToMessage = useCallback(
    (targetMessageId: string) => {
      const triggerHighlight = (el: HTMLElement) => {
        userScrolledAwayRef.current = true;
        stopScrollAnimation();
        el.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'center',
        });
        setHighlightedMessageId(targetMessageId);
        if (highlightTimerRef.current !== null) {
          window.clearTimeout(highlightTimerRef.current);
        }
        highlightTimerRef.current = window.setTimeout(() => {
          setHighlightedMessageId((cur) => (cur === targetMessageId ? null : cur));
        }, 1600);
      };

      const existingEl = messageElsRef.current[targetMessageId];
      if (existingEl) {
        triggerHighlight(existingEl);
        return;
      }
      if (selectedFilter !== 'all') {
        setSelectedFilter('all');
        requestAnimationFrame(() => {
          const el = messageElsRef.current[targetMessageId];
          if (el) triggerHighlight(el);
        });
      }
    },
    [selectedFilter, stopScrollAnimation],
  );

  const handleSendComposer = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text || isRunning) return;
      const activeReply = replyTarget || undefined;
      setReplyTarget(null);
      userScrolledAwayRef.current = false;
      const presetId = generateSafeId('msg');
      void executeCouncilRun({
        promptText: text,
        startRound: isChatMode
          ? 0
          : messages.length === 0
            ? 1
            : Math.min(nextRound + 1, 6),
        existingHistory: messages,
        presetUserMsgId: presetId,
        replyTo: activeReply,
      });
    },
    [isRunning, replyTarget, isChatMode, messages, nextRound],
  );

  const handleQueueMessage = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      const activeReply = replyTarget || undefined;
      setReplyTarget(null);
      setQueuedPrompt({ text, replyTo: activeReply });
    },
    [replyTarget],
  );

  const handleCancelQueue = useCallback(() => setQueuedPrompt(null), []);
  const handleForceSendQueued = useCallback(() => {
    void handleStop();
  }, [handleStop]);

  useEffect(() => {
    if (isRunning || !queuedPrompt || !council) return;
    const pending = queuedPrompt;
    setQueuedPrompt(null);
    userScrolledAwayRef.current = false;
    const presetId = generateSafeId('msg');
    void executeCouncilRun({
      promptText: pending.text,
      startRound: isChatMode
        ? 0
        : messages.length === 0
          ? 1
          : Math.min(nextRound + 1, 6),
      existingHistory: messages,
      presetUserMsgId: presetId,
      replyTo: pending.replyTo,
    });
  }, [isRunning, queuedPrompt, council, isChatMode, messages, nextRound]);

  const handleCancelReply = useCallback(() => setReplyTarget(null), []);
  const handleSelectExamplePrompt = useCallback((prompt: string) => {
    setExternalDraft((prev) => ({ text: prompt, seq: (prev?.seq || 0) + 1 }));
  }, []);
  const handleReusePrompt = useCallback((text: string) => {
    setExternalDraft((prev) => ({ text, seq: (prev?.seq || 0) + 1 }));
  }, []);
  const handleRetryLastTurn = useCallback(() => {
    if (isRunning || !lastUserMessageText) return;
    setExternalDraft((prev) => ({ text: lastUserMessageText, seq: (prev?.seq || 0) + 1 }));
  }, [isRunning, lastUserMessageText]);

  return (
    <AppShell
      currentRoute="council-room"
      pageTitle={council.title}
      breadcrumb={modeLabel}
      onNavigate={onNavigate}
      fullBleed
      hideTopBar
    >
      <MotionConfig reducedMotion="user">
        <div className="council-chat-mesh w-full h-full flex flex-col relative overflow-hidden">
          {/* Full-width slim Messenger/Discord Header */}
          <ChatHeader
            council={council}
            modeLabel={modeLabel}
            isChatMode={isChatMode}
            isRunning={isRunning}
            preflightState={preflightState}
            activeFallbacksByOriginal={activeFallbacksByOriginal}
            warningCount={warningCount}
            errorCount={errorCount}
            runDetailsOpen={runDetailsOpen}
            onToggleRunDetails={() => setRunDetailsOpen((prev) => !prev)}
            onStop={() => void handleStop()}
            onExportMarkdown={handleExportMarkdown}
            onExportJSON={handleExportJSON}
          />

          {/* Collapsible Run Details Drawer */}
          <RunDetailsDrawer
            open={runDetailsOpen}
            onClose={() => setRunDetailsOpen(false)}
            preflightState={preflightState}
            fallbackHistory={fallbackHistory}
            persistedErrors={persistedErrors}
            removedModels={removedModels}
          />

          {/* Compact Filter & Round Bar (only when useful) */}
          {(filterModelChips.length > 1 || (!isChatMode && roundNumbers.length > 0)) && (
            <RoundNav
              filterModels={filterModelChips}
              selectedFilter={selectedFilter}
              onSelectFilter={setSelectedFilter}
              rounds={roundNumbers}
              activeRound={activeRound}
              onSelectRound={handleJumpToRound}
              isChatMode={isChatMode}
            />
          )}

          {/* Full-screen Scrollable Message Feed */}
          <div
            ref={scrollContainerRef}
            onScroll={handleContainerScroll}
            onWheel={handleUserScrollIntent}
            onTouchStart={handleUserScrollIntent}
            onPointerDown={handleUserScrollIntent}
            className="council-scroll-area flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 sm:px-5"
          >
            <div className="mx-auto w-full max-w-5xl pt-3">
              <div ref={feedInnerRef} className="space-y-2.5">
                {runError && (
                  <div className="rounded-xl bg-rose-950/45 border border-rose-500/35 px-3.5 py-2.5 text-xs sm:text-sm text-rose-200 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                    <span>{runError}</span>
                  </div>
                )}

                {allItems.length === 0 && !isRunning && (
                  <EmptyWelcomeState
                    selectedModels={council.selectedModels}
                    isChatMode={isChatMode}
                    onSelectPrompt={handleSelectExamplePrompt}
                  />
                )}

                {isChatMode ? (
                  <div className="space-y-2">
                    {visibleItems.map((item, idx) => {
                      const itemId = 'id' in item ? item.id : item.messageId;
                      return (
                        <MessageBubble
                          key={itemId}
                          item={item}
                          index={idx}
                          isChatMode={isChatMode}
                          isCopied={copiedId === itemId}
                          duplicateModelSet={duplicateModelSet}
                          onCopy={handleCopyMessage}
                          onToggleReaction={handleToggleUserReaction}
                          onReply={handleSelectReplyTarget}
                          onReusePrompt={handleReusePrompt}
                          onRetryTurn={lastUserMessageText ? handleRetryLastTurn : undefined}
                          onJumpToMessage={handleJumpToMessage}
                          highlighted={highlightedMessageId === itemId}
                          onRegisterEl={handleRegisterMessageEl}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groupedRounds.map(([roundNum, items]) => (
                      <section
                        key={roundNum}
                        ref={(el) => {
                          roundRefs.current[roundNum] = el;
                        }}
                        className="space-y-2 scroll-mt-3"
                      >
                        <div className="flex items-center gap-3 py-0.5">
                          <div className="h-px flex-1 bg-white/10" />
                          <span className="font-display text-[10.5px] font-semibold uppercase tracking-wider text-[#9AA7BF] px-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/10 whitespace-nowrap">
                            Round {roundNum}
                          </span>
                          <div className="h-px flex-1 bg-white/10" />
                        </div>
                        <div className="space-y-2">
                          {items.map((item, idx) => {
                            const itemId = 'id' in item ? item.id : item.messageId;
                            return (
                              <MessageBubble
                                key={itemId}
                                item={item}
                                index={idx}
                                isChatMode={isChatMode}
                                isCopied={copiedId === itemId}
                                duplicateModelSet={duplicateModelSet}
                                onCopy={handleCopyMessage}
                                onToggleReaction={handleToggleUserReaction}
                                onReply={handleSelectReplyTarget}
                                onReusePrompt={handleReusePrompt}
                                onRetryTurn={lastUserMessageText ? handleRetryLastTurn : undefined}
                                onJumpToMessage={handleJumpToMessage}
                                highlighted={highlightedMessageId === itemId}
                                onRegisterEl={handleRegisterMessageEl}
                              />
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>

              {/* Dynamic Turn-Anchor Spacer: allows new user message to sit near top while AI replies fill beneath */}
              <div
                style={{ height: `${Math.max(12, bottomSpacerPx)}px` }}
                aria-hidden="true"
              />
            </div>
          </div>

          {/* Floating Scroll to Latest Button anchored cleanly above the dynamic Composer dock */}
          <div className="relative w-full shrink-0">
            <AnimatePresence>
              {showScrollButton && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 32 }}
                  className="pointer-events-none absolute right-4 sm:right-6 bottom-3 z-30"
                >
                  <button
                    type="button"
                    onClick={scrollToLatest}
                    aria-label={hasNewMessages ? 'Jump to new messages' : 'Scroll to latest'}
                    className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/18 bg-[#141A30] text-xs font-semibold text-[#E6EBF5] hover:text-white shadow-[0_8px_24px_rgba(0,0,0,0.45)] cursor-pointer transition-colors"
                  >
                    {hasNewMessages && (
                      <span className="w-2 h-2 rounded-full bg-[#7AA7FF] shrink-0" />
                    )}
                    <span>{hasNewMessages ? 'New' : 'Latest'}</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Docked Messenger/Discord/WhatsApp Bottom Input Bar */}
            <Composer
              councilId={council.id}
              selectedModels={council.selectedModels}
              mentionModels={mentionModels}
              isChatMode={isChatMode}
              isRunning={isRunning}
              hasMessages={messages.length > 0}
              externalDraft={externalDraft}
              replyTarget={replyTarget}
              queuedPrompt={queuedPrompt}
              lastUserMessageText={lastUserMessageText}
              onCancelReply={handleCancelReply}
              onSend={handleSendComposer}
              onQueueMessage={handleQueueMessage}
              onCancelQueue={handleCancelQueue}
              onForceSendQueued={handleForceSendQueued}
              onStop={() => void handleStop()}
              onRunModeratorVerdict={() => {
                userScrolledAwayRef.current = false;
                setActiveTurnUserId(null);
                void executeCouncilRun({
                  promptText: '',
                  startRound: nextRound,
                  moderateOnly: true,
                  existingHistory: messages,
                });
              }}
            />
          </div>
        </div>
      </MotionConfig>
    </AppShell>
  );
}
