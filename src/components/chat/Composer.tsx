import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  Clock,
  Reply,
  Scale,
  SendHorizontal,
  Square,
  X,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { isValidProviderId } from '../../shared/providers';
import type { ProviderId, ReplyToRef } from '../../shared/types';
import {
  getDuplicateProviderCompositeSet,
  getProviderVisual,
  ProviderAvatar,
} from '../ProviderBadge';

function parseProviderComposite(compositeId: string): {
  providerId: ProviderId;
  modelId: string;
} {
  const idx = compositeId.indexOf(':');
  if (idx === -1) return { providerId: 'google', modelId: compositeId };
  const raw = compositeId.slice(0, idx);
  return {
    providerId: isValidProviderId(raw) ? raw : 'google',
    modelId: compositeId.slice(idx + 1),
  };
}

function draftStorageKey(councilId?: string): string | null {
  return councilId ? `tut_council_draft_v1_${councilId}` : null;
}

function readStoredDraft(councilId?: string): string {
  if (typeof window === 'undefined') return '';
  const key = draftStorageKey(councilId);
  if (!key) return '';
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export interface MentionModelOption {
  compositeId: string;
  providerId: ProviderId;
  modelId: string;
  shortName: string;
  accentHex: string;
  useModelLogo?: boolean;
}

const CHAT_EXAMPLE_PROMPTS = [
  'Compare Postgres vs. Firestore for a multi-tenant SaaS',
  'Review a TypeScript rate-limiter for race conditions',
  'Draft a zero-downtime deployment checklist',
];

const COUNCIL_EXAMPLE_PROMPTS = [
  'What is the highest-leverage architecture choice for year one?',
  'Debate serverless edge vs. unified container for SSE AI workloads',
  'Design a zero-trust API key rotation system',
];

export const EmptyWelcomeState = memo(function EmptyWelcomeState({
  selectedModels,
  isChatMode,
  onSelectPrompt,
}: {
  selectedModels: string[];
  isChatMode: boolean;
  modeLabel?: string;
  onSelectPrompt: (prompt: string) => void;
}) {
  const examples = isChatMode ? CHAT_EXAMPLE_PROMPTS : COUNCIL_EXAMPLE_PROMPTS;
  const duplicateSet = useMemo(
    () => getDuplicateProviderCompositeSet(selectedModels),
    [selectedModels],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto max-w-xl py-10 sm:py-16 px-2 text-center space-y-5"
    >
      <div className="flex items-center justify-center pl-2.5">
        {selectedModels.slice(0, 6).map((compositeId) => {
          const parsed = parseProviderComposite(compositeId);
          return (
            <div
              key={compositeId}
              className="-ml-2.5 rounded-full ring-3 ring-[#0A0F1E]"
            >
              <ProviderAvatar
                provider={parsed.providerId}
                modelId={parsed.modelId}
                useModelLogo={duplicateSet.has(compositeId)}
                size="md"
                glow
              />
            </div>
          );
        })}
      </div>

      <h2 className="font-display text-lg sm:text-xl font-bold text-[#F4F7FD] tracking-tight">
        {isChatMode ? 'Start chatting' : 'Start Council deliberation'}
      </h2>

      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {examples.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelectPrompt(prompt)}
            className="rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 hover:border-white/20 px-3.5 py-2 text-xs text-[#CBD5E1] hover:text-white transition-colors cursor-pointer"
          >
            {prompt}
          </button>
        ))}
      </div>
    </motion.div>
  );
});

export const Composer = memo(function Composer({
  councilId,
  mentionModels = [],
  isChatMode,
  isRunning,
  hasMessages,
  externalDraft,
  replyTarget,
  queuedPrompt,
  lastUserMessageText,
  onCancelReply,
  onSend,
  onQueueMessage,
  onCancelQueue,
  onForceSendQueued,
  onStop,
  onRunModeratorVerdict,
}: {
  councilId?: string;
  selectedModels?: string[];
  mentionModels?: MentionModelOption[];
  isChatMode: boolean;
  isRunning: boolean;
  hasMessages: boolean;
  externalDraft?: { text: string; seq: number } | null;
  replyTarget?: ReplyToRef | null;
  queuedPrompt?: { text: string; replyTo?: ReplyToRef } | null;
  lastUserMessageText?: string;
  onCancelReply?: () => void;
  onSend: (text: string) => void;
  onQueueMessage?: (text: string) => void;
  onCancelQueue?: () => void;
  onForceSendQueued?: () => void;
  onStop: () => void;
  onRunModeratorVerdict: () => void;
}) {
  const prefersReduced = Boolean(useReducedMotion());
  const [draft, setDraft] = useState(() => readStoredDraft(councilId));
  const [mentionMatch, setMentionMatch] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const lastHeightRef = useRef<number>(32);

  const scheduleResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    if (resizeRafRef.current !== null) {
      window.cancelAnimationFrame(resizeRafRef.current);
    }
    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null;
      if (!el.value) {
        if (lastHeightRef.current !== 32) {
          lastHeightRef.current = 32;
          el.style.height = '32px';
        }
        return;
      }
      el.style.height = 'auto';
      const target = Math.min(Math.max(el.scrollHeight, 32), 132);
      lastHeightRef.current = target;
      el.style.height = `${target}px`;
    });
  }, []);

  // Load saved draft whenever room changes
  useEffect(() => {
    const saved = readStoredDraft(councilId);
    setDraft(saved);
    setMentionMatch(null);
    lastHeightRef.current = 32;
    const el = textareaRef.current;
    if (el) {
      el.value = saved;
      scheduleResize(el);
    }
  }, [councilId, scheduleResize]);

  // Debounced draft persistence per council room
  useEffect(() => {
    const key = draftStorageKey(councilId);
    if (!key || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      try {
        if (draft) {
          window.localStorage.setItem(key, draft);
        } else {
          window.localStorage.removeItem(key);
        }
      } catch {
        // Ignore storage quota errors
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [councilId, draft]);

  useEffect(() => {
    return () => {
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!externalDraft) return;
    setDraft(externalDraft.text);
    setMentionMatch(null);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      window.requestAnimationFrame(() => {
        const end = externalDraft.text.length;
        try {
          el.setSelectionRange(end, end);
        } catch {
          // Ignore selection errors
        }
        scheduleResize(el);
      });
    }
  }, [externalDraft, scheduleResize]);

  useEffect(() => {
    if (replyTarget) {
      textareaRef.current?.focus();
    }
  }, [replyTarget]);

  const updateMentionContext = useCallback(
    (value: string, cursorPos: number | null) => {
      if (mentionModels.length <= 1 || cursorPos === null) {
        setMentionMatch(null);
        return;
      }
      const beforeCursor = value.slice(0, cursorPos);
      const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(beforeCursor);
      if (!m) {
        setMentionMatch(null);
        return;
      }
      const query = m[1];
      const start = cursorPos - query.length - 1;
      setMentionMatch({ start, end: cursorPos, query });
      setMentionIndex(0);
    },
    [mentionModels.length],
  );

  const filteredMentions = useMemo(() => {
    if (!mentionMatch) return [];
    const q = mentionMatch.query.toLowerCase();
    if (!q) return mentionModels;
    return mentionModels.filter(
      (opt) =>
        opt.shortName.toLowerCase().includes(q) ||
        opt.modelId.toLowerCase().includes(q) ||
        opt.providerId.toLowerCase().includes(q),
    );
  }, [mentionMatch, mentionModels]);

  const applyMention = useCallback(
    (opt: MentionModelOption) => {
      if (!mentionMatch) return;
      const handle = opt.modelId.split('/').pop()?.split(':')[0] || opt.shortName;
      const insertion = `@${handle} `;
      const next =
        draft.slice(0, mentionMatch.start) + insertion + draft.slice(mentionMatch.end);
      setDraft(next);
      setMentionMatch(null);
      const nextCursor = mentionMatch.start + insertion.length;
      const el = textareaRef.current;
      if (el) {
        el.focus();
        window.requestAnimationFrame(() => {
          try {
            el.setSelectionRange(nextCursor, nextCursor);
          } catch {
            // Ignore selection errors
          }
          scheduleResize(el);
        });
      }
    },
    [draft, mentionMatch, scheduleResize],
  );

  const triggerMentionButton = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const needsSpace = start > 0 && !/\s/.test(draft[start - 1]);
    const prefix = needsSpace ? ' @' : '@';
    const next = draft.slice(0, start) + prefix + draft.slice(end);
    const nextCursor = start + prefix.length;
    setDraft(next);
    el.focus();
    window.requestAnimationFrame(() => {
      try {
        el.setSelectionRange(nextCursor, nextCursor);
      } catch {
        // Ignore selection errors
      }
      updateMentionContext(next, nextCursor);
      scheduleResize(el);
    });
  }, [draft, scheduleResize, updateMentionContext]);

  const trimmed = draft.trim();
  const hasText = trimmed.length > 0;
  const canSendNow = hasText && !isRunning;
  const canQueue = hasText && isRunning && Boolean(onQueueMessage);

  const clearDraftState = useCallback(() => {
    setDraft('');
    setMentionMatch(null);
    const key = draftStorageKey(councilId);
    if (key && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore storage errors
      }
    }
    const el = textareaRef.current;
    if (el) {
      lastHeightRef.current = 32;
      el.style.height = '32px';
    }
  }, [councilId]);

  const submitMessage = useCallback(() => {
    const clean = draft.trim();
    if (!clean) return;
    if (isRunning) {
      if (onQueueMessage) {
        clearDraftState();
        onQueueMessage(clean);
      }
      return;
    }
    clearDraftState();
    onSend(clean);
  }, [clearDraftState, draft, isRunning, onQueueMessage, onSend]);

  const replyVisual = replyTarget ? getProviderVisual(replyTarget.provider) : null;
  const replySenderName = replyTarget
    ? replyTarget.role === 'user' || replyTarget.provider === 'user'
      ? 'You'
      : replyTarget.role === 'moderator'
        ? `${replyVisual?.shortName || 'Council'} Moderator`
        : replyVisual?.shortName || replyTarget.modelLabel
    : '';

  return (
    <footer className="w-full shrink-0 border-t border-white/[0.08] bg-[#0B1123]/96 px-3 sm:px-5 pt-2 pb-[max(0.55rem,env(safe-area-inset-bottom))]">
      <div className="relative mx-auto w-full max-w-5xl flex flex-col gap-1.5">
        {/* Telegram-Style @Model Mention Autocomplete Popover */}
        <AnimatePresence>
          {mentionMatch && filteredMentions.length > 0 && (
            <motion.div
              key="mention-popover"
              initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.6 }}
              role="listbox"
              aria-label="Mention council model"
              className="rounded-2xl bg-[#10162B] border border-white/15 shadow-[0_18px_44px_rgba(0,0,0,0.75)] p-1.5 max-h-52 overflow-y-auto"
            >
              <div className="px-2 py-1 text-[10.5px] font-medium text-[#8E9BB3]">
                Mention a participant
              </div>
              {filteredMentions.map((opt, idx) => {
                const active = idx === mentionIndex;
                return (
                  <button
                    key={opt.compositeId}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(opt);
                    }}
                    onMouseEnter={() => setMentionIndex(idx)}
                    className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-xl text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#4F5BEF]/25 text-white'
                        : 'text-[#CBD5E1] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ProviderAvatar
                        provider={opt.providerId}
                        modelId={opt.modelId}
                        useModelLogo={opt.useModelLogo}
                        size="xs"
                      />
                      <span
                        className="font-display text-xs font-semibold shrink-0"
                        style={{ color: opt.accentHex }}
                      >
                        {opt.shortName}
                      </span>
                      <span className="font-mono text-[11px] text-[#9AA7BF] truncate">
                        {opt.modelId}
                      </span>
                    </div>
                    <span className="text-[10.5px] font-mono text-[#7AA7FF] shrink-0">
                      @{opt.modelId.split('/').pop()?.split(':')[0]}
                    </span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Queued Follow-Up Banner (when drafted & sent while AI is still streaming) */}
        <AnimatePresence>
          {queuedPrompt && (
            <motion.div
              key="queued-banner"
              initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 500, damping: 34, mass: 0.6 }}
              className="flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-2xl bg-[#4F5BEF]/14 border border-[#7AA7FF]/35 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="w-3.5 h-3.5 text-[#7AA7FF] shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-[#E6EBF5]">Queued next</span>
                  <p className="text-[11px] text-[#CBD5E1] truncate max-w-[55vw] sm:max-w-[500px]">
                    {queuedPrompt.text}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onForceSendQueued && (
                  <button
                    type="button"
                    onClick={onForceSendQueued}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#4F5BEF]/35 hover:bg-[#4F5BEF]/55 border border-[#7AA7FF]/45 text-[11px] font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Send now</span>
                  </button>
                )}
                {onCancelQueue && (
                  <button
                    type="button"
                    onClick={onCancelQueue}
                    aria-label="Cancel queued message"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active Reply Preview Banner */}
        <AnimatePresence>
          {replyTarget && (
            <motion.div
              key="reply-banner"
              initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 500, damping: 34, mass: 0.6 }}
              className="flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-2xl bg-white/[0.06] border border-white/12 text-xs will-change-transform"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Reply className="w-3.5 h-3.5 text-[#7AA7FF] shrink-0" />
                <ProviderAvatar
                  provider={replyTarget.provider}
                  modelId={replyTarget.modelId || undefined}
                  role={replyTarget.role}
                  size="micro"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[#9AA7BF] shrink-0">Replying to</span>
                    <span
                      className="font-display font-semibold truncate"
                      style={{
                        color:
                          replyTarget.role === 'moderator'
                            ? '#F6C453'
                            : replyTarget.role === 'user'
                              ? '#E6EBF5'
                              : replyVisual?.accentHex || '#E6EBF5',
                      }}
                    >
                      {replySenderName}
                    </span>
                    {replyTarget.role !== 'user' && replyTarget.modelId && (
                      <span className="hidden sm:inline font-mono text-[10.5px] text-[#8E9BB3] truncate max-w-[180px]">
                        {replyTarget.modelId}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#9AA7BF] truncate max-w-[70vw] sm:max-w-[540px]">
                    {replyTarget.snippet || '(empty message)'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onCancelReply}
                aria-label="Cancel reply"
                title="Cancel reply"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-2">
          {!isChatMode && hasMessages && (
            <motion.button
              type="button"
              whileTap={prefersReduced ? undefined : { scale: 0.94 }}
              disabled={isRunning}
              onClick={onRunModeratorVerdict}
              title="Run Moderator Verdict"
              className="inline-flex items-center justify-center gap-1.5 px-3 h-[40px] rounded-full text-xs font-medium bg-white/[0.06] hover:bg-white/12 disabled:opacity-45 border border-amber-300/30 text-amber-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Scale className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="hidden sm:inline">Verdict</span>
            </motion.button>
          )}

          <div className="flex-1 rounded-[22px] bg-white/[0.07] border border-white/[0.12] focus-within:border-[#7AA7FF]/55 focus-within:bg-white/[0.085] pl-2.5 pr-1.5 py-1 flex items-end gap-1.5 transition-colors duration-150">
            {mentionModels.length > 1 && (
              <button
                type="button"
                onClick={triggerMentionButton}
                aria-label="Mention a model"
                title="Mention a model (@)"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                <AtSign className="w-4 h-4" />
              </button>
            )}

            <label htmlFor="council-message-composer" className="sr-only">
              Message
            </label>
            <textarea
              ref={textareaRef}
              id="council-message-composer"
              rows={1}
              value={draft}
              onChange={(e) => {
                const val = e.target.value;
                setDraft(val);
                updateMentionContext(val, e.currentTarget.selectionStart);
                scheduleResize(e.currentTarget);
              }}
              onClick={(e) => {
                updateMentionContext(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart,
                );
              }}
              onKeyDown={(e) => {
                if (mentionMatch && filteredMentions.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex((prev) => (prev + 1) % filteredMentions.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex(
                      (prev) => (prev - 1 + filteredMentions.length) % filteredMentions.length,
                    );
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    const picked = filteredMentions[mentionIndex] || filteredMentions[0];
                    if (picked) applyMention(picked);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setMentionMatch(null);
                    return;
                  }
                }

                if (e.key === 'Escape' && replyTarget && onCancelReply) {
                  e.preventDefault();
                  onCancelReply();
                  return;
                }

                if (
                  e.key === 'ArrowUp' &&
                  !draft &&
                  lastUserMessageText &&
                  e.currentTarget.selectionStart === 0
                ) {
                  e.preventDefault();
                  setDraft(lastUserMessageText);
                  window.requestAnimationFrame(() => {
                    const el = textareaRef.current;
                    if (!el) return;
                    const end = lastUserMessageText.length;
                    try {
                      el.setSelectionRange(end, end);
                    } catch {
                      // Ignore selection errors
                    }
                    scheduleResize(el);
                  });
                  return;
                }

                if (e.key === 'Enter' && !e.shiftKey && draft.trim()) {
                  e.preventDefault();
                  submitMessage();
                }
              }}
              placeholder={
                isRunning
                  ? 'Type next message (queues automatically)...'
                  : replyTarget
                    ? `Reply to ${replySenderName}...`
                    : isChatMode
                      ? 'Message...'
                      : 'Message Council...'
              }
              style={{ height: '32px' }}
              className="flex-1 bg-transparent border-0 text-[13.5px] sm:text-[14px] text-[#F4F7FD] placeholder-[#8E9BB3] focus:outline-none resize-none py-1.5 pl-1 leading-[1.4] max-h-[132px] overflow-y-auto"
            />

            {draft.length > 1200 && (
              <span className="self-center pr-1 font-mono text-[10px] text-[#9AA7BF] tabular-nums shrink-0">
                {draft.length.toLocaleString()}
              </span>
            )}

            <div className="flex items-center gap-1 shrink-0">
              {canQueue && (
                <motion.button
                  key="composer-queue-btn"
                  type="button"
                  initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.78 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.78 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                  whileTap={prefersReduced ? undefined : { scale: 0.88 }}
                  onClick={submitMessage}
                  aria-label="Queue message to send next"
                  title="Queue next message"
                  className="w-8 h-8 rounded-full bg-[#4F5BEF]/85 hover:bg-[#4F5BEF] text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  <Clock className="w-3.5 h-3.5" />
                </motion.button>
              )}

              <AnimatePresence mode="wait" initial={false}>
                {isRunning ? (
                  <motion.button
                    key="composer-stop-btn"
                    type="button"
                    initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                    whileTap={prefersReduced ? undefined : { scale: 0.88 }}
                    onClick={onStop}
                    aria-label="Stop generation"
                    title="Stop"
                    className="w-8 h-8 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 will-change-transform"
                  >
                    <Square className="w-3 h-3 fill-current" />
                  </motion.button>
                ) : (
                  <motion.button
                    key="composer-send-btn"
                    type="button"
                    disabled={!canSendNow}
                    onClick={submitMessage}
                    aria-label={isChatMode ? 'Send message' : 'Send to Council'}
                    initial={false}
                    animate={
                      prefersReduced
                        ? { opacity: canSendNow ? 1 : 0.35 }
                        : canSendNow
                          ? { scale: 1, rotate: 0, opacity: 1 }
                          : { scale: 0.86, rotate: -10, opacity: 0.35 }
                    }
                    transition={{ type: 'spring', stiffness: 540, damping: 26, mass: 0.55 }}
                    whileTap={
                      canSendNow && !prefersReduced
                        ? { scale: 0.84, x: 2, y: -2 }
                        : undefined
                    }
                    className="w-8 h-8 rounded-full text-white flex items-center justify-center cursor-pointer shrink-0 disabled:cursor-not-allowed shadow-[0_4px_14px_rgba(124,77,232,0.45)] will-change-transform"
                    style={{
                      background: 'linear-gradient(135deg, #4F5BEF, #7C4DE8)',
                    }}
                  >
                    <SendHorizontal className="w-4 h-4 -mr-0.5" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
});
