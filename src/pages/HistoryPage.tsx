import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Reply,
  Scale,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import { MarkdownContent } from '../components/MarkdownContent';
import {
  getDuplicateProviderCompositeSet,
  getProviderVisual,
  ProviderAvatar,
} from '../components/ProviderBadge';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteCouncilRoom,
  subscribeCouncilMessages,
  timestampToMillis,
  updateCouncilMetadata,
} from '../lib/firestoreService';
import {
  formatParticipantDisplayLabel,
  isManagedSeatModelId,
  isValidProviderId,
} from '../shared/providers';
import type { CouncilMessageDoc, CouncilRoomDoc, ProviderId } from '../shared/types';

function parseComposite(compositeId: string): { providerId: ProviderId; modelId: string } {
  const idx = compositeId.indexOf(':');
  if (idx === -1) return { providerId: 'google', modelId: compositeId };
  const raw = compositeId.slice(0, idx);
  return {
    providerId: isValidProviderId(raw) ? raw : 'google',
    modelId: compositeId.slice(idx + 1),
  };
}

function formatTelegramListTime(ms: number | null): string {
  if (!ms) return 'Recent';
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const diffDays = (now.getTime() - ms) / (1000 * 60 * 60 * 24);
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMessageTimeLabel(rawCreatedAt: unknown): string {
  const ms = timestampToMillis(rawCreatedAt);
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function modeTitle(room: CouncilRoomDoc): string {
  if (room.mode === 'chat') {
    return room.selectedModels.length === 1 ? 'Single Chat' : 'Free Chat';
  }
  return room.mode === 'debate' ? 'Debate' : 'Discussion';
}

export function HistoryPage({
  onNavigate,
}: {
  onNavigate: (route: AppRoute, councilId?: string) => void;
}) {
  const { user, councils, isPremium, isAdmin } = useAuth();
  const hideModelDetails = isPremium && !isAdmin;

  const [search, setSearch] = useState('');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [selectedCouncilId, setSelectedCouncilId] = useState<string | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [messages, setMessages] = useState<CouncilMessageDoc[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = councils.filter((c) => {
      if (archiveFilter === 'active' && c.archived) return false;
      if (archiveFilter === 'archived' && !c.archived) return false;
      if (!q) return true;
      const participantMatch = c.selectedModels.some((cid) => {
        const parsed = parseComposite(cid);
        const safeLabel = formatParticipantDisplayLabel({
          provider: parsed.providerId,
          modelId: parsed.modelId,
          hideModelDetails,
        }).toLowerCase();
        if (safeLabel.includes(q)) return true;
        if (!hideModelDetails && cid.toLowerCase().includes(q)) return true;
        return false;
      });
      return (
        c.title.toLowerCase().includes(q) ||
        participantMatch ||
        modeTitle(c).toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      const ta = timestampToMillis(a.updatedAt) || timestampToMillis(a.createdAt) || 0;
      const tb = timestampToMillis(b.updatedAt) || timestampToMillis(b.createdAt) || 0;
      return tb - ta;
    });
  }, [councils, search, archiveFilter, hideModelDetails]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedCouncilId(null);
      return;
    }
    if (!selectedCouncilId || !filtered.some((c) => c.id === selectedCouncilId)) {
      setSelectedCouncilId(filtered[0].id);
    }
  }, [filtered, selectedCouncilId]);

  const selectedCouncil = useMemo(
    () => filtered.find((c) => c.id === selectedCouncilId) || null,
    [filtered, selectedCouncilId],
  );

  useEffect(() => {
    if (!user || !selectedCouncil?.id) {
      setMessages([]);
      setLoadingMessages(false);
      return;
    }
    setLoadingMessages(true);
    let firstSnapshot = true;
    const unsub = subscribeCouncilMessages(user.uid, selectedCouncil.id, (docs) => {
      setMessages(docs);
      if (firstSnapshot) {
        firstSnapshot = false;
        setLoadingMessages(false);
      }
    });
    const fallbackTimer = window.setTimeout(() => setLoadingMessages(false), 1200);
    return () => {
      window.clearTimeout(fallbackTimer);
      unsub();
    };
  }, [user, selectedCouncil?.id]);

  const duplicateModelSet = useMemo(() => {
    if (!selectedCouncil) return new Set<string>();
    return getDuplicateProviderCompositeSet(selectedCouncil.selectedModels);
  }, [selectedCouncil]);

  const selectedParticipantNames = useMemo(() => {
    if (!selectedCouncil) return [];
    return selectedCouncil.selectedModels.map((cid, idx) => {
      const parsed = parseComposite(cid);
      const label = formatParticipantDisplayLabel({
        provider: parsed.providerId,
        modelId: parsed.modelId,
        hideModelDetails,
        seatLabel:
          duplicateModelSet.has(cid) || hideModelDetails ? `Seat ${idx + 1}` : undefined,
      });
      return { cid, parsed, label };
    });
  }, [selectedCouncil, duplicateModelSet, hideModelDetails]);

  const handleRename = async (councilId: string) => {
    if (!editTitle.trim()) return;
    await updateCouncilMetadata(councilId, { title: editTitle.trim() });
    setEditingId(null);
  };

  const handleCopyMessage = async (msgId: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(msgId);
    window.setTimeout(() => {
      setCopiedId((cur) => (cur === msgId ? null : cur));
    }, 1500);
  };

  return (
    <AppShell
      currentRoute="history"
      pageTitle="Chat History"
      onNavigate={onNavigate}
      fullBleed
      primaryAction={
        <button
          type="button"
          onClick={() => onNavigate('new-council')}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap cursor-pointer shrink-0"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          New Council
        </button>
      }
    >
      <div className="flex-1 min-h-0 flex w-full overflow-hidden bg-[#080D1A]">
        {/* Left Telegram Conversation List */}
        <aside
          className={`${
            mobileShowChat ? 'hidden md:flex' : 'flex'
          } w-full md:w-[340px] lg:w-[376px] shrink-0 flex-col min-h-0 border-r border-slate-800/80 bg-[#0B1121]`}
        >
          {/* Search & Segmented Filter */}
          <div className="p-3.5 border-b border-slate-800/80 space-y-2.5 shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chat history..."
                className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 bg-[#090E1A] border border-slate-800/90 rounded-xl">
              {(
                [
                  ['active', 'Active'],
                  ['archived', 'Archived'],
                  ['all', 'All'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setArchiveFilter(key)}
                  className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    archiveFilter === key
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Chat Thread List */}
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800/50">
            {filtered.map((c) => {
              const isSelected = c.id === selectedCouncil?.id;
              const isEditing = editingId === c.id;
              const isConfirming = confirmDeleteId === c.id;
              const updatedMs =
                timestampToMillis(c.updatedAt) || timestampToMillis(c.createdAt);
              const dupSet = getDuplicateProviderCompositeSet(c.selectedModels);

              return (
                <div
                  key={c.id}
                  className={`group relative px-3.5 py-3 transition-colors ${
                    isSelected
                      ? 'bg-blue-600/14'
                      : 'hover:bg-slate-800/35'
                  }`}
                >
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleRename(c.id);
                          } else if (e.key === 'Escape') {
                            setEditingId(null);
                          }
                        }}
                        className="flex-1 min-h-[38px] px-2.5 py-1 text-sm bg-[#090E1A] border border-blue-500 rounded-lg text-slate-100 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleRename(c.id)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center text-emerald-400 hover:bg-slate-800 rounded-lg cursor-pointer"
                        aria-label="Save title"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-400 hover:bg-slate-800 rounded-lg cursor-pointer"
                        aria-label="Cancel rename"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : isConfirming ? (
                    <div className="flex items-center justify-between gap-2 py-1">
                      <span className="text-xs text-rose-300 truncate">
                        Delete &ldquo;{c.title}&rdquo;?
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (user) void deleteCouncilRoom(user.uid, c.id);
                            setConfirmDeleteId(null);
                          }}
                          className="min-h-[34px] px-3 py-1 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="min-h-[34px] px-2.5 py-1 text-xs text-slate-300 hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCouncilId(c.id);
                          setMobileShowChat(true);
                        }}
                        className="flex-1 min-w-0 flex items-start gap-3 text-left cursor-pointer"
                      >
                        {/* Stacked Avatars */}
                        <div className="relative flex items-center pl-1.5 pt-0.5 shrink-0">
                          {c.selectedModels.slice(0, 2).map((cid) => {
                            const parsed = parseComposite(cid);
                            return (
                              <div
                                key={cid}
                                className="-ml-1.5 rounded-full ring-2 ring-[#0B1121]"
                              >
                                <ProviderAvatar
                                  provider={parsed.providerId}
                                  modelId={parsed.modelId}
                                  useModelLogo={dupSet.has(cid)}
                                  size="sm"
                                />
                              </div>
                            );
                          })}
                          {c.selectedModels.length > 2 && (
                            <div className="-ml-1.5 w-8 h-8 rounded-full bg-slate-800 border-2 border-[#0B1121] flex items-center justify-center text-[10px] font-semibold text-slate-300 tabular-nums">
                              +{c.selectedModels.length - 2}
                            </div>
                          )}
                        </div>

                        {/* Title + Quiet Metadata */}
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span
                              className={`font-display text-sm font-semibold truncate ${
                                isSelected ? 'text-white' : 'text-slate-100'
                              }`}
                            >
                              {c.title}
                            </span>
                            <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                              {formatTelegramListTime(updatedMs)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 truncate tabular-nums">
                            <span>{modeTitle(c)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{c.selectedModels.length} seats</span>
                            {c.archived && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-300/90">Archived</span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* Quick Row Actions */}
                      <div
                        className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
                          isSelected
                            ? 'opacity-100'
                            : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(c.id);
                            setEditTitle(c.title);
                          }}
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 rounded-lg cursor-pointer"
                          aria-label="Rename council"
                          title="Rename"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void updateCouncilMetadata(c.id, { archived: !c.archived })
                          }
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 rounded-lg cursor-pointer"
                          aria-label={c.archived ? 'Restore council' : 'Archive council'}
                          title={c.archived ? 'Restore' : 'Archive'}
                        >
                          {c.archived ? (
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          ) : (
                            <Archive className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(c.id)}
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 rounded-lg cursor-pointer"
                          aria-label="Delete council"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="px-5 py-12 text-center space-y-3">
                <MessageSquare className="w-7 h-7 text-slate-500 mx-auto" />
                <p className="text-sm text-slate-400">
                  No chats found in this view.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('new-council')}
                  className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  New Council
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Right Telegram Transcript Viewer */}
        <section
          className={`${
            mobileShowChat ? 'flex' : 'hidden md:flex'
          } flex-1 min-w-0 flex-col min-h-0 council-chat-mesh`}
        >
          {selectedCouncil ? (
            <>
              {/* Sticky Telegram Chat Header */}
              <div className="shrink-0 px-4 sm:px-6 py-3 bg-[#0B1123]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => setMobileShowChat(false)}
                    className="md:hidden min-h-[40px] min-w-[40px] -ml-1 flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
                    aria-label="Back to chat list"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>

                  <div className="flex items-center pl-2 shrink-0">
                    {selectedCouncil.selectedModels.slice(0, 4).map((cid) => {
                      const parsed = parseComposite(cid);
                      return (
                        <div
                          key={cid}
                          className="-ml-2 rounded-full ring-2 ring-[#0B1123]"
                        >
                          <ProviderAvatar
                            provider={parsed.providerId}
                            modelId={parsed.modelId}
                            useModelLogo={duplicateModelSet.has(cid)}
                            size="sm"
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="min-w-0">
                    <h2 className="font-display font-semibold text-sm sm:text-base text-slate-100 truncate">
                      {selectedCouncil.title}
                    </h2>
                    <p className="text-xs text-slate-400 truncate">
                      {modeTitle(selectedCouncil)}
                      <span aria-hidden="true"> · </span>
                      {selectedParticipantNames.map((p) => p.label).join(' · ')}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate('council-room', selectedCouncil.id)}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open Council Room
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Scrollable Telegram Chat Feed */}
              <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4">
                <div className="mx-auto max-w-3xl space-y-3">
                  {loadingMessages && (
                    <div className="space-y-3 py-4">
                      <div className="ml-auto w-2/3 max-w-sm h-14 rounded-2xl bg-slate-800/40 animate-pulse" />
                      <div className="w-3/4 max-w-md h-24 rounded-2xl bg-slate-800/40 animate-pulse" />
                      <div className="w-2/3 max-w-md h-20 rounded-2xl bg-slate-800/40 animate-pulse" />
                    </div>
                  )}

                  {!loadingMessages && messages.length === 0 && (
                    <div className="py-16 text-center space-y-3">
                      <MessageSquare className="w-8 h-8 text-slate-500 mx-auto" />
                      <p className="text-sm text-slate-300">
                        No messages saved in this conversation yet.
                      </p>
                      <button
                        type="button"
                        onClick={() => onNavigate('council-room', selectedCouncil.id)}
                        className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors cursor-pointer"
                      >
                        Open Council Room
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {!loadingMessages &&
                    messages.map((m, idx) => {
                      const prev = idx > 0 ? messages[idx - 1] : null;
                      const showRoundDivider =
                        selectedCouncil.mode !== 'chat' &&
                        m.round > 0 &&
                        (!prev || prev.round !== m.round);
                      const isUser = m.role === 'user';
                      const isModerator = m.role === 'moderator';
                      const timeLabel = formatMessageTimeLabel(m.createdAt);

                      const replySenderLabel = m.replyTo
                        ? m.replyTo.role === 'user' || m.replyTo.provider === 'user'
                          ? 'You'
                          : formatParticipantDisplayLabel({
                              provider: m.replyTo.provider,
                              modelId: m.replyTo.modelId,
                              modelLabel: m.replyTo.modelLabel,
                              hideModelDetails,
                            })
                        : '';

                      if (isUser) {
                        return (
                          <div key={m.id} className="space-y-3">
                            {showRoundDivider && (
                              <div className="flex items-center gap-3 py-1">
                                <div className="h-px flex-1 bg-white/10" />
                                <span className="text-[11px] font-medium text-slate-400">
                                  Round {m.round}
                                </span>
                                <div className="h-px flex-1 bg-white/10" />
                              </div>
                            )}
                            <div className="flex justify-end animate-telegram-pop">
                              <div
                                className="max-w-[86%] sm:max-w-[74%] px-3.5 py-2.5 rounded-[18px_18px_4px_18px] text-white text-sm leading-relaxed shadow-[0_6px_18px_rgba(79,91,239,0.28)]"
                                style={{
                                  background: 'linear-gradient(135deg, #4F5BEF, #7C4DE8)',
                                }}
                              >
                                {m.replyTo && (
                                  <div className="mb-1.5 px-2.5 py-1.5 rounded-xl bg-black/25 border border-white/15 text-xs">
                                    <div className="flex items-center gap-1 font-semibold text-white/90">
                                      <Reply className="w-3 h-3" />
                                      <span>{replySenderLabel}</span>
                                    </div>
                                    <p className="text-[11px] text-white/80 line-clamp-2">
                                      {m.replyTo.snippet}
                                    </p>
                                  </div>
                                )}
                                <div className="whitespace-pre-wrap break-words">
                                  {m.content}
                                </div>
                                <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-white/75 tabular-nums">
                                  {m.reactions && m.reactions.length > 0 && (
                                    <span>
                                      {Array.from(
                                        new Set(m.reactions.map((r) => r.emoji)),
                                      ).join(' ')}
                                    </span>
                                  )}
                                  {timeLabel && <span>{timeLabel}</span>}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      const visual = getProviderVisual(m.provider);
                      const speakerDisplay = formatParticipantDisplayLabel({
                        provider: m.provider,
                        modelId: m.modelId,
                        modelLabel: m.modelLabel,
                        hideModelDetails,
                      });
                      const showRawModelSub =
                        !hideModelDetails &&
                        !isManagedSeatModelId(m.modelId || '') &&
                        m.modelId &&
                        m.modelId !== speakerDisplay;

                      return (
                        <div key={m.id} className="space-y-3">
                          {showRoundDivider && (
                            <div className="flex items-center gap-3 py-1">
                              <div className="h-px flex-1 bg-white/10" />
                              <span className="text-[11px] font-medium text-slate-400">
                                Round {m.round}
                              </span>
                              <div className="h-px flex-1 bg-white/10" />
                            </div>
                          )}
                          <div className="flex items-start gap-2.5 max-w-[92%] sm:max-w-[82%] animate-telegram-pop">
                            <div className="pt-0.5 shrink-0">
                              <ProviderAvatar
                                provider={m.provider}
                                modelId={m.modelId}
                                useModelLogo={duplicateModelSet.has(
                                  `${m.provider}:${m.modelId}`,
                                )}
                                role={m.role}
                                size="xs"
                              />
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2 px-0.5">
                                <span
                                  className="font-display text-xs font-semibold truncate"
                                  style={{
                                    color: isModerator ? '#F6C453' : visual.accentHex,
                                  }}
                                >
                                  {speakerDisplay}
                                </span>
                                {showRawModelSub && (
                                  <span className="font-mono text-[10.5px] text-slate-400 truncate max-w-[180px]">
                                    {m.modelId}
                                  </span>
                                )}
                                {isModerator && (
                                  <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-300">
                                    <Scale className="w-3 h-3" />
                                    Moderator
                                  </span>
                                )}
                              </div>

                              <div
                                className={`rounded-[4px_18px_18px_18px] px-3.5 py-2.5 border ${
                                  m.status === 'error'
                                    ? 'bg-rose-950/50 border-rose-500/35 text-rose-200 text-xs'
                                    : isModerator
                                      ? 'bg-[#1D1B2A]/95 border-amber-300/25'
                                      : 'bg-[#131B32]/92 border-white/10'
                                }`}
                              >
                                {m.replyTo && (
                                  <div className="mb-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs">
                                    <div className="flex items-center gap-1 font-medium text-slate-200">
                                      <Reply className="w-3 h-3 text-blue-400" />
                                      <span>{replySenderLabel}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-400 line-clamp-2">
                                      {m.replyTo.snippet}
                                    </p>
                                  </div>
                                )}

                                {m.status === 'error' ? (
                                  <p>{m.errorMessage || 'Provider request failed.'}</p>
                                ) : (
                                  <MarkdownContent content={m.content || '(empty response)'} />
                                )}

                                <div className="mt-2 pt-1 border-t border-white/[0.06] flex items-center justify-between gap-2 text-[10.5px] text-slate-400 tabular-nums">
                                  <div className="flex items-center gap-2">
                                    {m.reactions && m.reactions.length > 0 && (
                                      <span>
                                        {Array.from(
                                          new Set(m.reactions.map((r) => r.emoji)),
                                        ).join(' ')}
                                      </span>
                                    )}
                                    {timeLabel && <span>{timeLabel}</span>}
                                  </div>
                                  {m.content && (
                                    <button
                                      type="button"
                                      onClick={() => void handleCopyMessage(m.id, m.content)}
                                      className="inline-flex items-center gap-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
                                    >
                                      {copiedId === m.id ? (
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
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Bottom Quick Action Footer */}
              <div className="shrink-0 px-4 sm:px-6 py-2.5 bg-[#0B1123]/95 border-t border-white/[0.08] flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400 tabular-nums truncate">
                  {messages.length} messages
                  <span aria-hidden="true"> · </span>
                  {(
                    selectedCouncil.totalInputTokens + selectedCouncil.totalOutputTokens
                  ).toLocaleString()}{' '}
                  tokens
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('council-room', selectedCouncil.id)}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Continue in Council Room
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
              <MessageSquare className="w-9 h-9 text-slate-500" />
              <p className="font-display text-base font-semibold text-slate-200">
                Select a conversation
              </p>
              <p className="text-sm text-slate-400 max-w-sm">
                Choose any Council room on the left to inspect its full Telegram-style chat transcript, or start a new session.
              </p>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
