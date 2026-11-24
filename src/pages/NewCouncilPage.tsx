import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Crown,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Wand2,
  X,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { AppShell, type AppRoute } from '../components/AppShell';
import {
  getDuplicateProviderCompositeSet,
  ProviderAvatar,
} from '../components/ProviderBadge';
import { SeatModelPickerModal } from '../components/SeatModelPickerModal';
import { useAuth } from '../contexts/AuthContext';
import { runPreflightApi, smartSelectModelsApi } from '../lib/apiClient';
import { createCouncilRoom } from '../lib/firestoreService';
import { pickQuickMixIds } from '../lib/modelSelection';
import { formatStatusLabel } from '../lib/statusLabels';
import { isModelFreeTier, PROVIDER_REGISTRY } from '../shared/providers';
import {
  PREMIUM_PROVIDER_PRIORITY,
  type DiscussionMode,
  type IntelligenceLevel,
} from '../shared/types';

const INTELLIGENCE_OPTIONS: Array<{
  id: IntelligenceLevel;
  label: string;
  hint: string;
}> = [
  { id: 'low', label: 'Low', hint: 'Fast, lightweight & default' },
  { id: 'medium', label: 'Medium', hint: 'Balanced reasoning & speed' },
  { id: 'high', label: 'High', hint: 'Deep analysis & complex coding' },
  { id: 'extreme', label: 'Extreme', hint: 'Heavy multi-step deliberation' },
];

const COUNCIL_TYPES: Array<{
  id: DiscussionMode;
  label: string;
  hint: string;
  multiOnly?: boolean;
}> = [
  { id: 'chat', label: 'Free Chat', hint: 'Direct group chat' },
  { id: 'free', label: 'Discussion', hint: 'Rounds + moderator', multiOnly: true },
  { id: 'debate', label: 'Debate', hint: '3 rounds + verdict', multiOnly: true },
];

const SEAT_COUNT_OPTIONS = [2, 3, 4, 5, 6] as const;

export function NewCouncilPage({
  initialSelectedModels,
  initialModeratorModel,
  initialMode = 'chat',
  onNavigate,
  onCreatedAndStart,
}: {
  initialSelectedModels: string[];
  initialModeratorModel?: string;
  initialMode?: DiscussionMode;
  onNavigate: (route: AppRoute) => void;
  onCreatedAndStart: (councilId: string, initialPrompt: string) => void;
}) {
  const prefersReduced = Boolean(useReducedMotion());
  const {
    user,
    profile,
    isPremium,
    isAdmin,
    connections,
    models,
    connectionsLoading,
    refreshProviderState,
  } = useAuth();

  const availableModels = useMemo(
    () =>
      models.filter(
        (m) =>
          m.available &&
          (m.availabilityState === 'inference_ready' || m.availabilityState === 'verified'),
      ),
    [models],
  );
  const freeAvailableModels = useMemo(
    () => availableModels.filter((m) => isModelFreeTier(m)),
    [availableModels],
  );
  const modelMap = useMemo(
    () => new Map(models.map((m) => [m.compositeId, m])),
    [models],
  );

  const singleModelOnly = availableModels.length === 1;
  const minRequiredModels = singleModelOnly ? 1 : 2;
  const connectedProviders = connections.filter((c) => c.status === 'connected');

  const initialCount = singleModelOnly
    ? 1
    : initialSelectedModels.length >= 2
      ? Math.min(6, initialSelectedModels.length)
      : 3;

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<DiscussionMode>(initialMode);
  const [intelligenceLevel, setIntelligenceLevel] = useState<IntelligenceLevel>('low');
  const [maxRounds, setMaxRounds] = useState(2);
  const [seatCount, setSeatCount] = useState<number>(initialCount);
  const [manualCustomize, setManualCustomize] = useState<boolean>(
    initialSelectedModels.length > 0,
  );
  const [seatModels, setSeatModels] = useState<Array<string | null>>(() => {
    const arr: Array<string | null> = Array.from({ length: initialCount }, () => null);
    initialSelectedModels.slice(0, initialCount).forEach((cid, i) => {
      arr[i] = cid;
    });
    return arr;
  });
  const [moderatorModel, setModeratorModel] = useState<string>(
    initialModeratorModel || profile?.preferredModeratorModel || '',
  );

  const [activeSeatIndex, setActiveSeatIndex] = useState<number | null>(null);
  const [autoFilling, setAutoFilling] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [checkedReadyIds, setCheckedReadyIds] = useState<Set<string>>(() => new Set());
  const [unavailableReasons, setUnavailableReasons] = useState<Record<string, string>>({});
  const [hasCheckedOnce, setHasCheckedOnce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync single-model constraint if only 1 model exists
  useEffect(() => {
    if (singleModelOnly) {
      if (mode !== 'chat') setMode('chat');
      const soleId = availableModels[0].compositeId;
      setSeatCount(1);
      setSeatModels([soleId]);
      setModeratorModel('none');
    }
  }, [singleModelOnly, mode, availableModels]);

  // Premium Automatic Cycling Priority Seat Selection (Gemini -> Groq -> OpenRouter -> Cohere)
  useEffect(() => {
    if (!isPremium || manualCustomize || singleModelOnly || availableModels.length === 0) {
      return;
    }

    let cancelled = false;
    setAutoFilling(true);
    setError(null);

    const runAutoPriority = async () => {
      try {
        const result = await smartSelectModelsApi(
          'Premium council auto-selection',
          mode,
          intelligenceLevel,
          {
            seatCount,
            preferredProviders: [...PREMIUM_PROVIDER_PRIORITY],
          },
        );
        if (cancelled) return;
        const nextSeats: Array<string | null> = Array.from({ length: seatCount }, (_, i) =>
          result.selectedModels[i] || null,
        );
        setSeatModels(nextSeats);
        setUnavailableReasons({});
        setCheckedReadyIds(new Set(result.selectedModels));
        setHasCheckedOnce(true);
        if (mode !== 'chat' && result.moderatorModel && nextSeats.includes(result.moderatorModel)) {
          setModeratorModel(result.moderatorModel);
        } else if (nextSeats[0]) {
          setModeratorModel(nextSeats[0]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setAutoFilling(false);
        }
      }
    };

    void runAutoPriority();
    return () => {
      cancelled = true;
    };
  }, [isPremium, manualCustomize, singleModelOnly, availableModels.length, intelligenceLevel, seatCount, mode]);

  const handleSeatCountChange = (nextCount: number) => {
    if (singleModelOnly) return;
    setSeatCount(nextCount);
    setSeatModels((prev) => {
      if (prev.length === nextCount) return prev;
      if (nextCount < prev.length) return prev.slice(0, nextCount);
      return [
        ...prev,
        ...Array.from({ length: nextCount - prev.length }, () => null),
      ];
    });
    setError(null);
  };

  const filledModels = useMemo(
    () => seatModels.filter((cid): cid is string => Boolean(cid)),
    [seatModels],
  );
  const duplicateModelSet = useMemo(
    () => getDuplicateProviderCompositeSet(seatModels),
    [seatModels],
  );

  // Keep moderatorModel synced with filled seats for Discussion / Debate
  useEffect(() => {
    if (singleModelOnly || mode === 'chat') return;
    if (filledModels.length === 0) return;
    if (!moderatorModel || moderatorModel === 'none' || !filledModels.includes(moderatorModel)) {
      setModeratorModel(filledModels[0]);
    }
  }, [singleModelOnly, mode, filledModels, moderatorModel]);

  const unavailableSet = useMemo(
    () => new Set(Object.keys(unavailableReasons)),
    [unavailableReasons],
  );

  const flaggedSeatCount = useMemo(
    () => seatModels.filter((cid) => cid && unavailableSet.has(cid)).length,
    [seatModels, unavailableSet],
  );

  const handleAssignSeat = (seatIdx: number, compositeId: string) => {
    setSeatModels((prev) => {
      const next = [...prev];
      const previousId = next[seatIdx];
      next[seatIdx] = compositeId;
      if (previousId && previousId !== compositeId) {
        setUnavailableReasons((curr) => {
          if (!curr[previousId]) return curr;
          const copy = { ...curr };
          delete copy[previousId];
          return copy;
        });
      }
      return next;
    });
    setUnavailableReasons((curr) => {
      if (!curr[compositeId]) return curr;
      const copy = { ...curr };
      delete copy[compositeId];
      return copy;
    });
    setCheckedReadyIds((curr) => {
      const copy = new Set(curr);
      copy.delete(compositeId);
      return copy;
    });
    setActiveSeatIndex(null);
    setError(null);
  };

  const handleClearSeat = (seatIdx: number) => {
    const removed = seatModels[seatIdx];
    setSeatModels((prev) => {
      const next = [...prev];
      next[seatIdx] = null;
      return next;
    });
    if (removed) {
      setUnavailableReasons((curr) => {
        if (!curr[removed]) return curr;
        const copy = { ...curr };
        delete copy[removed];
        return copy;
      });
    }
    setError(null);
  };

  const handleAutoFillSeats = async () => {
    setError(null);
    setAutoFilling(true);
    try {
      const preferFree = !isPremium && freeAvailableModels.length >= minRequiredModels;
      const hint = title.trim() || `${mode} council discussion`;
      const result = await smartSelectModelsApi(hint, mode, intelligenceLevel, {
        freeOnly: preferFree,
        seatCount,
        preferredProviders: isPremium ? [...PREMIUM_PROVIDER_PRIORITY] : undefined,
      });
      const picked = [...result.selectedModels];
      if (picked.length < seatCount) {
        const extra = pickQuickMixIds(
          availableModels,
          preferFree ? 'best_free' : 'all_providers',
          seatCount + 2,
        );
        for (const id of extra) {
          if (picked.length >= seatCount) break;
          if (!picked.includes(id)) picked.push(id);
        }
      }
      const nextSeats: Array<string | null> = Array.from({ length: seatCount }, (_, i) =>
        picked[i] || null,
      );
      setSeatModels(nextSeats);
      setUnavailableReasons({});
      setCheckedReadyIds(new Set(picked.slice(0, seatCount)));
      setHasCheckedOnce(true);
      if (mode !== 'chat' && result.moderatorModel && nextSeats.includes(result.moderatorModel)) {
        setModeratorModel(result.moderatorModel);
      } else if (nextSeats[0]) {
        setModeratorModel(nextSeats[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoFilling(false);
    }
  };

  const handleCheckAvailability = async () => {
    if (filledModels.length === 0) {
      setError('Add at least one AI member to check availability.');
      return;
    }
    setError(null);
    setCheckingAvailability(true);
    try {
      const targets = Array.from(
        new Set([
          ...filledModels,
          ...(mode !== 'chat' && moderatorModel && moderatorModel !== 'none'
            ? [moderatorModel]
            : []),
        ]),
      );
      const report = await runPreflightApi(targets, true);
      const readySet = new Set(report.readyModels.map((m) => m.compositeId));
      const rejectedMap: Record<string, string> = {};
      for (const r of report.rejectedModels) {
        rejectedMap[r.compositeId] = r.reason || formatStatusLabel(r.availabilityState);
      }
      setCheckedReadyIds(readySet);
      setUnavailableReasons(rejectedMap);
      setHasCheckedOnce(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingAvailability(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);

    if (filledModels.length < minRequiredModels) {
      setError(
        singleModelOnly
          ? 'Select the available model to start Single Model Chat.'
          : `Select at least ${minRequiredModels} AI members before starting.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const effectiveMode: DiscussionMode = singleModelOnly ? 'chat' : mode;
      const resolvedMod =
        effectiveMode === 'chat'
          ? 'none'
          : moderatorModel && filledModels.includes(moderatorModel)
            ? moderatorModel
            : filledModels[0];

      const targets = Array.from(
        new Set([
          ...filledModels,
          ...(effectiveMode !== 'chat' && resolvedMod !== 'none' ? [resolvedMod] : []),
        ]),
      );

      const report = await runPreflightApi(targets, true);
      const readySet = new Set(report.readyModels.map((m) => m.compositeId));
      const rejectedMap: Record<string, string> = {};
      for (const r of report.rejectedModels) {
        if (targets.includes(r.compositeId)) {
          rejectedMap[r.compositeId] = r.reason || formatStatusLabel(r.availabilityState);
        }
      }

      setCheckedReadyIds(readySet);
      setUnavailableReasons(rejectedMap);
      setHasCheckedOnce(true);

      const failedSeated = filledModels.filter((id) => !readySet.has(id));
      if (failedSeated.length > 0) {
        setError(
          `${failedSeated.length} selected AI ${
            failedSeated.length === 1 ? 'member is' : 'members are'
          } unavailable right now. Tap a red seat or switch to manual customization to reselect.`,
        );
        setManualCustomize(true);
        setSubmitting(false);
        return;
      }

      const effectiveTitle =
        title.trim() ||
        (effectiveMode === 'chat'
          ? filledModels.length === 1
            ? 'Single Model Chat'
            : 'Free Chat'
          : effectiveMode === 'debate'
            ? 'Debate Council'
            : 'Discussion Council');

      const council = await createCouncilRoom(user.uid, {
        title: effectiveTitle,
        mode: effectiveMode,
        intelligenceLevel,
        selectedModels: filledModels,
        moderatorModel: resolvedMod,
        maxRounds:
          effectiveMode === 'debate' ? 3 : effectiveMode === 'chat' ? 1 : maxRounds,
      });
      onCreatedAndStart(council.id, '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const activeIntelOption = INTELLIGENCE_OPTIONS.find((o) => o.id === intelligenceLevel);
  const isPremiumAutoMode = isPremium && !manualCustomize && !singleModelOnly;

  return (
    <AppShell
      currentRoute="new-council"
      pageTitle="New Council"
      breadcrumb="Workspace"
      onNavigate={onNavigate}
    >
      {availableModels.length === 0 ? (
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6 max-w-xl space-y-4">
          <div className="space-y-1.5">
            <h2 className="font-display text-base font-semibold text-slate-100">
              {isPremium ? 'No shared or personal models online yet' : 'No models connected yet'}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isAdmin
                ? 'Open Connections → Admin Shared Pool to connect Gemini, Groq, OpenRouter, or Cohere keys for Premium and workspace councils.'
                : isPremium
                  ? 'Admin shared APIs are currently offline or have not discovered models yet. You can refresh status or optionally connect a personal API key under Connections.'
                  : `Connect at least one API key across ${connectedProviders.length} active ${
                      connectedProviders.length === 1 ? 'provider' : 'providers'
                    } — or upgrade to Premium to use Admin-connected APIs immediately.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('connections')}
              className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {isAdmin ? 'Configure Admin Pool' : 'Connect Provider'}
            </button>
            {!isPremium && (
              <button
                type="button"
                onClick={() => onNavigate('premium')}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
              >
                <Crown className="w-3.5 h-3.5" />
                Go Premium (29৳)
              </button>
            )}
            <button
              type="button"
              disabled={connectionsLoading}
              onClick={() => void refreshProviderState(true)}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white border border-slate-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${connectionsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
          {/* 1. Council Name */}
          <section className="space-y-1.5">
            <label htmlFor="council-title" className="block text-xs font-medium text-slate-300">
              Council Name
            </label>
            <input
              id="council-title"
              type="text"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Name or topic (optional)"
              className="w-full min-h-[44px] px-3.5 py-2.5 text-sm bg-[#111827] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none transition-colors"
            />
          </section>

          {/* 2. Council Type */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-300">Council Type</span>
              {singleModelOnly && (
                <span className="text-xs text-blue-300">
                  Single model connected · Free Chat only
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {COUNCIL_TYPES.map((t) => {
                const disabled = Boolean(t.multiOnly && singleModelOnly);
                const active = mode === t.id;
                return (
                  <motion.button
                    key={t.id}
                    type="button"
                    disabled={disabled}
                    whileTap={!disabled && !prefersReduced ? { scale: 0.985 } : undefined}
                    onClick={() => setMode(t.id)}
                    className={`min-h-[58px] text-left px-4 py-3 rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                      active
                        ? 'bg-blue-950/40 border-blue-500/65 text-slate-100'
                        : 'bg-[#111827] border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <p className="font-display text-sm font-semibold text-slate-100">
                      {t.id === 'chat' && singleModelOnly ? 'Single Chat' : t.label}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{t.hint}</p>
                  </motion.button>
                );
              })}
            </div>

            <AnimatePresence initial={false}>
              {mode === 'free' && !singleModelOnly && (
                <motion.div
                  initial={prefersReduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={prefersReduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="pt-1 flex items-center justify-between gap-3 px-1">
                    <span className="text-xs text-slate-400">Discussion rounds</span>
                    <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg">
                      {[1, 2, 3, 4, 5, 6]
                        .filter((n) => n <= (profile?.maxRoundsLimit || 6))
                        .map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setMaxRounds(n)}
                            className={`w-8 h-8 text-xs font-medium rounded-md tabular-nums transition-colors cursor-pointer ${
                              maxRounds === n
                                ? 'bg-blue-600 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* 3. Intelligence Level */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-300">Intelligence Level</span>
              {activeIntelOption && (
                <span className="text-xs text-slate-400 truncate">{activeIntelOption.hint}</span>
              )}
            </div>

            <LayoutGroup id="intelligence-level-group">
              <div className="grid grid-cols-4 gap-1 p-1 bg-[#111827] border border-slate-800 rounded-xl">
                {INTELLIGENCE_OPTIONS.map((opt) => {
                  const active = intelligenceLevel === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setIntelligenceLevel(opt.id)}
                      className={`relative min-h-[40px] px-2 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                        active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="intelligence-active-pill"
                          transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                          className="absolute inset-0 bg-blue-600 rounded-lg"
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative z-10">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </LayoutGroup>
          </section>

          {/* 4. Member Seats */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-300">Member Seats</span>
                {!singleModelOnly && (
                  <div
                    className="flex items-center gap-0.5 p-0.5 bg-[#111827] border border-slate-800 rounded-lg"
                    role="group"
                    aria-label="Number of member seats"
                  >
                    {SEAT_COUNT_OPTIONS.map((count) => {
                      const active = seatCount === count;
                      return (
                        <button
                          key={count}
                          type="button"
                          onClick={() => handleSeatCountChange(count)}
                          className={`w-8 h-8 text-xs font-semibold rounded-md tabular-nums transition-colors cursor-pointer ${
                            active
                              ? 'bg-slate-800 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {count}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isPremium && !singleModelOnly && (
                  <button
                    type="button"
                    onClick={() => setManualCustomize((v) => !v)}
                    className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      manualCustomize
                        ? 'bg-blue-600/15 border-blue-500/40 text-blue-300'
                        : 'bg-[#111827] hover:bg-slate-800 border-slate-800 text-slate-200'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    {manualCustomize ? 'Use Premium Auto' : 'Customize Manually'}
                  </button>
                )}

                {(!isPremium || manualCustomize) && !singleModelOnly && (
                  <button
                    type="button"
                    disabled={autoFilling}
                    onClick={() => void handleAutoFillSeats()}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
                  >
                    <Wand2 className={`w-3.5 h-3.5 text-blue-400 ${autoFilling ? 'animate-pulse' : ''}`} />
                    {autoFilling ? 'Filling...' : 'Auto-Fill'}
                  </button>
                )}

                <button
                  type="button"
                  disabled={checkingAvailability || filledModels.length === 0}
                  onClick={() => void handleCheckAvailability()}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-lg transition-colors whitespace-nowrap disabled:opacity-45 cursor-pointer"
                >
                  <ShieldCheck
                    className={`w-3.5 h-3.5 text-emerald-400 ${
                      checkingAvailability ? 'animate-pulse' : ''
                    }`}
                  />
                  {checkingAvailability ? 'Checking...' : 'Check Availability'}
                </button>
              </div>
            </div>

            {/* Premium Automatic Priority Lineup Banner */}
            {isPremiumAutoMode && (
              <div className="bg-[#121A2F] border border-amber-500/35 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-amber-200">
                  <Crown className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Auto-selected for{' '}
                    <strong className="text-white">{activeIntelOption?.label}</strong> intelligence
                  </span>
                </div>
                <span className="text-slate-400 font-mono text-[11px]">
                  Priority: Gemini → Groq → OpenRouter → Cohere
                </span>
              </div>
            )}

            {/* Seat Boxes Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <AnimatePresence initial={false}>
                {seatModels.map((cid, idx) => {
                  const info = cid ? modelMap.get(cid) : undefined;
                  const pid =
                    info?.provider ||
                    (cid ? (cid.split(':')[0] as keyof typeof PROVIDER_REGISTRY) : undefined);
                  const modelId = info?.modelId || (cid ? cid.split(':').slice(1).join(':') : undefined);
                  const cfg = pid ? PROVIDER_REGISTRY[pid] : undefined;
                  const isFree = info ? isModelFreeTier(info) : false;
                  const unavailReason = cid ? unavailableReasons[cid] : undefined;
                  const isUnavailable = Boolean(unavailReason);
                  const isVerifiedReady = Boolean(
                    cid && hasCheckedOnce && !isUnavailable && checkedReadyIds.has(cid),
                  );

                  if (!cid) {
                    return (
                      <motion.button
                        key={`seat-empty-${idx}`}
                        layout
                        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                        whileTap={prefersReduced ? undefined : { scale: 0.97 }}
                        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                        type="button"
                        onClick={() => {
                          if (isPremiumAutoMode) setManualCustomize(true);
                          setActiveSeatIndex(idx);
                        }}
                        className="group min-h-[96px] rounded-xl border border-dashed border-slate-700/80 hover:border-blue-500/70 bg-[#0D1323]/70 hover:bg-[#111827] px-4 py-3.5 flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span className="w-8 h-8 rounded-full bg-slate-800/90 group-hover:bg-blue-600/20 border border-slate-700 group-hover:border-blue-500/50 flex items-center justify-center text-slate-300 group-hover:text-blue-300 transition-colors">
                          <Plus className="w-4 h-4" />
                        </span>
                        <span className="text-xs font-medium text-slate-400 group-hover:text-slate-200 tabular-nums">
                          {isPremiumAutoMode && autoFilling ? `Selecting Seat ${idx + 1}...` : `Seat ${idx + 1}`}
                        </span>
                      </motion.button>
                    );
                  }

                  const displayName = info?.displayName || modelId?.split('/').pop() || cid;

                  return (
                    <motion.div
                      key={`seat-filled-${idx}`}
                      layout
                      initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className={`relative min-h-[96px] rounded-xl border p-3.5 flex flex-col justify-between gap-2 transition-colors ${
                        isUnavailable
                          ? 'border-rose-500 bg-rose-950/25 animate-seat-blink-red'
                          : isVerifiedReady
                            ? 'bg-[#111827] border-emerald-500/45'
                            : 'bg-[#111827] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (isPremiumAutoMode) setManualCustomize(true);
                          setActiveSeatIndex(idx);
                        }}
                        className="text-left flex items-start gap-2.5 pr-6 min-w-0 cursor-pointer"
                      >
                        {pid && (
                          <ProviderAvatar
                            provider={pid}
                            modelId={modelId}
                            useModelLogo={duplicateModelSet.has(cid)}
                            size="sm"
                            className="mt-0.5"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-display text-sm font-semibold text-slate-100 truncate">
                            {displayName}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            <span>{cfg?.shortName || pid}</span>
                            <span aria-hidden="true"> · </span>
                            {isPremium ? (
                              <span className="text-amber-300/90">Admin Pool</span>
                            ) : (
                              <span className={isFree ? 'text-emerald-400' : 'text-amber-300/90'}>
                                {isFree ? 'Free' : 'Paid'}
                              </span>
                            )}
                          </p>
                        </div>
                      </button>

                      {!singleModelOnly && !isPremiumAutoMode && (
                        <button
                          type="button"
                          onClick={() => handleClearSeat(idx)}
                          aria-label={`Remove Seat ${idx + 1}`}
                          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-slate-800/70 transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          if (isPremiumAutoMode) setManualCustomize(true);
                          setActiveSeatIndex(idx);
                        }}
                        className="flex items-center justify-between gap-2 text-[11px] pt-1.5 border-t border-slate-800/70 cursor-pointer"
                      >
                        <span className="text-slate-500 tabular-nums">Seat {idx + 1}</span>
                        {isUnavailable ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-rose-300 truncate">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            Reselect
                          </span>
                        ) : isVerifiedReady ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            Ready
                          </span>
                        ) : (
                          <span className="text-slate-400 hover:text-slate-200">Change</span>
                        )}
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {flaggedSeatCount > 0 && (
              <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-rose-950/35 border border-rose-500/50 text-xs text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p>
                  {flaggedSeatCount === 1
                    ? '1 selected AI model is unavailable right now.'
                    : `${flaggedSeatCount} selected AI models are unavailable right now.`}{' '}
                  Tap the blinking red seat to reselect another member.
                </p>
              </div>
            )}

            {mode !== 'chat' && !singleModelOnly && filledModels.length > 0 && (
              <div className="flex items-center justify-between gap-3 pt-1 px-1">
                <label htmlFor="moderator-select" className="text-xs text-slate-400">
                  Moderator
                </label>
                <select
                  id="moderator-select"
                  value={moderatorModel}
                  onChange={(e) => setModeratorModel(e.target.value)}
                  className="min-h-[40px] px-3 py-1.5 text-xs bg-[#111827] border border-slate-800 rounded-lg text-slate-200 max-w-[260px]"
                >
                  {filledModels.map((cid) => {
                    const info = modelMap.get(cid);
                    const pid =
                      info?.provider || (cid.split(':')[0] as keyof typeof PROVIDER_REGISTRY);
                    return (
                      <option key={cid} value={cid}>
                        {PROVIDER_REGISTRY[pid]?.shortName || pid} · {info?.displayName || cid}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </section>

          {error && (
            <div className="text-xs text-rose-200 bg-rose-950/40 border border-rose-800/60 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* Footer Submit */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
            <span className="text-xs text-slate-400 tabular-nums">
              {filledModels.length} / {seatCount} seated
            </span>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className="min-h-[44px] px-4 py-2 text-xs sm:text-sm font-medium text-slate-400 hover:text-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  submitting ||
                  autoFilling ||
                  filledModels.length < minRequiredModels ||
                  flaggedSeatCount > 0
                }
                className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-45 disabled:cursor-not-allowed text-white rounded-xl transition-colors whitespace-nowrap cursor-pointer"
              >
                {submitting
                  ? 'Checking & Starting...'
                  : singleModelOnly
                    ? 'Start Chat'
                    : mode === 'chat'
                      ? 'Start Free Chat'
                      : mode === 'debate'
                        ? 'Start Debate'
                        : 'Start Discussion'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
      )}

      <SeatModelPickerModal
        open={activeSeatIndex !== null}
        seatIndex={activeSeatIndex}
        seatModels={seatModels}
        models={models}
        connections={connections}
        intelligenceLevel={intelligenceLevel}
        unavailableSet={unavailableSet}
        onSelectModel={(cid) => {
          if (activeSeatIndex !== null) {
            handleAssignSeat(activeSeatIndex, cid);
          }
        }}
        onClose={() => setActiveSeatIndex(null)}
        onNavigateConnections={() => onNavigate('connections')}
      />
    </AppShell>
  );
}
