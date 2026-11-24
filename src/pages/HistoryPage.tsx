import { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Check,
  MessageSquarePlus,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteCouncilRoom,
  timestampToMillis,
  updateCouncilMetadata,
} from '../lib/firestoreService';

export function HistoryPage({
  onNavigate,
}: {
  onNavigate: (route: AppRoute, councilId?: string) => void;
}) {
  const { user, councils } = useAuth();
  const [search, setSearch] = useState('');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return councils.filter((c) => {
      if (archiveFilter === 'active' && c.archived) return false;
      if (archiveFilter === 'archived' && !c.archived) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.selectedModels.some((m) => m.toLowerCase().includes(q)) ||
        c.mode.toLowerCase().includes(q)
      );
    });
  }, [councils, search, archiveFilter]);

  const handleRename = async (councilId: string) => {
    if (!editTitle.trim()) return;
    await updateCouncilMetadata(councilId, { title: editTitle.trim() });
    setEditingId(null);
  };

  return (
    <AppShell
      currentRoute="history"
      pageTitle="Conversation History"
      breadcrumb="Workspace"
      onNavigate={onNavigate}
      primaryAction={
        <button
          type="button"
          onClick={() => onNavigate('new-council')}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          New Council
        </button>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search council titles or models..."
              className="w-full min-h-[44px] pl-10 pr-4 py-2 text-sm bg-[#111827] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-xl self-start">
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
                className={`min-h-[36px] px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
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

        <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80">
          {filtered.map((c) => {
            const isEditing = editingId === c.id;
            const isConfirming = confirmDeleteId === c.id;
            const updatedMs = timestampToMillis(c.updatedAt);

            return (
              <div
                key={c.id}
                className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-800/20 transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  {isEditing ? (
                    <div className="flex items-center gap-2 max-w-md">
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
                        className="flex-1 min-h-[40px] px-3 py-1.5 text-sm bg-[#090E1A] border border-blue-500 rounded-lg text-slate-100 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleRename(c.id)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center text-emerald-400 hover:bg-slate-800 rounded-lg cursor-pointer"
                        aria-label="Save title"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:bg-slate-800 rounded-lg cursor-pointer"
                        aria-label="Cancel rename"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onNavigate('council-room', c.id)}
                      className="text-left font-display font-semibold text-slate-100 hover:text-blue-300 transition-colors block truncate max-w-full cursor-pointer"
                    >
                      {c.title}
                    </button>
                  )}

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400 tabular-nums">
                    <span>
                      {c.mode === 'chat'
                        ? 'Free Chat'
                        : c.mode === 'debate'
                          ? 'Structured Debate'
                          : 'Free Discussion'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono truncate max-w-full">
                      {c.selectedModels.join(', ')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {(c.totalInputTokens + c.totalOutputTokens).toLocaleString()} tokens
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {updatedMs ? new Date(updatedMs).toLocaleDateString() : 'Recent'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isConfirming ? (
                    <>
                      <span className="text-xs text-rose-300 mr-1">Delete permanently?</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (user) void deleteCouncilRoom(user.uid, c.id);
                          setConfirmDeleteId(null);
                        }}
                        className="min-h-[40px] px-3.5 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[40px] px-3 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onNavigate('council-room', c.id)}
                        className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Reopen
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditTitle(c.title);
                        }}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        aria-label="Rename council"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void updateCouncilMetadata(c.id, { archived: !c.archived })
                        }
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        aria-label={c.archived ? 'Restore from archive' : 'Archive council'}
                      >
                        {c.archived ? (
                          <ArchiveRestore className="w-4 h-4" />
                        ) : (
                          <Archive className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(c.id)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        aria-label="Delete council"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-5 py-12 text-center space-y-3">
              <p className="text-sm text-slate-400">
                No Council conversations found in this view.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('new-council')}
                className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                Start a Council Room
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
