import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Reply,
  RotateCcw,
  Scale,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'motion/react';
import {
  clearReactionHistory,
  getReactionHistory,
  recordReactionHistory,
  subscribeReactionHistory,
} from '../../lib/reactionHistory';
import {
  QUICK_REACTION_EMOJIS,
  REACTION_PACK_CATEGORIES,
  type CouncilMessageDoc,
  type MessageReaction,
  type ReplyToRef,
} from '../../shared/types';
import { MarkdownContent } from '../MarkdownContent';
import {
  getModelVisualIdentity,
  getProviderVisual,
  parseReactorIdentity,
  ProviderAvatar,
} from '../ProviderBadge';
import type { StreamingBufferItem } from './types';
import { SWIPE_REPLY_THRESHOLD, useSwipeToReply } from './useSwipeToReply';

const COLLAPSE_CHAR_THRESHOLD = 900;
const HOVER_QUICK_EMOJIS = QUICK_REACTION_EMOJIS.slice(0, 5);
const MAX_VISIBLE_AVATARS_PER_CHIP = 3;
const MAX_VISIBLE_EMOJI_CHIPS = 4;

interface GroupedReaction {
  emoji: string;
  items: MessageReaction[];
  count: number;
  userReacted: boolean;
}

function groupReactions(reactions: MessageReaction[] | undefined): GroupedReaction[] {
  if (!reactions || reactions.length === 0) return [];
  const map = new Map<string, GroupedReaction>();
  for (const r of reactions) {
    if (!r.emoji) continue;
    const existing = map.get(r.emoji);
    const isUser = r.reactorId === 'user' || r.reactorType === 'user';
    if (!existing) {
      map.set(r.emoji, {
        emoji: r.emoji,
        items: [r],
        count: 1,
        userReacted: isUser,
      });
    } else {
      const alreadySameReactor = existing.items.some((x) => x.reactorId === r.reactorId);
      if (!alreadySameReactor) {
        existing.items.push(r);
        existing.count += 1;
      }
      if (isUser) existing.userReacted = true;
    }
  }
  return Array.from(map.values());
}

function formatMessageTime(rawCreatedAt: unknown): string | null {
  if (!rawCreatedAt) return null;
  let date: Date | null = null;
  if (rawCreatedAt instanceof Date) {
    date = rawCreatedAt;
  } else if (typeof rawCreatedAt === 'number') {
    date = new Date(rawCreatedAt);
  } else if (typeof rawCreatedAt === 'string') {
    const parsed = new Date(rawCreatedAt);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  } else if (typeof rawCreatedAt === 'object') {
    const rec = rawCreatedAt as { toDate?: () => Date; seconds?: number };
    if (typeof rec.toDate === 'function') {
      try {
        date = rec.toDate();
      } catch {
        date = null;
      }
    } else if (typeof rec.seconds === 'number') {
      date = new Date(rec.seconds * 1000);
    }
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function useAnchoredPopoverPosition({
  anchorEl,
  popoverRef,
  preferredWidth,
  estimatedHeight,
  alignRight,
  open,
}: {
  anchorEl: HTMLElement | null;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  preferredWidth: number;
  estimatedHeight: number;
  alignRight?: boolean;
  open: boolean;
}) {
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    openUpward: boolean;
  }>({
    top: 80,
    left: 12,
    width: preferredWidth,
    openUpward: false,
  });

  const recompute = useCallback(() => {
    if (typeof window === 'undefined' || !anchorEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(preferredWidth, vw - 24);
    const rect = anchorEl.getBoundingClientRect();
    const measuredHeight = popoverRef.current?.offsetHeight || estimatedHeight;

    const rawLeft = alignRight ? rect.right - width : rect.left;
    const left = Math.max(12, Math.min(rawLeft, vw - width - 12));

    const safeTop = 64;
    const safeBottom = vh - 82;
    const spaceAbove = rect.top - safeTop;
    const spaceBelow = safeBottom - rect.bottom;

    let openUpward = false;
    let rawTop = rect.bottom + 8;

    if (spaceBelow >= measuredHeight) {
      openUpward = false;
      rawTop = rect.bottom + 8;
    } else if (spaceAbove >= measuredHeight) {
      openUpward = true;
      rawTop = rect.top - measuredHeight - 8;
    } else if (spaceAbove > spaceBelow) {
      openUpward = true;
      rawTop = rect.top - measuredHeight - 8;
    } else {
      openUpward = false;
      rawTop = rect.bottom + 8;
    }

    const top = Math.max(12, Math.min(rawTop, vh - measuredHeight - 12));
    setCoords({ top, left, width, openUpward });
  }, [anchorEl, popoverRef, preferredWidth, estimatedHeight, alignRight]);

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
    const raf = window.requestAnimationFrame(recompute);
    const handleUpdate = () => recompute();
    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [open, recompute]);

  return coords;
}

function ReactionPackPicker({
  open,
  anchorEl,
  alignRight,
  userEmojis,
  canReply,
  canCopy,
  canReuse,
  canToggleCollapse,
  isCollapsed,
  onReplyAction,
  onCopyAction,
  onReuseAction,
  onToggleCollapseAction,
  onPick,
  onClose,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  alignRight?: boolean;
  userEmojis: Set<string>;
  canReply?: boolean;
  canCopy?: boolean;
  canReuse?: boolean;
  canToggleCollapse?: boolean;
  isCollapsed?: boolean;
  onReplyAction?: () => void;
  onCopyAction?: () => void;
  onReuseAction?: () => void;
  onToggleCollapseAction?: () => void;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [historyEmojis, setHistoryEmojis] = useState<string[]>(() => getReactionHistory());
  const [activeCategoryId, setActiveCategoryId] = useState<string>(() =>
    getReactionHistory().length > 0 ? 'history' : REACTION_PACK_CATEGORIES[0].id,
  );
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHistoryEmojis(getReactionHistory());
    return subscribeReactionHistory(() => {
      setHistoryEmojis(getReactionHistory());
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const latest = getReactionHistory();
    setHistoryEmojis(latest);
    setActiveCategoryId((prev) =>
      prev === 'history' && latest.length === 0 ? REACTION_PACK_CATEGORIES[0].id : prev,
    );
  }, [open]);

  const hasQuickActions = Boolean(canReply || canCopy || canReuse || canToggleCollapse);
  const pos = useAnchoredPopoverPosition({
    anchorEl,
    popoverRef: pickerRef,
    preferredWidth: 312,
    estimatedHeight: hasQuickActions ? 330 : 288,
    alignRight,
    open,
  });

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  const activeCategory =
    activeCategoryId === 'history'
      ? { id: 'history', label: 'History', emojis: historyEmojis }
      : REACTION_PACK_CATEGORIES.find((cat) => cat.id === activeCategoryId) ||
        REACTION_PACK_CATEGORIES[0];

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="reaction-picker-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="fixed inset-0 z-[90] bg-black/25 backdrop-blur-[1px]"
          aria-hidden="true"
        />
      )}

      {open && (
        <motion.div
          key="reaction-picker-card"
          ref={pickerRef}
          initial={{ opacity: 0, scale: 0.9, y: pos.openUpward ? 10 : -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: pos.openUpward ? 10 : -10 }}
          transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.68 }}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
          }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Reaction pack picker"
          className="z-[100] rounded-2xl bg-[#10162B]/98 backdrop-blur-2xl border border-white/15 shadow-[0_22px_54px_rgba(0,0,0,0.82)] overflow-hidden"
        >
        {/* Top Quick-React Strip (Messenger / WhatsApp instant bar) */}
        <div className="flex items-center justify-between gap-1 px-2.5 py-2 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-0.5 overflow-x-auto">
            {QUICK_REACTION_EMOJIS.map((emoji) => {
              const active = userEmojis.has(emoji);
              return (
                <motion.button
                  key={`quick-${emoji}`}
                  type="button"
                  whileTap={{ scale: 0.84 }}
                  onClick={() => onPick(emoji)}
                  aria-label={`Quick react with ${emoji}`}
                  aria-pressed={active}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[15px] transition-colors cursor-pointer shrink-0 ${
                    active
                      ? 'bg-[#4F5BEF]/35 ring-1 ring-[#7AA7FF]/75'
                      : 'hover:bg-white/12'
                  }`}
                >
                  {emoji}
                </motion.button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reaction picker"
            className="w-6 h-6 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Categorized Reaction Pack Tabs (History + Discord / Telegram categories) */}
        <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-white/[0.06] overflow-x-auto">
          <button
            key="history"
            type="button"
            onClick={() => setActiveCategoryId('history')}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeCategoryId === 'history'
                ? 'bg-[#4F5BEF]/25 text-white border border-[#7AA7FF]/45'
                : 'text-[#9AA7BF] hover:text-white hover:bg-white/[0.06] border border-transparent'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>History</span>
            {historyEmojis.length > 0 && (
              <span className="font-mono text-[10px] opacity-75 tabular-nums">
                {historyEmojis.length}
              </span>
            )}
          </button>
          {REACTION_PACK_CATEGORIES.map((cat) => {
            const isSelected = cat.id === activeCategory.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategoryId(cat.id)}
                className={`px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#4F5BEF]/25 text-white border border-[#7AA7FF]/45'
                    : 'text-[#9AA7BF] hover:text-white hover:bg-white/[0.06] border border-transparent'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Category / History Emoji Grid */}
        {activeCategoryId === 'history' ? (
          <div className="p-2.5 space-y-2">
            {historyEmojis.length > 0 ? (
              <>
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[10.5px] font-medium text-[#9AA7BF]">
                    Recently used
                  </span>
                  <button
                    type="button"
                    onClick={() => clearReactionHistory()}
                    className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[#9AA7BF] hover:text-rose-300 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-1.5 max-h-[168px] overflow-y-auto">
                  {historyEmojis.map((emoji) => {
                    const active = userEmojis.has(emoji);
                    return (
                      <motion.button
                        key={`history-${emoji}`}
                        type="button"
                        whileTap={{ scale: 0.84 }}
                        onClick={() => onPick(emoji)}
                        aria-label={`React with ${emoji}`}
                        aria-pressed={active}
                        className={`h-9 rounded-xl flex items-center justify-center text-[18px] border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#4F5BEF]/30 border-[#7AA7FF]/70 shadow-[0_0_12px_rgba(122,167,255,0.22)]'
                            : 'bg-white/[0.03] hover:bg-white/[0.1] border-white/[0.06]'
                        }`}
                      >
                        {emoji}
                      </motion.button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="py-5 px-3 text-center space-y-1">
                <Clock className="w-4 h-4 mx-auto text-[#8E9BB3]" />
                <p className="text-[11.5px] text-[#9AA7BF]">
                  Your recently used reactions will appear here.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-2.5 grid grid-cols-5 gap-1.5">
            {activeCategory.emojis.map((emoji) => {
              const active = userEmojis.has(emoji);
              return (
                <motion.button
                  key={`${activeCategory.id}-${emoji}`}
                  type="button"
                  whileTap={{ scale: 0.84 }}
                  onClick={() => onPick(emoji)}
                  aria-label={`React with ${emoji}`}
                  aria-pressed={active}
                  className={`h-9 rounded-xl flex items-center justify-center text-[18px] border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#4F5BEF]/30 border-[#7AA7FF]/70 shadow-[0_0_12px_rgba(122,167,255,0.22)]'
                      : 'bg-white/[0.03] hover:bg-white/[0.1] border-white/[0.06]'
                  }`}
                >
                  {emoji}
                </motion.button>
              );
            })}
          </div>
        )}

        {hasQuickActions && (
          <div className="flex items-center gap-1 px-2.5 py-2 border-t border-white/[0.08] bg-white/[0.025]">
            {canReply && onReplyAction && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onReplyAction();
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-[#E6EBF5] transition-colors cursor-pointer"
              >
                <Reply className="w-3.5 h-3.5 text-[#7AA7FF]" />
                <span>Reply</span>
              </button>
            )}
            {canCopy && onCopyAction && (
              <button
                type="button"
                onClick={() => {
                  onCopyAction();
                  onClose();
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-[#E6EBF5] transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5 text-[#9AA7BF]" />
                <span>Copy</span>
              </button>
            )}
            {canReuse && onReuseAction && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onReuseAction();
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-[#E6EBF5] transition-colors cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5 text-[#9AA7BF]" />
                <span>Reuse</span>
              </button>
            )}
            {canToggleCollapse && onToggleCollapseAction && (
              <button
                type="button"
                onClick={() => {
                  onToggleCollapseAction();
                  onClose();
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-[#E6EBF5] transition-colors cursor-pointer"
              >
                {isCollapsed ? (
                  <>
                    <Maximize2 className="w-3.5 h-3.5 text-[#9AA7BF]" />
                    <span>Expand</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-3.5 h-3.5 text-[#9AA7BF]" />
                    <span>Collapse</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function ReactionInspectorPopover({
  anchorEl,
  alignRight,
  inspectorTab,
  totalReactionsCount,
  grouped,
  activeRows,
  activeTabGroup,
  canToggle,
  duplicateModelSet,
  onSelectTab,
  onToggleUserReaction,
  onClose,
}: {
  anchorEl: HTMLElement | null;
  alignRight?: boolean;
  inspectorTab: string | null;
  totalReactionsCount: number;
  grouped: GroupedReaction[];
  activeRows: MessageReaction[];
  activeTabGroup: GroupedReaction | null;
  canToggle: boolean;
  duplicateModelSet?: Set<string>;
  onSelectTab: (tab: string) => void;
  onToggleUserReaction?: (emoji: string) => void;
  onClose: () => void;
}) {
  const open = inspectorTab !== null;
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const pos = useAnchoredPopoverPosition({
    anchorEl,
    popoverRef,
    preferredWidth: 300,
    estimatedHeight: 264,
    alignRight,
    open,
  });

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="inspector-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="fixed inset-0 z-[90] bg-black/20"
          aria-hidden="true"
        />
      )}
      {open && (
        <motion.div
          key="inspector-card"
          ref={popoverRef}
          initial={{ opacity: 0, y: pos.openUpward ? 6 : -6, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: pos.openUpward ? 6 : -6, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.68 }}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
          }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Message reactions details"
          className="z-[100] rounded-2xl bg-[#10162B]/98 backdrop-blur-2xl border border-white/15 shadow-[0_22px_54px_rgba(0,0,0,0.82)] overflow-hidden"
        >
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08]">
          <span className="font-display text-xs font-semibold text-[#F4F7FD] tabular-nums">
            Reactions ({totalReactionsCount})
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reactions list"
            className="w-5 h-5 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Filter tabs: All + Each Emoji */}
        <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-white/[0.06] overflow-x-auto">
          <button
            type="button"
            onClick={() => onSelectTab('ALL')}
            className={`px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer tabular-nums ${
              inspectorTab === 'ALL'
                ? 'bg-white/15 text-white'
                : 'text-[#9AA7BF] hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            All {totalReactionsCount}
          </button>
          {grouped.map((g) => (
            <button
              key={g.emoji}
              type="button"
              onClick={() => onSelectTab(g.emoji)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer tabular-nums ${
                inspectorTab === g.emoji
                  ? 'bg-white/15 text-white'
                  : 'text-[#9AA7BF] hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <span>{g.emoji}</span>
              <span>{g.count}</span>
            </button>
          ))}
        </div>

        {/* Reactor rows */}
        <div className="max-h-48 overflow-y-auto divide-y divide-white/[0.05]">
          {activeRows.map((r, i) => {
            const meta = parseReactorIdentity(r);
            const isSelf = r.reactorId === 'user' || r.reactorType === 'user';
            return (
              <div
                key={`${r.reactorId}-${r.emoji}-${i}`}
                className="flex items-center justify-between gap-2.5 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ProviderAvatar
                    provider={meta.provider}
                    modelId={meta.modelId || undefined}
                    useModelLogo={Boolean(
                      meta.modelId && duplicateModelSet?.has(`${meta.provider}:${meta.modelId}`),
                    )}
                    role={meta.role}
                    size="xs"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[#F4F7FD] truncate">
                      {meta.displayName}
                    </div>
                    {meta.modelId && (
                      <div className="text-[10px] font-mono text-[#8E9BB3] truncate">
                        {meta.modelId}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isSelf && canToggle && (
                    <button
                      type="button"
                      onClick={() => onToggleUserReaction?.(r.emoji)}
                      className="text-[10.5px] font-medium text-[#9AA7BF] hover:text-rose-300 transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                  <span className="text-sm leading-none">{r.emoji}</span>
                </div>
              </div>
            );
          })}
        </div>

        {canToggle && activeTabGroup && (
          <div className="px-2.5 py-2 border-t border-white/[0.08] bg-white/[0.02]">
            <button
              type="button"
              onClick={() => onToggleUserReaction?.(activeTabGroup.emoji)}
              className="w-full py-1.5 px-3 rounded-xl text-[11px] font-medium bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[#E6EBF5] transition-colors cursor-pointer text-center"
            >
              {activeTabGroup.userReacted
                ? `Remove my ${activeTabGroup.emoji}`
                : `React with ${activeTabGroup.emoji}`}
            </button>
          </div>
        )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function ReactionChipsBar({
  rawReactions,
  grouped,
  alignRight,
  canToggle,
  duplicateModelSet,
  onToggleUserReaction,
  onOpenPack,
}: {
  rawReactions: MessageReaction[] | undefined;
  grouped: GroupedReaction[];
  alignRight?: boolean;
  canToggle: boolean;
  duplicateModelSet?: Set<string>;
  onToggleUserReaction?: (emoji: string) => void;
  onOpenPack?: (triggerEl?: HTMLElement | null) => void;
}) {
  const [inspectorTab, setInspectorTab] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const openInspector = (tab: string) => {
    setInspectorTab((prev) => (prev === tab ? null : tab));
  };

  if (grouped.length === 0) return null;

  const hasGroupOverflow = grouped.length > MAX_VISIBLE_EMOJI_CHIPS;
  const visibleGroups = hasGroupOverflow
    ? grouped.slice(0, MAX_VISIBLE_EMOJI_CHIPS - 1)
    : grouped;
  const overflowGroups = hasGroupOverflow ? grouped.slice(MAX_VISIBLE_EMOJI_CHIPS - 1) : [];
  const overflowReactorCount = overflowGroups.reduce((sum, g) => sum + g.count, 0);
  const totalReactionsCount = grouped.reduce((sum, g) => sum + g.count, 0);

  const allItems = rawReactions || grouped.flatMap((g) => g.items);
  const activeRows =
    inspectorTab === 'ALL' || !inspectorTab
      ? allItems
      : grouped.find((g) => g.emoji === inspectorTab)?.items || [];

  const activeTabGroup =
    inspectorTab && inspectorTab !== 'ALL'
      ? grouped.find((g) => g.emoji === inspectorTab) || null
      : null;

  return (
    <div
      ref={rootRef}
      className={`relative mt-1.5 flex flex-wrap items-center gap-1 ${
        alignRight ? 'justify-end' : 'justify-start'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <AnimatePresence initial={false}>
        {visibleGroups.map((g) => {
          const visibleReactors = g.items.slice(0, MAX_VISIBLE_AVATARS_PER_CHIP);
          const extraReactors = Math.max(0, g.count - MAX_VISIBLE_AVATARS_PER_CHIP);
          const isOpen = inspectorTab === g.emoji;
          const namesSummary = g.items
            .map((r) => {
              const meta = parseReactorIdentity(r);
              return meta.modelId ? `${meta.displayName} (${meta.modelId})` : meta.displayName;
            })
            .join(', ');

          return (
            <motion.button
              key={g.emoji}
              type="button"
              initial={{ opacity: 0, scale: 0.72 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.72 }}
              transition={{ type: 'spring', stiffness: 520, damping: 28, mass: 0.6 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => openInspector(g.emoji)}
              title={`${g.emoji} — ${namesSummary} (Click to inspect or toggle)`}
              aria-label={`${g.emoji} reaction (${g.count}) from ${namesSummary}`}
              aria-expanded={isOpen}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] leading-none border transition-colors cursor-pointer ${
                isOpen || g.userReacted
                  ? 'bg-[#4F5BEF]/28 border-[#7AA7FF]/65 text-[#F4F7FD] shadow-[0_2px_10px_rgba(79,91,239,0.22)]'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/12 text-[#CBD5E1]'
              }`}
            >
              <span className="text-[13px] leading-none">{g.emoji}</span>

              {/* Smart reactor micro SVG logos beside emoji (first 1-3 reactors) */}
              <span className="inline-flex items-center -space-x-1">
                {visibleReactors.map((r) => {
                  const meta = parseReactorIdentity(r);
                  return (
                    <span
                      key={r.reactorId}
                      className="rounded-full ring-[1.5px] ring-[#0D1326] inline-flex"
                    >
                      <ProviderAvatar
                        provider={meta.provider}
                        modelId={meta.modelId || undefined}
                        useModelLogo={Boolean(
                          meta.modelId && duplicateModelSet?.has(`${meta.provider}:${meta.modelId}`),
                        )}
                        role={meta.role}
                        size="micro"
                      />
                    </span>
                  );
                })}
              </span>

              {extraReactors > 0 && (
                <span className="text-[10px] font-medium text-[#9AA7BF] tabular-nums">
                  +{extraReactors} more
                </span>
              )}

              {g.count > 1 && (
                <span className="font-mono text-[10.5px] font-semibold tabular-nums text-[#E6EBF5]">
                  {g.count}
                </span>
              )}
            </motion.button>
          );
        })}

        {hasGroupOverflow && (
          <motion.button
            key="__overflow__"
            type="button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            whileTap={{ scale: 0.93 }}
            onClick={() => openInspector('ALL')}
            aria-label={`View ${overflowGroups.length} more reaction types`}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium border transition-colors cursor-pointer tabular-nums ${
              inspectorTab === 'ALL'
                ? 'bg-[#4F5BEF]/28 border-[#7AA7FF]/65 text-white'
                : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/12 text-[#CBD5E1]'
            }`}
          >
            <span>+{overflowGroups.length} more</span>
            <span className="font-mono text-[10px] text-[#9AA7BF]">
              ({overflowReactorCount})
            </span>
          </motion.button>
        )}

        {canToggle && onOpenPack && (
          <button
            key="__add_reaction__"
            type="button"
            data-reaction-picker-trigger="true"
            onClick={(e) => onOpenPack(e.currentTarget)}
            aria-label="Add another reaction"
            title="Add reaction"
            className="inline-flex items-center justify-center w-6 h-[22px] rounded-full bg-white/[0.04] hover:bg-white/[0.12] border border-white/10 text-[#9AA7BF] hover:text-white transition-colors cursor-pointer"
          >
            <SmilePlus className="w-3 h-3" />
          </button>
        )}
      </AnimatePresence>

      {/* Discord / Messenger / WhatsApp style "Who Reacted" Popover (Portaled above all bubbles) */}
      <ReactionInspectorPopover
        anchorEl={rootRef.current}
        alignRight={alignRight}
        inspectorTab={inspectorTab}
        totalReactionsCount={totalReactionsCount}
        grouped={grouped}
        activeRows={activeRows}
        activeTabGroup={activeTabGroup}
        canToggle={canToggle}
        duplicateModelSet={duplicateModelSet}
        onSelectTab={setInspectorTab}
        onToggleUserReaction={(emoji) => {
          if (activeTabGroup && !activeTabGroup.userReacted) {
            recordReactionHistory(emoji);
          }
          onToggleUserReaction?.(emoji);
        }}
        onClose={() => setInspectorTab(null)}
      />
    </div>
  );
}

const SWIPE_RING_CIRCUMFERENCE = 2 * Math.PI * 15;

function SwipeReplyIndicator({
  dragX,
  thresholdReached,
  reducedMotion,
  slideOffset = true,
  className = '',
}: {
  dragX: MotionValue<number>;
  thresholdReached: boolean;
  reducedMotion: boolean;
  slideOffset?: boolean;
  className?: string;
}) {
  const opacity = useTransform(dragX, [0, 10, 44], [0, 0.45, 1]);
  const scale = useTransform(
    dragX,
    [0, 18, SWIPE_REPLY_THRESHOLD, SWIPE_REPLY_THRESHOLD + 20],
    [0.5, 0.78, 1.04, 1.1],
  );
  const x = useTransform(dragX, [0, SWIPE_REPLY_THRESHOLD], slideOffset ? [-10, 4] : [0, 0]);
  const dashOffset = useTransform(
    dragX,
    [8, SWIPE_REPLY_THRESHOLD],
    [SWIPE_RING_CIRCUMFERENCE, 0],
  );

  return (
    <motion.div
      aria-hidden="true"
      style={{ opacity, scale, x }}
      className={`pointer-events-none select-none flex items-center justify-center w-9 h-9 ${className}`}
    >
      <div
        className={`relative w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-md transition-colors duration-150 ${
          thresholdReached
            ? 'bg-[#4F5BEF] text-white shadow-[0_0_20px_rgba(79,91,239,0.55)]'
            : 'bg-white/[0.08] text-[#CBD5E1] shadow-[0_4px_14px_rgba(0,0,0,0.35)]'
        }`}
      >
        <svg
          className="absolute inset-0 w-9 h-9 -rotate-90"
          viewBox="0 0 36 36"
          fill="none"
        >
          <circle
            cx="18"
            cy="18"
            r="15"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="2"
          />
          <motion.circle
            cx="18"
            cy="18"
            r="15"
            stroke={thresholdReached ? '#FFFFFF' : '#7AA7FF'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={SWIPE_RING_CIRCUMFERENCE}
            style={{ strokeDashoffset: dashOffset }}
          />
        </svg>
        <motion.span
          animate={
            thresholdReached && !reducedMotion
              ? { scale: [1, 1.26, 1], rotate: [0, -10, 0] }
              : { scale: 1, rotate: 0 }
          }
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex items-center justify-center"
        >
          <Reply className="w-4 h-4" />
        </motion.span>
      </div>
    </motion.div>
  );
}

function QuotedReplyCard({
  replyTo,
  alignRight,
  duplicateModelSet,
  onJumpToMessage,
}: {
  replyTo: ReplyToRef;
  alignRight?: boolean;
  duplicateModelSet?: Set<string>;
  onJumpToMessage?: (messageId: string) => void;
}) {
  const visual = getProviderVisual(replyTo.provider);
  const senderLabel =
    replyTo.role === 'user' || replyTo.provider === 'user'
      ? 'You'
      : replyTo.role === 'moderator'
        ? `${visual.shortName} Moderator`
        : visual.shortName;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJumpToMessage?.(replyTo.messageId);
      }}
      title="Jump to quoted message"
      className={`group/quote w-full text-left mb-1.5 rounded-xl px-2.5 py-1.5 border transition-colors cursor-pointer ${
        alignRight
          ? 'bg-black/22 hover:bg-black/32 border-white/20 text-white/90'
          : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/12 text-[#CBD5E1]'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
        <Reply className="w-3 h-3 shrink-0 opacity-70" />
        <ProviderAvatar
          provider={replyTo.provider}
          modelId={replyTo.modelId || undefined}
          useModelLogo={Boolean(
            replyTo.modelId && duplicateModelSet?.has(`${replyTo.provider}:${replyTo.modelId}`),
          )}
          role={replyTo.role}
          size="micro"
        />
        <span
          className="font-display text-[10.5px] font-semibold truncate"
          style={
            alignRight
              ? undefined
              : { color: replyTo.role === 'moderator' ? '#F6C453' : visual.accentHex }
          }
        >
          {senderLabel}
        </span>
        {replyTo.role !== 'user' && replyTo.modelId && (
          <span className="font-mono text-[9.5px] opacity-65 truncate max-w-[140px]">
            {replyTo.modelId}
          </span>
        )}
      </div>
      <p className="text-[11.5px] leading-[1.35] opacity-85 line-clamp-2 break-words">
        {replyTo.snippet || '(empty message)'}
      </p>
    </button>
  );
}

export const MessageBubble = memo(function MessageBubble({
  item,
  copiedId,
  isCopied,
  duplicateModelSet,
  onCopy,
  onToggleReaction,
  onReply,
  onReusePrompt,
  onRetryTurn,
  onJumpToMessage,
  highlighted,
  containerRef,
  onRegisterEl,
}: {
  item: CouncilMessageDoc | StreamingBufferItem;
  index?: number;
  isChatMode?: boolean;
  copiedId?: string | null;
  isCopied?: boolean;
  duplicateModelSet?: Set<string>;
  onCopy: (id: string, text: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onReply?: (item: CouncilMessageDoc | StreamingBufferItem) => void;
  onReusePrompt?: (text: string) => void;
  onRetryTurn?: () => void;
  onJumpToMessage?: (messageId: string) => void;
  highlighted?: boolean;
  containerRef?: (el: HTMLElement | null) => void;
  onRegisterEl?: (id: string, el: HTMLElement | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchorEl, setPickerAnchorEl] = useState<HTMLElement | null>(null);
  const [doubleTapBurst, setDoubleTapBurst] = useState<{ emoji: string; seq: number } | null>(
    null,
  );

  const pickerAnchorRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const burstTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (burstTimerRef.current !== null) {
        window.clearTimeout(burstTimerRef.current);
      }
    };
  }, []);

  const id = 'id' in item ? item.id : item.messageId;
  const copied = typeof isCopied === 'boolean' ? isCopied : copiedId === id;
  const setContainerNode = useCallback(
    (el: HTMLElement | null) => {
      onRegisterEl?.(id, el);
      containerRef?.(el);
    },
    [id, onRegisterEl, containerRef],
  );
  const useAlternateModelLogo = Boolean(
    item.role !== 'user' && duplicateModelSet?.has(`${item.provider}:${item.modelId}`),
  );
  const baseVisual = getProviderVisual(item.provider);
  const modelVisual = useAlternateModelLogo
    ? getModelVisualIdentity(item.provider, item.modelId, true)
    : null;
  const visual = modelVisual ? { ...baseVisual, accentHex: modelVisual.accentHex } : baseVisual;
  const isUser = item.role === 'user';
  const isModerator = item.role === 'moderator';
  const isStreaming = item.status === 'streaming';
  const isError = item.status === 'error';
  const replyTo = 'replyTo' in item ? item.replyTo : undefined;
  const createdAt = 'createdAt' in item ? item.createdAt : undefined;
  const timestampLabel = useMemo(() => formatMessageTime(createdAt), [createdAt]);
  const inputTokens =
    'inputTokens' in item && typeof item.inputTokens === 'number' ? item.inputTokens : 0;
  const outputTokens =
    'outputTokens' in item && typeof item.outputTokens === 'number' ? item.outputTokens : 0;
  const latencyMs = 'latencyMs' in item && typeof item.latencyMs === 'number' ? item.latencyMs : 0;
  const estCost =
    'estimatedCostUsd' in item && typeof item.estimatedCostUsd === 'number'
      ? item.estimatedCostUsd
      : 0;
  const errorMessage = 'errorMessage' in item ? item.errorMessage : undefined;

  const grouped = useMemo(() => groupReactions(item.reactions), [item.reactions]);
  const userEmojis = useMemo(() => {
    const set = new Set<string>();
    for (const g of grouped) {
      if (g.userReacted) set.add(g.emoji);
    }
    return set;
  }, [grouped]);

  const isLongAnswer = !isStreaming && !isError && item.content.length > COLLAPSE_CHAR_THRESHOLD;
  const canReact = !isStreaming && !isError && Boolean(onToggleReaction);
  const canReply = !isStreaming && !isError && Boolean(onReply) && item.content.trim().length > 0;
  const prefersReduced = Boolean(useReducedMotion());

  const openReactionPackAtElement = useCallback((el?: HTMLElement | null) => {
    setPickerAnchorEl(el || bubbleRef.current || pickerAnchorRef.current);
    setPickerOpen(true);
  }, []);

  const toggleReactionPack = useCallback((el?: HTMLElement | null) => {
    setPickerOpen((prev) => {
      if (prev) return false;
      setPickerAnchorEl(el || bubbleRef.current || pickerAnchorRef.current);
      return true;
    });
  }, []);

  const triggerDoubleTapReaction = useCallback(() => {
    if (!canReact) return;
    const recent = getReactionHistory()[0];
    const quickEmoji = recent || '❤️';
    if (!userEmojis.has(quickEmoji)) {
      recordReactionHistory(quickEmoji);
    }
    onToggleReaction?.(id, quickEmoji);
    setDoubleTapBurst((prev) => ({ emoji: quickEmoji, seq: (prev?.seq || 0) + 1 }));
    if (burstTimerRef.current !== null) {
      window.clearTimeout(burstTimerRef.current);
    }
    burstTimerRef.current = window.setTimeout(() => {
      setDoubleTapBurst(null);
      burstTimerRef.current = null;
    }, 680);
  }, [canReact, id, onToggleReaction, userEmojis]);

  const swipe = useSwipeToReply({
    swipeEnabled: canReply && !pickerOpen,
    longPressEnabled: canReact && !pickerOpen,
    doubleTapEnabled: canReact && !pickerOpen,
    reducedMotion: prefersReduced,
    onSwipeReply: () => {
      setActionsVisible(false);
      onReply?.(item);
    },
    onLongPress: () => {
      setActionsVisible(false);
      openReactionPackAtElement(bubbleRef.current || pickerAnchorRef.current);
    },
    onDoubleTap: () => {
      triggerDoubleTapReaction();
    },
  });

  const handlePickReaction = (emoji: string) => {
    setPickerOpen(false);
    setActionsVisible(false);
    if (canReact) {
      if (!userEmojis.has(emoji)) {
        recordReactionHistory(emoji);
      }
      onToggleReaction?.(id, emoji);
    }
  };

  const handleQuickEmoji = (emoji: string) => {
    if (!canReact) return;
    if (!userEmojis.has(emoji)) {
      recordReactionHistory(emoji);
    }
    onToggleReaction?.(id, emoji);
  };

  if (isUser) {
    return (
      <motion.div
        ref={setContainerNode}
        data-message-id={id}
        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 480, damping: 32, mass: 0.65 }}
        onPointerDown={swipe.onPointerDown}
        onClickCapture={swipe.onClickCapture}
        onContextMenu={swipe.onContextMenu}
        style={
          canReact
            ? { WebkitTouchCallout: 'none', transformOrigin: 'bottom right' }
            : { transformOrigin: 'bottom right' }
        }
        className={`group relative flex flex-col items-end rounded-2xl transition-shadow duration-300 ${
          canReply ? 'touch-pan-y' : ''
        } ${swipe.isSwiping || swipe.isHolding ? 'select-none' : ''} ${
          highlighted
            ? 'ring-2 ring-[#7AA7FF]/80 bg-[#4F5BEF]/14 shadow-[0_0_24px_rgba(122,167,255,0.22)]'
            : ''
        }`}
        onClick={() => setActionsVisible((prev) => !prev)}
      >
        <motion.div
          style={canReply ? { x: swipe.dragX } : undefined}
          className="relative flex flex-col items-end w-full will-change-transform"
        >
          {/* User Bubble + Discord/Messenger Floating Hover Quick-React & Reply Pill */}
          <div
            ref={pickerAnchorRef}
            className="relative flex items-center justify-end gap-1.5 max-w-[90%] sm:max-w-[74%]"
          >
            {canReply && (
              <SwipeReplyIndicator
                dragX={swipe.dragX}
                thresholdReached={swipe.thresholdReached}
                reducedMotion={prefersReduced}
                slideOffset={false}
                className="absolute right-full mr-2.5 top-1/2 -translate-y-1/2 z-10"
              />
            )}

            {(canReact || canReply || Boolean(item.content)) && (
              <div
                onClick={(e) => e.stopPropagation()}
                className={`hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#12182D] border border-white/15 shadow-[0_6px_18px_rgba(0,0,0,0.45)] transition-opacity duration-150 shrink-0 ${
                  swipe.isSwiping
                    ? 'opacity-0 pointer-events-none'
                    : actionsVisible || pickerOpen
                      ? 'opacity-100 pointer-events-auto'
                      : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
                }`}
              >
                {canReact &&
                  HOVER_QUICK_EMOJIS.slice(0, 4).map((emoji) => {
                    const active = userEmojis.has(emoji);
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleQuickEmoji(emoji)}
                        aria-label={`React with ${emoji}`}
                        aria-pressed={active}
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[13px] transition-transform active:scale-90 cursor-pointer ${
                          active ? 'bg-[#4F5BEF]/35 ring-1 ring-[#7AA7FF]/70' : 'hover:bg-white/12'
                        }`}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                {canReact && (
                  <button
                    type="button"
                    data-reaction-picker-trigger="true"
                    onClick={(e) => toggleReactionPack(e.currentTarget)}
                    aria-label="Open full reaction pack"
                    title="More reactions"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/12 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                {canReply && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionsVisible(false);
                      onReply?.(item);
                    }}
                    aria-label="Reply to message"
                    title="Reply"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/12 transition-colors cursor-pointer"
                  >
                    <Reply className="w-3.5 h-3.5" />
                  </button>
                )}
                {item.content && (
                  <button
                    type="button"
                    onClick={() => onCopy(id, item.content)}
                    aria-label="Copy message"
                    title="Copy"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/12 transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                )}
                {onReusePrompt && item.content && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionsVisible(false);
                      onReusePrompt(item.content);
                    }}
                    aria-label="Reuse prompt in chat box"
                    title="Reuse in composer"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/12 transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            <motion.div
              ref={bubbleRef}
              animate={
                swipe.isHolding && !prefersReduced
                  ? { scale: 0.974 }
                  : { scale: 1 }
              }
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              className={`relative px-3 py-1.5 rounded-[16px_16px_4px_16px] text-white text-[13px] sm:text-[13.5px] leading-[1.42] font-normal whitespace-pre-wrap break-words shadow-[0_6px_18px_rgba(79,91,239,0.28)] transition-shadow duration-150 ${
                swipe.isHolding ? 'ring-2 ring-white/45 shadow-[0_10px_28px_rgba(79,91,239,0.48)]' : ''
              }`}
              style={{
                background: 'linear-gradient(135deg, #4F5BEF, #7C4DE8)',
              }}
            >
              <AnimatePresence>
                {doubleTapBurst && !prefersReduced && (
                  <motion.span
                    key={`burst-${doubleTapBurst.seq}`}
                    initial={{ opacity: 0, scale: 0.4, y: 6 }}
                    animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.45, 1.15, 0.9], y: -28 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.62, ease: [0.16, 1, 0.3, 1] }}
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-3 right-3 z-30 text-2xl select-none drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
                  >
                    {doubleTapBurst.emoji}
                  </motion.span>
                )}
              </AnimatePresence>

              {replyTo && (
                <QuotedReplyCard
                  replyTo={replyTo}
                  alignRight
                  duplicateModelSet={duplicateModelSet}
                  onJumpToMessage={onJumpToMessage}
                />
              )}
              <div>{item.content}</div>
            </motion.div>

            <ReactionPackPicker
              open={pickerOpen && canReact}
              anchorEl={pickerAnchorEl}
              alignRight
              userEmojis={userEmojis}
              canReply={canReply}
              canCopy={Boolean(item.content)}
              canReuse={Boolean(onReusePrompt && item.content)}
              onReplyAction={() => onReply?.(item)}
              onCopyAction={() => onCopy(id, item.content)}
              onReuseAction={() => onReusePrompt?.(item.content)}
              onPick={handlePickReaction}
              onClose={() => setPickerOpen(false)}
            />
          </div>

          <ReactionChipsBar
            rawReactions={item.reactions}
            grouped={grouped}
            alignRight
            canToggle={canReact}
            duplicateModelSet={duplicateModelSet}
            onToggleUserReaction={(emoji) => onToggleReaction?.(id, emoji)}
            onOpenPack={openReactionPackAtElement}
          />

          {/* Compact mobile tap-to-reveal action strip for discoverability alongside gestures */}
          {actionsVisible && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="sm:hidden mt-1.5 flex items-center justify-end gap-1.5"
            >
              {canReply && (
                <button
                  type="button"
                  onClick={() => {
                    setActionsVisible(false);
                    onReply?.(item);
                  }}
                  className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-[#E6EBF5] cursor-pointer"
                >
                  <Reply className="w-3 h-3 text-[#7AA7FF]" />
                  <span>Reply</span>
                </button>
              )}
              {canReact && (
                <button
                  type="button"
                  data-reaction-picker-trigger="true"
                  onClick={(e) => toggleReactionPack(e.currentTarget)}
                  className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-[#E6EBF5] cursor-pointer"
                >
                  <SmilePlus className="w-3 h-3 text-[#9AA7BF]" />
                  <span>React</span>
                </button>
              )}
              {item.content && (
                <button
                  type="button"
                  onClick={() => onCopy(id, item.content)}
                  className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-[#E6EBF5] cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-300">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-[#9AA7BF]" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              )}
              {onReusePrompt && item.content && (
                <button
                  type="button"
                  onClick={() => {
                    setActionsVisible(false);
                    onReusePrompt(item.content);
                  }}
                  className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-[#E6EBF5] cursor-pointer"
                >
                  <Pencil className="w-3 h-3 text-[#9AA7BF]" />
                  <span>Reuse</span>
                </button>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div
      ref={setContainerNode}
      data-message-id={id}
      onPointerDown={swipe.onPointerDown}
      onClickCapture={swipe.onClickCapture}
      onContextMenu={swipe.onContextMenu}
      onClick={() => {
        if (!isStreaming) setActionsVisible((prev) => !prev);
      }}
      style={canReact ? { WebkitTouchCallout: 'none' } : undefined}
      className={`group relative rounded-2xl transition-shadow duration-300 ${
        canReply ? 'touch-pan-y' : ''
      } ${swipe.isSwiping || swipe.isHolding ? 'select-none' : ''} ${
        highlighted
          ? 'ring-2 ring-[#7AA7FF]/80 bg-[#4F5BEF]/14 shadow-[0_0_24px_rgba(122,167,255,0.22)]'
          : ''
      }`}
    >
      {canReply && (
        <SwipeReplyIndicator
          dragX={swipe.dragX}
          thresholdReached={swipe.thresholdReached}
          reducedMotion={prefersReduced}
          className="absolute left-0.5 top-1/2 -translate-y-1/2 z-10"
        />
      )}

      <motion.article
        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 460, damping: 32, mass: 0.7 }}
        style={
          canReply
            ? { x: swipe.dragX, transformOrigin: 'bottom left' }
            : { transformOrigin: 'bottom left' }
        }
        className="relative flex items-start gap-2 sm:gap-2.5 max-w-[95%] sm:max-w-[85%] will-change-transform"
      >
        <div className="pt-0.5 shrink-0">
          <ProviderAvatar
            provider={item.provider}
            modelId={item.modelId}
            useModelLogo={useAlternateModelLogo}
            role={item.role}
            size="xs"
            glow={isStreaming || isModerator}
          />
        </div>

      <div ref={pickerAnchorRef} className="relative min-w-0 flex-1">
        {/* Compact 1-line sender name */}
        <div className="relative flex flex-wrap items-center justify-between gap-2 mb-0.5 pl-0.5">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
            <span
              className="font-display font-semibold text-[11.5px] tracking-tight"
              style={{ color: isModerator ? '#F6C453' : visual.accentHex }}
            >
              {visual.shortName}
            </span>
            <span className="font-mono text-[10.5px] text-[#8E9BB3] truncate max-w-[210px]">
              {item.modelId}
            </span>
            {isModerator && (
              <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[9.5px] font-semibold bg-amber-400/15 border border-amber-300/30 text-amber-200">
                <Scale className="w-2.5 h-2.5 text-amber-300" />
                Moderator
              </span>
            )}
            {item.status === 'stopped' && (
              <span className="text-[10.5px] font-medium text-amber-300">Stopped</span>
            )}
          </div>
        </div>

        {/* Message Bubble */}
        {isError ? (
          <div
            className="rounded-[4px_14px_14px_14px] bg-rose-950/60 border border-rose-500/35 px-3 py-2 space-y-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-200 break-words whitespace-pre-wrap leading-relaxed">
                  {errorMessage || 'Provider request failed.'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onRetryTurn && (
                  <button
                    type="button"
                    onClick={onRetryTurn}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10.5px] font-medium bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-rose-100 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setErrorDetailsOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10.5px] font-medium bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/25 text-rose-200 transition-colors cursor-pointer"
                >
                  <span>Details</span>
                  {errorDetailsOpen ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>

            {errorDetailsOpen && (
              <div className="pt-1.5 border-t border-rose-500/20 text-[10.5px] text-rose-200/80 grid grid-cols-1 sm:grid-cols-2 gap-1 font-mono">
                <span>Provider: {item.provider}</span>
                <span>Model: {item.modelId}</span>
                {item.stageLabel && <span>Stage: {item.stageLabel}</span>}
                <span>Round: {item.round}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="relative">
            {/* Floating Desktop Quick-React Toolbar (anchored cleanly at top-right edge, zero sender overlap) */}
            {!isStreaming && (
              <div
                onClick={(e) => e.stopPropagation()}
                className={`hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#12182D] border border-white/15 shadow-[0_8px_22px_rgba(0,0,0,0.55)] transition-opacity duration-150 absolute -top-3.5 right-2 z-20 ${
                  swipe.isSwiping
                    ? 'opacity-0 pointer-events-none'
                    : actionsVisible || pickerOpen
                      ? 'opacity-100 pointer-events-auto'
                      : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
                }`}
              >
                {canReact &&
                  HOVER_QUICK_EMOJIS.map((emoji) => {
                    const active = userEmojis.has(emoji);
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleQuickEmoji(emoji)}
                        aria-label={`React with ${emoji}`}
                        aria-pressed={active}
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[13px] transition-transform active:scale-90 cursor-pointer ${
                          active ? 'bg-[#4F5BEF]/35 ring-1 ring-[#7AA7FF]/70' : 'hover:bg-white/12'
                        }`}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                {canReact && (
                  <button
                    type="button"
                    data-reaction-picker-trigger="true"
                    onClick={(e) => toggleReactionPack(e.currentTarget)}
                    aria-label="More reactions"
                    title="Reaction Pack"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/12 transition-colors cursor-pointer"
                  >
                    <SmilePlus className="w-3.5 h-3.5" />
                  </button>
                )}
                {canReply && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionsVisible(false);
                      onReply?.(item);
                    }}
                    aria-label="Reply to message"
                    title="Reply"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/12 transition-colors cursor-pointer"
                  >
                    <Reply className="w-3 h-3" />
                  </button>
                )}
                {item.content && (
                  <button
                    type="button"
                    onClick={() => onCopy(id, item.content)}
                    aria-label="Copy message"
                    title="Copy"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#9AA7BF] hover:text-white hover:bg-white/12 transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                )}
              </div>
            )}

            <motion.div
              ref={bubbleRef}
              animate={
                swipe.isHolding && !prefersReduced
                  ? { scale: 0.978 }
                  : { scale: 1 }
              }
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              className={`relative inline-block w-full rounded-[4px_14px_14px_14px] px-3 py-2 transition-shadow duration-150 ${
                isModerator
                  ? 'bg-gradient-to-br from-[#231E18]/92 via-[#151E37]/94 to-[#1A1A38]/94 border border-amber-300/30 shadow-[0_0_24px_rgba(246,196,83,0.1)]'
                  : 'bg-[#131B32]/92 border border-white/10'
              } ${
                swipe.isHolding
                  ? 'ring-2 ring-[#7AA7FF]/55 shadow-[0_8px_24px_rgba(79,91,239,0.24)]'
                  : ''
              }`}
              style={
                isModerator
                  ? undefined
                  : {
                      borderColor: isStreaming ? `${visual.accentHex}55` : undefined,
                    }
              }
            >
              <AnimatePresence>
                {doubleTapBurst && !prefersReduced && (
                  <motion.span
                    key={`burst-${doubleTapBurst.seq}`}
                    initial={{ opacity: 0, scale: 0.4, y: 6 }}
                    animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.45, 1.15, 0.9], y: -28 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.62, ease: [0.16, 1, 0.3, 1] }}
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-3 left-4 z-30 text-2xl select-none drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
                  >
                    {doubleTapBurst.emoji}
                  </motion.span>
                )}
              </AnimatePresence>

              {replyTo && (
                <QuotedReplyCard
                  replyTo={replyTo}
                  duplicateModelSet={duplicateModelSet}
                  onJumpToMessage={onJumpToMessage}
                />
              )}

              {item.content ? (
                <div className="relative">
                  <div className={collapsed ? 'max-h-32 overflow-hidden' : undefined}>
                    <MarkdownContent content={item.content} />
                  </div>

                  {collapsed && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-[#0d1326] to-transparent rounded-b-xl" />
                  )}

                  {isStreaming && (
                    <span
                      className="inline-block w-0.5 h-3.5 ml-1 align-middle animate-council-blink"
                      style={{ backgroundColor: visual.accentHex }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              ) : isStreaming ? (
                <div className="flex items-center gap-1.5 py-1" aria-label="Typing">
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-council-dot-1"
                    style={{ backgroundColor: visual.accentHex }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-council-dot-2"
                    style={{ backgroundColor: visual.accentHex }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-council-dot-3"
                    style={{ backgroundColor: visual.accentHex }}
                  />
                </div>
              ) : (
                <p className="text-xs text-[#9AA7BF]">No text returned.</p>
              )}
            </motion.div>
          </div>
        )}

        {/* Categorized Full Reaction Pack Picker Popover (Portaled above all bubbles) */}
        <ReactionPackPicker
          open={pickerOpen && canReact}
          anchorEl={pickerAnchorEl}
          userEmojis={userEmojis}
          canReply={canReply}
          canCopy={Boolean(item.content)}
          canToggleCollapse={isLongAnswer}
          isCollapsed={collapsed}
          onReplyAction={() => onReply?.(item)}
          onCopyAction={() => onCopy(id, item.content)}
          onToggleCollapseAction={() => setCollapsed((prev) => !prev)}
          onPick={handlePickReaction}
          onClose={() => setPickerOpen(false)}
        />

        {/* Reaction Chips (with smart reactor logos, +N more, inline + trigger, & Who Reacted popover) */}
        <ReactionChipsBar
          rawReactions={item.reactions}
          grouped={grouped}
          canToggle={canReact}
          duplicateModelSet={duplicateModelSet}
          onToggleUserReaction={(emoji) => onToggleReaction?.(id, emoji)}
          onOpenPack={openReactionPackAtElement}
        />

        {/* Lightweight Mobile / Metadata Footer (only takes vertical space when active/copied/collapsed) */}
        {!isStreaming && !isError && (actionsVisible || pickerOpen || copied || collapsed) && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-1 px-0.5 flex flex-wrap items-center gap-2.5 text-[10.5px] text-[#9AA7BF] tabular-nums"
          >
            {canReply && (
              <button
                type="button"
                onClick={() => {
                  setActionsVisible(false);
                  onReply?.(item);
                }}
                className="inline-flex items-center gap-1 text-[#B4BFD4] hover:text-white transition-colors cursor-pointer"
                aria-label="Reply to message"
              >
                <Reply className="w-3 h-3" />
                <span>Reply</span>
              </button>
            )}

            {canReact && (
              <button
                type="button"
                data-reaction-picker-trigger="true"
                onClick={(e) => toggleReactionPack(e.currentTarget)}
                className="inline-flex items-center gap-1 text-[#B4BFD4] hover:text-white transition-colors cursor-pointer"
                aria-label="Open reaction pack"
              >
                <SmilePlus className="w-3 h-3" />
                <span>React</span>
              </button>
            )}

            <span>
              {inputTokens + outputTokens > 0
                ? `${(inputTokens + outputTokens).toLocaleString()} tok`
                : null}
              {latencyMs > 0
                ? `${inputTokens + outputTokens > 0 ? ' · ' : ''}${(latencyMs / 1000).toFixed(1)}s`
                : null}
              {estCost > 0 ? ` · $${estCost.toFixed(4)}` : null}
              {timestampLabel
                ? `${inputTokens + outputTokens > 0 || latencyMs > 0 || estCost > 0 ? ' · ' : ''}${timestampLabel}`
                : null}
            </span>

            {isLongAnswer && (
              <button
                type="button"
                onClick={() => setCollapsed((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[#B4BFD4] hover:text-white transition-colors cursor-pointer"
              >
                {collapsed ? (
                  <>
                    <Maximize2 className="w-3 h-3" />
                    <span>Expand</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-3 h-3" />
                    <span>Collapse</span>
                  </>
                )}
              </button>
            )}

            {item.content && (
              <button
                type="button"
                onClick={() => onCopy(id, item.content)}
                className="inline-flex items-center gap-1 text-[#B4BFD4] hover:text-white transition-colors cursor-pointer"
                aria-label="Copy response"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-300">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
      </motion.article>
    </div>
  );
});
