import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Check,
  Compass,
  Crown,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  ListFilter,
  MessageSquarePlus,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  X,
} from 'lucide-react';
import { AppShellMobileMenuButton, type AppRoute } from '../AppShell';
import { useAuth } from '../../contexts/AuthContext';
import { useWorldTheme } from '../../contexts/WorldThemeContext';
import { formatContextWindow } from '../../lib/modelSelection';
import { PROVIDER_REGISTRY, type ProviderId } from '../../shared/providers';
import { WorldCanvas } from '../../three/core/WorldCanvas';
import { ModelLandWorld } from '../../three/worlds/ModelLandWorld';
import {
  buildModelLandDistricts,
  type CityModelBuildingData,
  type ModelLandLevel,
} from '../../three/worlds/modelLandData';

interface ModelLandExperienceProps {
  onNavigate: (route: AppRoute) => void;
  onStartCouncilWithSelection: (models: string[], moderatorModel?: string) => void;
  onSwitchToListView: () => void;
}

export function ModelLandExperience({
  onNavigate,
  onStartCouncilWithSelection,
  onSwitchToListView,
}: ModelLandExperienceProps) {
  const {
    isPremium,
    isAdmin,
    connections,
    models,
    usageRecords,
    connectionsLoading,
    refreshProviderState,
  } = useAuth();
  const { isDay, toggleTimeOfDay } = useWorldTheme();

  const hideModelDetails = isPremium && !isAdmin;

  const [level, setLevel] = useState<ModelLandLevel>('world');
  const [selectedCityId, setSelectedCityId] = useState<ProviderId | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [councilQueue, setCouncilQueue] = useState<string[]>([]);
  const [hudHidden, setHudHidden] = useState(false);
  const [resetCameraSeq, setResetCameraSeq] = useState(0);

  const districts = useMemo(
    () =>
      buildModelLandDistricts({
        connections,
        models,
        usageRecords,
        connectionsLoading,
        isPremium,
        hideModelDetails,
      }),
    [connections, models, usageRecords, connectionsLoading, isPremium, hideModelDetails],
  );

  const activeDistrict = useMemo(
    () =>
      districts.find((d) => d.config.providerId === selectedCityId) || districts[0] || null,
    [districts, selectedCityId],
  );

  const activeBuilding = useMemo(
    () =>
      districts
        .flatMap((d) => d.buildings)
        .find((b) => b.id === selectedBuildingId) || null,
    [districts, selectedBuildingId],
  );

  const handleSelectCity = (providerId: ProviderId) => {
    setSelectedCityId(providerId);
    setSelectedBuildingId(null);
    setLevel('city');
  };

  const handleSelectBuilding = (building: CityModelBuildingData) => {
    setSelectedCityId(building.providerId);
    setSelectedBuildingId(building.id);
    setLevel('building');
  };

  const handleStepBack = () => {
    if (level === 'building') {
      setSelectedBuildingId(null);
      setLevel('city');
    } else if (level === 'city') {
      setSelectedCityId(null);
      setSelectedBuildingId(null);
      setLevel('world');
      setResetCameraSeq((s) => s + 1);
    }
  };

  const handleLevelSwitch = (next: ModelLandLevel) => {
    if (next === 'world') {
      setSelectedCityId(null);
      setSelectedBuildingId(null);
      setLevel('world');
      setResetCameraSeq((s) => s + 1);
    } else if (next === 'city') {
      const targetCity = selectedCityId || districts[0]?.config.providerId || 'google';
      setSelectedCityId(targetCity);
      setSelectedBuildingId(null);
      setLevel('city');
    } else if (next === 'building') {
      const targetCity = selectedCityId || districts[0]?.config.providerId || 'google';
      const dist = districts.find((d) => d.config.providerId === targetCity);
      const targetBldg = selectedBuildingId || dist?.buildings[0]?.id || null;
      setSelectedCityId(targetCity);
      setSelectedBuildingId(targetBldg);
      setLevel('building');
    }
  };

  const toggleBuildingInQueue = (compositeId: string) => {
    setCouncilQueue((prev) => {
      if (prev.includes(compositeId)) {
        return prev.filter((id) => id !== compositeId);
      }
      if (prev.length >= 6) return prev;
      return [...prev, compositeId];
    });
  };

  const hudSurfaceClass = isDay
    ? 'bg-white/92 border-slate-300/85 text-slate-900 shadow-md'
    : 'bg-[#090E1A]/92 border-slate-700/80 text-slate-100 shadow-lg';

  const fallback2D = (
    <div
      className={`w-full h-full overflow-y-auto p-6 sm:p-10 ${
        isDay ? 'bg-sky-50 text-slate-900' : 'bg-[#090E1A] text-slate-100'
      }`}
    >
      <div className="max-w-4xl mx-auto pt-24 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold">AI Model Land</h2>
            <p className="text-sm opacity-75">
              3D rendering is unavailable on this device. Browse all provider cities below or switch to List Directory.
            </p>
          </div>
          <button
            type="button"
            onClick={onSwitchToListView}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold"
          >
            Open List Directory
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {districts.map((d) => (
            <div key={d.config.providerId} className={`rounded-xl border p-4 space-y-2 ${hudSurfaceClass}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-sm">{d.config.cityName}</h3>
                <span className="text-xs opacity-75">{d.statusLabel}</span>
              </div>
              <div className="space-y-1">
                {d.buildings.slice(0, 4).map((b) => (
                  <div key={b.id} className="text-xs flex items-center justify-between py-1 border-t border-slate-700/20">
                    <span>{b.displayName}</span>
                    {!b.isDemo && b.status === 'operational' && (
                      <button
                        type="button"
                        onClick={() => onStartCouncilWithSelection([b.compositeId], b.compositeId)}
                        className="text-blue-400 font-semibold"
                      >
                        Add
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const onlineCitiesCount = districts.filter((d) => d.status === 'operational').length;

  return (
    <div className="relative flex-1 w-full h-full min-h-0 overflow-hidden select-none">
      <WorldCanvas
        cameraPosition={[0, 42, 46]}
        fov={45}
        fogDensityDay={0.0034}
        fogDensityNight={0.0044}
        fallbackContent={fallback2D}
      >
        <ModelLandWorld
          districts={districts}
          level={level}
          selectedCityId={selectedCityId}
          selectedBuildingId={selectedBuildingId}
          showLabels={!hudHidden}
          isPremium={isPremium}
          resetCameraSeq={resetCameraSeq}
          onSelectCity={handleSelectCity}
          onSelectBuilding={handleSelectBuilding}
        />
      </WorldCanvas>

      {/* App Header + Segmented View Switcher */}
      <div className="pointer-events-none absolute top-0 inset-x-0 z-20 p-2.5 sm:p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          {!hudHidden ? (
            <div
              className={`pointer-events-auto flex items-center gap-2.5 px-3 py-2 rounded-2xl border backdrop-blur-md min-w-0 max-w-[66vw] sm:max-w-md ${hudSurfaceClass}`}
            >
              <AppShellMobileMenuButton />
              {level !== 'world' && (
                <button
                  type="button"
                  onClick={handleStepBack}
                  aria-label="Step back up one navigation level"
                  className="p-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/35 text-blue-400 transition-colors cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="font-display text-sm sm:text-base font-bold leading-tight truncate">
                    AI Model Land
                  </h1>
                  {isPremium && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-[10px] font-semibold text-amber-400 shrink-0">
                      <Crown className="w-2.5 h-2.5" />
                      Premium
                    </span>
                  )}
                </div>
                <p
                  className={`text-[11px] leading-tight truncate ${
                    isDay ? 'text-slate-600' : 'text-slate-300'
                  }`}
                >
                  {level === 'world'
                    ? isPremium
                      ? `All ${districts.length} provider cities connected · Premium Cloud`
                      : `${onlineCitiesCount}/${districts.length} cities active · Explore every provider`
                    : level === 'city' && activeDistrict
                      ? `${activeDistrict.config.cityName} · ${activeDistrict.statusLabel}`
                      : activeBuilding
                        ? `${activeBuilding.cityName}, Bldg ${activeBuilding.buildingNumber}`
                        : 'Explore every provider and model'}
                </p>
              </div>
            </div>
          ) : (
            <div className="pointer-events-auto">
              <AppShellMobileMenuButton className={hudSurfaceClass} />
            </div>
          )}

          {/* Right App Actions */}
          <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
            {!hudHidden && (
              <>
                <button
                  type="button"
                  disabled={connectionsLoading}
                  onClick={() => void refreshProviderState(true)}
                  title="Sync Live Providers"
                  className={`inline-flex items-center gap-1.5 min-h-[36px] px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${hudSurfaceClass}`}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-sky-400 ${
                      connectionsLoading ? 'animate-spin' : ''
                    }`}
                  />
                  <span className="hidden md:inline">Sync Live</span>
                </button>

                <button
                  type="button"
                  onClick={toggleTimeOfDay}
                  aria-label={isDay ? 'Switch to Night atmosphere' : 'Switch to Day atmosphere'}
                  className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border text-xs font-medium transition-colors cursor-pointer ${hudSurfaceClass}`}
                >
                  {isDay ? (
                    <Sun className="w-4 h-4 text-amber-500" />
                  ) : (
                    <Moon className="w-4 h-4 text-sky-400" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={onSwitchToListView}
                  title="Open 2D List Directory"
                  className={`inline-flex items-center gap-1.5 min-h-[36px] px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${hudSurfaceClass}`}
                >
                  <ListFilter className="w-3.5 h-3.5 text-blue-400" />
                  <span className="hidden sm:inline">List View</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setHudHidden((v) => !v)}
              aria-label={hudHidden ? 'Show Model Land HUD' : 'Hide HUD'}
              className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border transition-colors cursor-pointer ${hudSurfaceClass}`}
            >
              {hudHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Clean Segmented Bar: World | City | Building (matching app structure) */}
        {!hudHidden && (
          <div className="flex justify-center">
            <div
              className={`pointer-events-auto grid grid-cols-3 gap-1 p-1 rounded-2xl border w-full max-w-md ${hudSurfaceClass}`}
              role="group"
              aria-label="Model Land zoom level"
            >
              {(
                [
                  { id: 'world', label: 'World', icon: Globe },
                  { id: 'city', label: 'City', icon: Compass },
                  { id: 'building', label: 'Building', icon: Building2 },
                ] as Array<{
                  id: ModelLandLevel;
                  label: string;
                  icon: React.ComponentType<{ className?: string }>;
                }>
              ).map((item) => {
                const Icon = item.icon;
                const active = level === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleLevelSwitch(item.id)}
                    className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white shadow-sm'
                        : isDay
                          ? 'text-slate-700 hover:bg-slate-200/70'
                          : 'text-slate-300 hover:bg-slate-800/80'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Building Inspector Card (Visible in Building View) */}
      {!hudHidden && level === 'building' && activeBuilding && (
        <aside
          className={`pointer-events-auto animate-panel-enter absolute bottom-16 left-3 right-3 sm:left-auto sm:right-5 sm:bottom-20 z-30 sm:w-full sm:max-w-sm rounded-2xl border backdrop-blur-md p-4 space-y-3 ${hudSurfaceClass}`}
        >
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-sm sm:text-base font-bold truncate">
                  {activeBuilding.displayName}
                </h2>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                    activeBuilding.status === 'operational'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : activeBuilding.status === 'warning'
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                        : activeBuilding.status === 'error'
                          ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                          : 'bg-slate-700/30 border-slate-600/50 text-slate-300'
                  }`}
                >
                  {activeBuilding.statusLabel}
                </span>
              </div>
              <p className="text-[11px] opacity-75 truncate mt-0.5">
                {activeBuilding.cityName}, Building {activeBuilding.buildingNumber}
                {!hideModelDetails && (
                  <>
                    {' · '}
                    <span className="font-mono">{activeBuilding.modelId}</span>
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={handleStepBack}
              aria-label="Close building inspector"
              className="p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {activeBuilding.contextWindowTokens && (
              <span
                className={`px-2 py-0.5 rounded-md border tabular-nums ${
                  isDay
                    ? 'bg-slate-100 border-slate-300 text-slate-700'
                    : 'bg-slate-800/80 border-slate-700 text-slate-200'
                }`}
              >
                {formatContextWindow(activeBuilding.contextWindowTokens)}
              </span>
            )}
            {activeBuilding.capabilities.slice(0, 3).map((cap) => (
              <span
                key={cap}
                className={`px-2 py-0.5 rounded-md border ${
                  isDay
                    ? 'bg-slate-100 border-slate-300 text-slate-700'
                    : 'bg-slate-800/80 border-slate-700 text-slate-200'
                }`}
              >
                {cap}
              </span>
            ))}
            <span
              className={`px-2 py-0.5 rounded-md font-medium border ${
                activeBuilding.isFreeTier
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-slate-700/25 border-slate-600/40 opacity-85'
              }`}
            >
              {activeBuilding.freeTierNote}
            </span>
            {activeBuilding.isDemo && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 border border-amber-500/40 text-amber-300">
                DEMO PREVIEW
              </span>
            )}
          </div>

          <div
            className={`rounded-xl border px-3 py-2 space-y-1.5 text-xs ${
              isDay
                ? 'bg-slate-50 border-slate-200 text-slate-700'
                : 'bg-[#0C1324] border-slate-800 text-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span>Usage today</span>
              <span className="font-mono font-semibold tabular-nums text-[11px]">
                {activeBuilding.isDemo
                  ? 'Offline — connect key'
                  : `${activeBuilding.usageTokensToday.toLocaleString()} tok · ${activeBuilding.usageRequestsToday} req`}
              </span>
            </div>
            {!activeBuilding.isDemo && (
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(4, Math.round((activeBuilding.usageTokensToday / 50000) * 100)))}%`,
                  }}
                />
              </div>
            )}
          </div>

          {activeBuilding.unavailableReason && activeBuilding.status !== 'operational' && (
            <p className="text-[11px] text-amber-300 leading-snug">
              {activeBuilding.unavailableReason}
            </p>
          )}

          <div className="flex items-center gap-2">
            {hideModelDetails ? (
              <button
                type="button"
                onClick={() => onNavigate('new-council')}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[38px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                Launch Council with {activeBuilding.providerId === 'openai' ? 'ChatGPT' : PROVIDER_REGISTRY[activeBuilding.providerId].shortName}
              </button>
            ) : !activeBuilding.isDemo && activeBuilding.status === 'operational' ? (
              <>
                <button
                  type="button"
                  onClick={() => toggleBuildingInQueue(activeBuilding.compositeId)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    councilQueue.includes(activeBuilding.compositeId)
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  {councilQueue.includes(activeBuilding.compositeId) ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Added to Council
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Add to Council
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextList = councilQueue.includes(activeBuilding.compositeId)
                      ? councilQueue
                      : [...councilQueue, activeBuilding.compositeId];
                    onStartCouncilWithSelection(nextList, nextList[0]);
                  }}
                  className="min-h-[38px] px-3 py-2 rounded-xl border border-blue-500/50 text-xs font-semibold text-blue-400 hover:bg-blue-600/15 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Launch
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('connections')}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[38px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Connect {PROVIDER_REGISTRY[activeBuilding.providerId].shortName} Key
              </button>
            )}
          </div>
        </aside>
      )}

      {/* Bottom City Quick-Jump Dock & Council Launch Tray */}
      {!hudHidden && (
        <div className="pointer-events-none absolute bottom-0 inset-x-0 z-20 p-2.5 sm:p-3.5 flex flex-col items-center gap-2">
          {councilQueue.length > 0 && (
            <div
              className={`pointer-events-auto flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 rounded-2xl border max-w-2xl w-full ${hudSurfaceClass}`}
            >
              <span className="text-xs font-medium tabular-nums">
                {councilQueue.length} {councilQueue.length === 1 ? 'model' : 'models'} queued for Council
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCouncilQueue([])}
                  className="text-xs opacity-70 hover:opacity-100 px-2 py-1 cursor-pointer"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => onStartCouncilWithSelection(councilQueue, councilQueue[0])}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  Launch ({councilQueue.length})
                </button>
              </div>
            </div>
          )}

          {/* Scrollable City Selector Dock */}
          <div
            className={`pointer-events-auto flex items-center gap-1 p-1.5 rounded-2xl border overflow-x-auto max-w-full ${hudSurfaceClass}`}
          >
            <button
              type="button"
              onClick={() => handleLevelSwitch('world')}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                level === 'world'
                  ? 'bg-blue-600 text-white'
                  : isDay
                    ? 'hover:bg-slate-200/70 text-slate-700'
                    : 'hover:bg-slate-800 text-slate-200'
              }`}
            >
              All ({districts.length})
            </button>
            {districts.map((d) => {
              const active = level !== 'world' && selectedCityId === d.config.providerId;
              const isDisconnected = d.status === 'disconnected';
              const dotColor =
                d.status === 'operational'
                  ? d.config.accentHex
                  : d.status === 'warning'
                    ? '#f59e0b'
                    : d.status === 'error'
                      ? '#f43f5e'
                      : '#64748b';
              return (
                <button
                  key={d.config.providerId}
                  type="button"
                  onClick={() => handleSelectCity(d.config.providerId)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                    active
                      ? 'bg-slate-700 text-white'
                      : isDisconnected
                        ? isDay
                          ? 'text-slate-500 hover:bg-slate-200/70'
                          : 'text-slate-400 hover:bg-slate-800'
                        : isDay
                          ? 'hover:bg-slate-200/70 text-slate-800'
                          : 'hover:bg-slate-800 text-slate-100'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: dotColor }}
                  />
                  {PROVIDER_REGISTRY[d.config.providerId].shortName}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
