import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  Compass,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  MessageSquarePlus,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
  X,
} from 'lucide-react';
import { type AppRoute } from '../AppShell';
import { useAuth } from '../../contexts/AuthContext';
import { useWorldTheme } from '../../contexts/WorldThemeContext';
import { timestampToMillis } from '../../lib/firestoreService';
import { formatStatusLabel, getStatusTextClass } from '../../lib/statusLabels';
import { PROVIDER_LIST, PROVIDER_REGISTRY, type ProviderId } from '../../shared/providers';
import type { DiscussionMode } from '../../shared/types';
import { WorldCanvas } from '../../three/core/WorldCanvas';
import {
  PlaygroundWorld,
  type PlaygroundProviderPresence,
} from '../../three/worlds/PlaygroundWorld';
import { mapProviderHealthToWorldStatus } from '../../three/worlds/modelLandData';

interface PlaygroundExperienceProps {
  onNavigate: (route: AppRoute, councilId?: string) => void;
  onEnterNewCouncil: (mode: DiscussionMode) => void;
  onWorldReady?: () => void;
}

const HOLD_DURATION_MS = 1350;

function getGreetingPrefix(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function PlaygroundExperience({
  onNavigate,
  onEnterNewCouncil,
  onWorldReady,
}: PlaygroundExperienceProps) {
  const {
    user,
    profile,
    isPremium,
    isAdmin,
    councils,
    connections,
    models,
    usageRecords,
    modelWarnings,
    connectionsLoading,
  } = useAuth();
  const {
    isDay,
    toggleTimeOfDay,
    qualityTier,
    setQualityTier,
    reducedMotion,
  } = useWorldTheme();

  const [selectedMode, setSelectedMode] = useState<DiscussionMode>('chat');
  const [gatheringPhase, setGatheringPhase] = useState<
    'idle' | 'charging' | 'gathering' | 'entered'
  >('idle');
  const [holdProgress, setHoldProgress] = useState(0);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [hudHidden, setHudHidden] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef<number>(0);
  const navigatedRef = useRef(false);

  const isAuthenticated = Boolean(user && user.emailVerified);

  const firstName = useMemo(() => {
    const raw =
      profile?.displayName ||
      user?.displayName ||
      user?.email?.split('@')[0] ||
      'Explorer';
    return raw.split(/\s+/)[0];
  }, [profile?.displayName, user?.displayName, user?.email]);

  const providerPresence: PlaygroundProviderPresence[] = useMemo(() => {
    const connMap = new Map(connections.map((c) => [c.providerId, c]));
    return PROVIDER_LIST.map((cfg) => {
      const conn = connMap.get(cfg.id);
      const mapped = mapProviderHealthToWorldStatus(conn, connectionsLoading);
      const count = models.filter((m) => m.provider === cfg.id && m.available).length;
      return {
        providerId: cfg.id,
        name: cfg.name,
        shortName: cfg.shortName,
        status: mapped.status,
        modelsCount: count,
        statusDetail:
          mapped.status === 'operational'
            ? `${count || conn?.discoveredModelsCount || 0} models ready`
            : mapped.label,
      };
    });
  }, [connections, models, connectionsLoading]);

  const operationalProviders = useMemo(
    () => providerPresence.filter((p) => p.status === 'operational'),
    [providerPresence],
  );

  const activeCouncils = useMemo(() => councils.filter((c) => !c.archived), [councils]);
  const usableModelsCount = useMemo(
    () =>
      models.filter(
        (m) =>
          m.available &&
          (m.availabilityState === 'inference_ready' || m.availabilityState === 'verified'),
      ).length,
    [models],
  );
  const totalTokens = useMemo(
    () =>
      usageRecords.reduce((sum, r) => sum + (r.inputTokens || 0) + (r.outputTokens || 0), 0),
    [usageRecords],
  );

  const stopHoldLoop = useCallback(() => {
    if (holdRafRef.current !== null) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
  }, []);

  useEffect(() => () => stopHoldLoop(), [stopHoldLoop]);

  const triggerGatheringSequence = useCallback(() => {
    stopHoldLoop();
    navigatedRef.current = false;
    setHoldProgress(1);
    setGatheringPhase('gathering');
  }, [stopHoldLoop]);

  const startHold = useCallback(() => {
    if (gatheringPhase === 'gathering' || gatheringPhase === 'entered') return;
    stopHoldLoop();
    setGatheringPhase('charging');
    holdStartRef.current = performance.now();

    const step = (now: number) => {
      const elapsed = now - holdStartRef.current;
      const pct = Math.min(1, elapsed / (reducedMotion ? 350 : HOLD_DURATION_MS));
      setHoldProgress(pct);
      if (pct >= 1) {
        triggerGatheringSequence();
        return;
      }
      holdRafRef.current = requestAnimationFrame(step);
    };
    holdRafRef.current = requestAnimationFrame(step);
  }, [gatheringPhase, stopHoldLoop, reducedMotion, triggerGatheringSequence]);

  const handlePointerUpPortal = useCallback(() => {
    if (gatheringPhase === 'gathering' || gatheringPhase === 'entered') return;
    const elapsed = performance.now() - holdStartRef.current;
    if (gatheringPhase === 'charging' && elapsed < 260) {
      triggerGatheringSequence();
      return;
    }
    stopHoldLoop();
    setHoldProgress(0);
    setGatheringPhase('idle');
  }, [gatheringPhase, stopHoldLoop, triggerGatheringSequence]);

  const cancelHold = useCallback(() => {
    if (gatheringPhase === 'gathering' || gatheringPhase === 'entered') return;
    stopHoldLoop();
    setHoldProgress(0);
    setGatheringPhase('idle');
  }, [gatheringPhase, stopHoldLoop]);

  const handleAllCharactersEntered = useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    setGatheringPhase('entered');
    window.setTimeout(() => {
      if (!isAuthenticated) {
        onNavigate('auth');
      } else {
        onEnterNewCouncil(selectedMode);
      }
    }, reducedMotion ? 80 : 320);
  }, [isAuthenticated, onEnterNewCouncil, onNavigate, selectedMode, reducedMotion]);

  const selectedCharacterInfo = useMemo(() => {
    if (!selectedCharacterId) return null;
    if (selectedCharacterId === 'nova') {
      return {
        title: 'T.U.T AI Nova',
        subtitle:
          operationalProviders.length > 0
            ? `${operationalProviders.length} AI ${
                operationalProviders.length === 1 ? 'provider is' : 'providers are'
              } awake and ready to enter the Council.`
            : 'No AI provider keys are connected yet. Connect a provider or enter New Council anytime.',
        isConnected: true,
      };
    }
    const prov = providerPresence.find((p) => p.providerId === selectedCharacterId);
    if (!prov) return null;
    return {
      title: prov.name,
      subtitle:
        prov.status === 'operational'
          ? `${prov.statusDetail} · Click Model Land to inspect buildings.`
          : prov.status === 'disconnected'
            ? 'Not configured yet · Add your API key in Connections to awaken this AI.'
            : `${prov.statusDetail} · Check Connections to resolve.`,
      isConnected: prov.status === 'operational',
    };
  }, [selectedCharacterId, operationalProviders.length, providerPresence]);

  const hideModelDetails = isPremium && !isAdmin;

  const novaSubtitle = useMemo(() => {
    if (gatheringPhase === 'gathering' || gatheringPhase === 'entered') {
      return 'Portal open · Gathering Council...';
    }
    if (gatheringPhase === 'charging') {
      return 'Hold to awaken Council Portal...';
    }
    if (!isAuthenticated) {
      return 'Sign in & connect a key to start';
    }
    if (connectionsLoading) {
      return 'Syncing live providers...';
    }
    if (hideModelDetails) {
      return `Premium Cloud · ${operationalProviders.length} providers ready`;
    }
    if (operationalProviders.length > 0) {
      return `${operationalProviders.length} AI ${
        operationalProviders.length === 1 ? 'provider' : 'providers'
      } ready · ${usableModelsCount} models`;
    }
    return 'Connect a key to awaken your AI team';
  }, [
    gatheringPhase,
    isAuthenticated,
    connectionsLoading,
    hideModelDetails,
    operationalProviders.length,
    usableModelsCount,
  ]);

  const holdCircumference = 2 * Math.PI * 24;
  const holdDashOffset = holdCircumference * (1 - holdProgress);

  const hudSurfaceClass = isDay
    ? 'bg-white/88 backdrop-blur-md border-slate-300/80 text-slate-900 shadow-lg'
    : 'bg-[#090E1A]/86 backdrop-blur-md border-slate-700/75 text-slate-100 shadow-xl';

  const fallback2D = (
    <div
      className={`w-full h-full flex flex-col justify-between p-6 sm:p-10 overflow-y-auto ${
        isDay
          ? 'bg-gradient-to-b from-sky-100 via-sky-50 to-emerald-50 text-slate-900'
          : 'bg-gradient-to-b from-[#070b18] via-[#0d1630] to-[#090E1A] text-slate-100'
      }`}
    >
      <div className="max-w-3xl mx-auto w-full space-y-6 pt-16 pb-24">
        <div className={`rounded-2xl border p-6 space-y-3 ${hudSurfaceClass}`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
            AI Sanctuary (2D Accessible Mode)
          </p>
          <h2 className="font-display text-2xl font-bold">
            {getGreetingPrefix()}, {firstName}
          </h2>
          <p className="text-sm opacity-80">{novaSubtitle}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            {providerPresence.map((p) => (
              <span
                key={p.providerId}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700/40 bg-slate-800/30"
              >
                {p.shortName}: {p.statusDetail}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 pt-3">
            <button
              type="button"
              onClick={() => onEnterNewCouncil(selectedMode)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
            >
              <MessageSquarePlus className="w-4 h-4" />
              Enter New Council
            </button>
            <button
              type="button"
              onClick={() => onNavigate('models')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-600/50 text-sm font-medium"
            >
              <Compass className="w-4 h-4" />
              Explore Model Land
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative flex-1 w-full h-full min-h-0 overflow-hidden select-none">
      {/* Real-Time 3D Living Playground World */}
      <WorldCanvas
        cameraPosition={[0, 8.6, 15.8]}
        fov={44}
        fogDensityDay={0.009}
        fogDensityNight={0.012}
        onSceneReady={onWorldReady}
        fallbackContent={fallback2D}
      >
        <PlaygroundWorld
          providers={providerPresence}
          gatheringPhase={gatheringPhase}
          holdProgress={holdProgress}
          selectedCharacterId={selectedCharacterId}
          showLabels={!hudHidden}
          onSelectCharacter={(id) =>
            setSelectedCharacterId((prev) => (prev === id ? null : id))
          }
          onPortalPointerDown={startHold}
          onPortalPointerUpOrLeave={cancelHold}
          onAllCharactersEntered={handleAllCharactersEntered}
        />
      </WorldCanvas>

      {/* Top HUD Bar */}
      <div className="pointer-events-none absolute top-0 inset-x-0 z-20 p-2.5 sm:p-4 flex items-center justify-between gap-2">
        {/* Left Greeting + Nova Status */}
        {!hudHidden ? (
          <div
            className={`pointer-events-auto flex items-center gap-2.5 px-3 py-2 rounded-2xl border ${hudSurfaceClass} min-w-0 max-w-[calc(100vw-9.5rem)] sm:max-w-md`}
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-400/25 via-indigo-500/25 to-violet-500/35 border border-sky-400/45 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-sky-400" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-[13px] sm:text-base font-bold truncate leading-tight">
                {getGreetingPrefix()}, {firstName}
              </h1>
              <p
                className={`text-[11px] truncate leading-tight mt-0.5 ${
                  isDay ? 'text-slate-600' : 'text-slate-300'
                }`}
              >
                {novaSubtitle}
              </p>
            </div>
          </div>
        ) : (
          <div />
        )}

        {/* Right Controls: Day/Night, Quality, Workspace, Zen Toggle */}
        <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
          {!hudHidden && (
            <>
              <button
                type="button"
                onClick={toggleTimeOfDay}
                aria-label={isDay ? 'Switch to Night atmosphere' : 'Switch to Day atmosphere'}
                className={`inline-flex items-center justify-center sm:w-auto sm:px-3 gap-1.5 w-10 h-10 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${hudSurfaceClass}`}
              >
                {isDay ? (
                  <>
                    <Sun className="w-4 h-4 text-amber-500" />
                    <span className="hidden sm:inline">Day</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-4 h-4 text-sky-400" />
                    <span className="hidden sm:inline">Night</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  setQualityTier(
                    qualityTier === 'high'
                      ? 'balanced'
                      : qualityTier === 'balanced'
                        ? 'lite'
                        : 'high',
                  )
                }
                title="Cycle 3D rendering quality (High / Balanced / Lite)"
                className={`hidden md:inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${hudSurfaceClass}`}
              >
                <span className="capitalize">{qualityTier} 3D</span>
              </button>

              <button
                type="button"
                onClick={() => setDrawerOpen((v) => !v)}
                aria-label="Open workspace overview and notifications"
                className={`relative inline-flex items-center justify-center gap-1.5 w-10 h-10 sm:w-auto sm:px-3 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${hudSurfaceClass}`}
              >
                <Bell className="w-4 h-4 text-blue-400" />
                <span className="hidden sm:inline">Workspace</span>
                {modelWarnings.length > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                )}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setHudHidden((v) => !v)}
            aria-label={hudHidden ? 'Show world controls' : 'Hide HUD for scenic view'}
            className={`inline-flex items-center justify-center w-10 h-10 rounded-xl border transition-colors cursor-pointer ${hudSurfaceClass}`}
          >
            {hudHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Selected Character Mini Tooltip Card */}
      {!hudHidden && selectedCharacterInfo && gatheringPhase === 'idle' && (
        <div
          className={`pointer-events-auto animate-panel-enter absolute top-20 left-3 sm:left-5 z-20 max-w-xs rounded-xl border p-3.5 ${hudSurfaceClass}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-display text-xs font-bold">{selectedCharacterInfo.title}</p>
              <p
                className={`text-[11px] mt-0.5 leading-snug ${
                  isDay ? 'text-slate-600' : 'text-slate-300'
                }`}
              >
                {selectedCharacterInfo.subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedCharacterId(null)}
              aria-label="Dismiss character info"
              className="p-1 opacity-60 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {!selectedCharacterInfo.isConnected && (
            <button
              type="button"
              onClick={() => onNavigate('connections')}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 hover:text-blue-300"
            >
              <KeyRound className="w-3 h-3" />
              Open Connections
            </button>
          )}
        </div>
      )}

      {/* Collapsible Workspace Summary & Recent Councils Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative z-10 w-full max-w-md h-full bg-[#0C1222] border-l border-slate-800 text-slate-100 p-5 overflow-y-auto space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="font-display text-base font-bold">Workspace Overview</h2>
                <p className="text-xs text-slate-400">Live account status & recent rooms</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-2 text-slate-400 hover:text-white rounded-lg"
                aria-label="Close workspace drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!isAuthenticated && (
              <div className="rounded-xl border border-blue-500/40 bg-blue-950/35 p-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">Sign in to connect API keys</p>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Save your Council rooms, presets, and encrypted keys.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    onNavigate('auth');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Sign In
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setDrawerOpen(false);
                onNavigate('premium');
              }}
              className="w-full rounded-xl border border-amber-500/35 bg-amber-950/20 hover:bg-amber-950/35 px-3.5 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Crown className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  {isAdmin
                    ? 'Admin Workspace · Premium'
                    : isPremium
                      ? 'Council Premium Active'
                      : 'Upgrade to Council Premium (29৳)'}
                </span>
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            </button>

            {isAuthenticated && (
              <div className={`grid ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    onNavigate('portal');
                  }}
                  className="rounded-xl border border-slate-800 bg-[#111827] hover:bg-slate-800/70 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-medium text-slate-100 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2 truncate">
                    <UserRound className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="truncate">User Portal</span>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      onNavigate('admin');
                    }}
                    className="rounded-xl border border-amber-500/35 bg-[#121A2F] hover:bg-amber-950/40 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-amber-300 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="truncate">Admin Portal</span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-3.5">
                <p className="text-[11px] text-slate-400">Active Councils</p>
                <p className="font-display text-xl font-bold mt-1 tabular-nums">
                  {activeCouncils.length}
                </p>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-3.5">
                <p className="text-[11px] text-slate-400">
                  {hideModelDetails ? 'Cloud Access' : 'Ready Models'}
                </p>
                <p className="font-display text-xl font-bold mt-1 tabular-nums">
                  {connectionsLoading
                    ? '—'
                    : hideModelDetails
                      ? 'Auto Pool'
                      : usableModelsCount}
                </p>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-3.5">
                <p className="text-[11px] text-slate-400">Online Providers</p>
                <p className="font-display text-xl font-bold mt-1 tabular-nums">
                  {operationalProviders.length} / {PROVIDER_LIST.length}
                </p>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-3.5">
                <p className="text-[11px] text-slate-400">Recorded Tokens</p>
                <p className="font-display text-xl font-bold mt-1 tabular-nums">
                  {totalTokens.toLocaleString()}
                </p>
              </div>
            </div>

            {modelWarnings.length > 0 && (
              <div className="bg-amber-950/35 border border-amber-700/60 rounded-xl p-3.5 text-xs text-amber-200 space-y-1.5">
                <p className="font-semibold flex items-center gap-1.5 text-amber-100">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  Provider Attention Needed
                </p>
                {modelWarnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300">Provider Health</h3>
                <button
                  type="button"
                  onClick={() => onNavigate('connections')}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Manage Keys
                </button>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl divide-y divide-slate-800/70">
                {connections.map((conn) => {
                  const effective =
                    conn.status === 'disconnected' ? 'disconnected' : conn.healthState;
                  return (
                    <div
                      key={conn.providerId}
                      className="px-3.5 py-2.5 flex items-center justify-between text-xs"
                    >
                      <span className="font-medium text-slate-200">
                        {PROVIDER_REGISTRY[conn.providerId]?.name || conn.providerName}
                      </span>
                      <span className={getStatusTextClass(effective)}>
                        {formatStatusLabel(effective)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300">Recent Council Rooms</h3>
                <button
                  type="button"
                  onClick={() => onNavigate('history')}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Chat History
                </button>
              </div>
              {activeCouncils.length === 0 ? (
                <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 text-xs text-slate-400 text-center">
                  No Council Rooms yet. Hold the Portal to gather your first AI Council!
                </div>
              ) : (
                <div className="bg-[#111827] border border-slate-800 rounded-xl divide-y divide-slate-800/70">
                  {activeCouncils.slice(0, 6).map((c) => {
                    const ms = timestampToMillis(c.updatedAt);
                    const dateStr = ms
                      ? new Date(ms).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Recent';
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onNavigate('council-room', c.id)}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-100 truncate">{c.title}</p>
                          <p className="text-[11px] text-slate-400">
                            {c.selectedModels.length} models · {dateStr}
                          </p>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Bottom Interactive Dock: Unified Portal CTA + Council Modes */}
      {!hudHidden && (
        <div className="pointer-events-none absolute bottom-0 inset-x-0 z-20 px-2.5 pb-2.5 pt-2 sm:p-4 flex flex-col items-center gap-2">
          <div className="pointer-events-auto flex flex-col items-center gap-1.5 w-full max-w-md">
            <div
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-xl border text-[11px] font-medium ${hudSurfaceClass}`}
            >
              <span
                className={`px-1.5 py-0.5 rounded-md font-semibold tabular-nums ${
                  operationalProviders.length > 0
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-slate-700/40 text-slate-300'
                }`}
              >
                {operationalProviders.length} online
              </span>
              <span className={isDay ? 'text-slate-600' : 'text-slate-300'}>
                Tap or hold the portal to gather your council
              </span>
            </div>

            <button
              type="button"
              onPointerDown={startHold}
              onPointerUp={handlePointerUpPortal}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  triggerGatheringSequence();
                }
              }}
              disabled={gatheringPhase === 'gathering' || gatheringPhase === 'entered'}
              aria-label="Tap or press and hold to gather your AI Council and open New Council"
              className={`relative inline-flex items-center gap-2.5 min-h-[52px] pl-2 pr-5 py-1.5 rounded-2xl border font-display font-semibold text-sm transition-transform active:scale-[0.98] cursor-pointer whitespace-nowrap shadow-lg ${
                gatheringPhase === 'gathering' || gatheringPhase === 'entered'
                  ? 'bg-violet-600 border-violet-400 text-white'
                  : gatheringPhase === 'charging'
                    ? 'bg-blue-600 border-sky-300 text-white'
                    : 'bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 border-blue-400/50 text-white'
              }`}
            >
              <span className="relative w-10 h-10 flex items-center justify-center shrink-0">
                <svg className="w-10 h-10 -rotate-90" viewBox="0 0 56 56" aria-hidden="true">
                  <circle
                    cx="28"
                    cy="28"
                    r="24"
                    fill="none"
                    stroke="rgba(255,255,255,0.22)"
                    strokeWidth="3.5"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r="24"
                    fill="none"
                    stroke="#67e8f9"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray={holdCircumference}
                    strokeDashoffset={
                      gatheringPhase === 'gathering' || gatheringPhase === 'entered'
                        ? 0
                        : holdDashOffset
                    }
                  />
                </svg>
                <MessageSquarePlus className="w-4 h-4 absolute text-white" />
              </span>

              <span className="text-left">
                <span className="block leading-tight text-sm">
                  {gatheringPhase === 'gathering' || gatheringPhase === 'entered'
                    ? 'Gathering Council...'
                    : gatheringPhase === 'charging'
                      ? `Awakening Portal ${Math.round(holdProgress * 100)}%`
                      : '+ New Council'}
                </span>
                <span className="block text-[10px] font-normal text-blue-100/90">
                  {gatheringPhase === 'charging' ? 'Release now to launch' : 'Tap or press & hold'}
                </span>
              </span>
            </button>
          </div>

          {/* Council Modes Strip */}
          <div
            className={`pointer-events-auto rounded-2xl border px-3 py-1.5 flex items-center justify-between gap-2 max-w-md w-full ${hudSurfaceClass}`}
          >
            <span className="text-[11px] font-semibold opacity-75 whitespace-nowrap">
              Modes
            </span>
            <div className="flex items-center gap-1 overflow-x-auto">
              {(
                [
                  { id: 'chat', label: 'Free Chat' },
                  { id: 'free', label: 'Discussion' },
                  { id: 'debate', label: 'Debate' },
                ] as Array<{ id: DiscussionMode; label: string }>
              ).map((m) => {
                const active = selectedMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={gatheringPhase === 'gathering' || gatheringPhase === 'entered'}
                    onClick={() => setSelectedMode(m.id)}
                    className={`min-h-[36px] px-2.5 py-1 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white'
                        : isDay
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                          : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
