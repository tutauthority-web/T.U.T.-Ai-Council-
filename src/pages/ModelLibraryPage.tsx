import { lazy, Suspense, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Globe,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import {
  getDuplicateProviderCompositeSet,
  ProviderAvatar,
} from '../components/ProviderBadge';
import { useAuth } from '../contexts/AuthContext';
import { createModelPreset, deleteModelPreset } from '../lib/firestoreService';
import {
  formatContextWindow,
  isModelSelectableClient,
  pickQuickMixIds,
  sortModelsForPicker,
  type ModelAccessFilter,
  type ModelSortOption,
} from '../lib/modelSelection';
import { formatStatusLabel, getStatusTextClass } from '../lib/statusLabels';
import {
  getModelAccessLabel,
  isModelFreeTier,
  PROVIDER_IDS,
  PROVIDER_REGISTRY,
} from '../shared/providers';
import type { IntelligenceLevel, ProviderId } from '../shared/types';

const ModelLandExperience = lazy(() =>
  import('../components/world/ModelLandExperience').then((mod) => ({
    default: mod.ModelLandExperience,
  })),
);

export function ModelLibraryPage({
  onNavigate,
  onStartCouncilWithSelection,
}: {
  onNavigate: (route: AppRoute) => void;
  onStartCouncilWithSelection: (models: string[], moderatorModel?: string) => void;
}) {
  const {
    user,
    models,
    presets,
    discoveryErrors,
    modelWarnings,
    connectionsLoading,
    refreshProviderState,
  } = useAuth();
  const [viewMode, setViewMode] = useState<'3d' | 'list'>('3d');
  const [search, setSearch] = useState('');
  const [accessFilter, setAccessFilter] = useState<ModelAccessFilter>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | ProviderId>('all');
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available'>('available');
  const [tierFilter, setTierFilter] = useState<'all' | IntelligenceLevel>('all');
  const [sortBy, setSortBy] = useState<ModelSortOption>('recommended');
  const [selected, setSelected] = useState<string[]>([]);
  const [presetName, setPresetName] = useState('');
  const [presetDesc, setPresetDesc] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const modelMap = useMemo(
    () => new Map(models.map((m) => [m.compositeId, m])),
    [models],
  );
  const duplicateSelectedSet = useMemo(
    () => getDuplicateProviderCompositeSet(selected),
    [selected],
  );
  const readyModelsCount = useMemo(
    () => models.filter(isModelSelectableClient).length,
    [models],
  );
  const canLaunchSingleModel = readyModelsCount === 1 && selected.length === 1;
  const canLaunch = selected.length >= 2 || canLaunchSingleModel;

  const availabilityScopedModels = useMemo(
    () =>
      availabilityFilter === 'available'
        ? models.filter(isModelSelectableClient)
        : models,
    [models, availabilityFilter],
  );

  const freeModelsCount = useMemo(
    () => availabilityScopedModels.filter((m) => isModelFreeTier(m)).length,
    [availabilityScopedModels],
  );
  const paidModelsCount = useMemo(
    () => availabilityScopedModels.filter((m) => !isModelFreeTier(m)).length,
    [availabilityScopedModels],
  );

  const accessScopedModels = useMemo(() => {
    return availabilityScopedModels.filter((m) => {
      if (accessFilter === 'free') return isModelFreeTier(m);
      if (accessFilter === 'paid') return !isModelFreeTier(m);
      return true;
    });
  }, [availabilityScopedModels, accessFilter]);

  const providerCounts = useMemo(() => {
    const map = new Map<ProviderId, number>();
    for (const m of accessScopedModels) {
      map.set(m.provider, (map.get(m.provider) || 0) + 1);
    }
    return map;
  }, [accessScopedModels]);

  const visibleProviders = useMemo(
    () => PROVIDER_IDS.filter((pid) => (providerCounts.get(pid) || 0) > 0 || providerFilter === pid),
    [providerCounts, providerFilter],
  );

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = accessScopedModels.filter((m) => {
      if (providerFilter !== 'all' && m.provider !== providerFilter) return false;
      if (tierFilter !== 'all' && (m.tier || 'medium') !== tierFilter) return false;
      if (!q) return true;
      const pName = PROVIDER_REGISTRY[m.provider]?.name.toLowerCase() || m.provider;
      const accessLabel = getModelAccessLabel(m).toLowerCase();
      return (
        m.modelId.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        pName.includes(q) ||
        accessLabel.includes(q) ||
        m.capabilities.some((c) => c.toLowerCase().includes(q))
      );
    });
    return sortModelsForPicker(filtered, sortBy);
  }, [accessScopedModels, providerFilter, tierFilter, search, sortBy]);

  const readyFreeMix = useMemo(
    () => pickQuickMixIds(models, 'best_free', 4),
    [models],
  );
  const fastFreeMix = useMemo(
    () => pickQuickMixIds(models, 'fast_free', 3),
    [models],
  );

  const toggleSelect = (compositeId: string) => {
    setSelected((prev) => {
      if (prev.includes(compositeId)) {
        return prev.filter((id) => id !== compositeId);
      }
      if (prev.length >= 6) {
        setFeedback('You can select up to 6 models per Council.');
        return prev;
      }
      setFeedback(null);
      return [...prev, compositeId];
    });
  };

  const handleSavePreset = async () => {
    if (!user) return;
    if (selected.length < 2) {
      setFeedback('Select at least 2 models to save a preset.');
      return;
    }
    if (!presetName.trim()) {
      setFeedback('Provide a preset name.');
      return;
    }
    setSavingPreset(true);
    setFeedback(null);
    try {
      await createModelPreset(user.uid, {
        name: presetName.trim(),
        description: presetDesc.trim() || undefined,
        models: selected,
        moderatorModel: selected[0],
      });
      setPresetName('');
      setPresetDesc('');
      setFeedback('Preset saved to your account.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPreset(false);
    }
  };

  if (viewMode === '3d') {
    return (
      <AppShell
        currentRoute="models"
        pageTitle="AI Model Land"
        breadcrumb="Universe"
        onNavigate={onNavigate}
        fullBleed
        hideTopBar
      >
        <Suspense
          fallback={
            <div className="w-full h-full bg-[#090E1A] text-slate-300 flex flex-col items-center justify-center gap-2 text-sm">
              <span className="font-display font-semibold text-slate-100">
                Charting AI Model Land...
              </span>
              <span className="text-xs text-slate-400">
                Generating provider islands and live model cities
              </span>
            </div>
          }
        >
          <ModelLandExperience
            onNavigate={onNavigate}
            onStartCouncilWithSelection={onStartCouncilWithSelection}
            onSwitchToListView={() => setViewMode('list')}
          />
        </Suspense>
      </AppShell>
    );
  }

  return (
    <AppShell
      currentRoute="models"
      pageTitle="Model Directory"
      breadcrumb="AI Model Land"
      onNavigate={onNavigate}
      primaryAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('3d')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium bg-[#111827] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Globe className="w-4 h-4 text-sky-400" />
            3D Model Land
          </button>
          <button
            type="button"
            disabled={!canLaunch}
            onClick={() => onStartCouncilWithSelection(selected, selected[0])}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquarePlus className="w-4 h-4" />
            {canLaunchSingleModel
              ? 'Single Model Chat (1)'
              : `Launch Council (${selected.length})`}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Provider Health / Credit Warnings & Discovery Errors */}
        {(modelWarnings.length > 0 || Object.keys(discoveryErrors).length > 0) && (
          <div className="bg-amber-950/30 border border-amber-800/60 rounded-xl p-4 text-xs text-amber-200 space-y-1.5">
            {modelWarnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            {Object.entries(discoveryErrors).map(([pid, msg]) => (
              <p key={pid}>
                Discovery issue for {pid}: {msg}
              </p>
            ))}
          </div>
        )}

        {/* Selected & Quick Picks Strip */}
        <section className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100 tabular-nums">
                Selected Models ({selected.length} / 6)
              </h2>
              <p className="text-xs text-slate-400">
                {selected.length === 0
                  ? readyModelsCount === 1
                    ? 'Only 1 usable model is currently available — select it to start Single Model Chat.'
                    : 'Pick 2 or more models below, or use a 1-click free mix.'
                  : 'Click any selected item to remove it before launching.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {readyFreeMix.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAvailabilityFilter('available');
                    setAccessFilter('free');
                    setProviderFilter('all');
                    setSelected(readyFreeMix);
                    setFeedback(null);
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1.5 text-xs font-medium bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-700/60 text-emerald-200 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  Best Free Mix ({readyFreeMix.length})
                </button>
              )}
              {fastFreeMix.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAvailabilityFilter('available');
                    setAccessFilter('free');
                    setProviderFilter('all');
                    setSelected(fastFreeMix);
                    setFeedback(null);
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1.5 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  Fast Free ({fastFreeMix.length})
                </button>
              )}
              <button
                type="button"
                disabled={connectionsLoading}
                onClick={() => void refreshProviderState(true)}
                className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1.5 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${connectionsLoading ? 'animate-spin' : ''}`} />
                Refresh Live
              </button>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="text-xs text-slate-400 hover:text-rose-300 px-1.5"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((cid) => {
                const info = modelMap.get(cid);
                const pid = info?.provider || (cid.split(':')[0] as ProviderId);
                const cfg = PROVIDER_REGISTRY[pid];
                const isFree = info ? isModelFreeTier(info) : false;
                return (
                  <button
                    key={cid}
                    type="button"
                    onClick={() => toggleSelect(cid)}
                    className="inline-flex items-center gap-2 min-h-[36px] pl-2.5 pr-2 py-1 text-xs bg-[#090E1A] hover:bg-slate-800 border border-slate-700 hover:border-rose-500/60 rounded-lg text-slate-100 transition-colors max-w-full"
                  >
                    <ProviderAvatar
                      provider={pid}
                      modelId={info?.modelId || cid.split(':').slice(1).join(':')}
                      useModelLogo={duplicateSelectedSet.has(cid)}
                      size="micro"
                    />
                    <span className={`font-medium shrink-0 ${cfg?.textClass || 'text-blue-400'}`}>
                      {cfg?.shortName || pid}
                    </span>
                    <span className="truncate max-w-[200px] font-mono text-[11px] text-slate-200">
                      {info?.displayName || cid}
                    </span>
                    {isFree && (
                      <span className="text-[10px] font-semibold text-emerald-400 shrink-0">
                        FREE
                      </span>
                    )}
                    <X className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-slate-800/80">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name (e.g. Free Multi-Provider Panel)"
              className="flex-1 px-3 py-2 text-xs bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <input
              type="text"
              value={presetDesc}
              onChange={(e) => setPresetDesc(e.target.value)}
              placeholder="Optional description..."
              className="flex-1 px-3 py-2 text-xs bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              disabled={savingPreset || selected.length < 2}
              onClick={() => void handleSavePreset()}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 rounded-lg transition-colors whitespace-nowrap"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              Save Preset
            </button>
          </div>
          {feedback && <p className="text-xs text-blue-300">{feedback}</p>}
        </section>

        {/* Smart Filters Toolbar */}
        <section className="bg-[#111827] border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models, OpenRouter, Groq, capabilities..."
                className="w-full min-h-[40px] pl-10 pr-9 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Smart Access / Subscription Filter */}
              <div className="flex items-center gap-1 p-1 bg-[#090E1A] border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setAccessFilter('all')}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
                    accessFilter === 'all'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All ({availabilityScopedModels.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAccessFilter('free')}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
                    accessFilter === 'free'
                      ? 'bg-emerald-600 text-white'
                      : 'text-emerald-300/90 hover:text-emerald-200'
                  }`}
                >
                  Free · No Sub ({freeModelsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setAccessFilter('paid')}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
                    accessFilter === 'paid'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Paid API ({paidModelsCount})
                </button>
              </div>

              <div className="flex items-center gap-1 p-1 bg-[#090E1A] border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setAvailabilityFilter('available')}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    availabilityFilter === 'available'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Ready Only
                </button>
                <button
                  type="button"
                  onClick={() => setAvailabilityFilter('all')}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    availabilityFilter === 'all'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Catalog
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-800/80">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setProviderFilter('all')}
                className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap tabular-nums shrink-0 ${
                  providerFilter === 'all'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-[#090E1A] border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                All Providers ({accessScopedModels.length})
              </button>
              {visibleProviders.map((pid) => {
                const cfg = PROVIDER_REGISTRY[pid];
                const count = providerCounts.get(pid) || 0;
                const active = providerFilter === pid;
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => setProviderFilter(pid)}
                    className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap tabular-nums shrink-0 ${
                      active
                        ? 'bg-slate-800 border-slate-600 text-white'
                        : 'bg-[#090E1A] border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className={active ? 'text-white' : cfg.textClass}>{cfg.shortName}</span>{' '}
                    <span className="text-slate-400">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <select
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value as 'all' | IntelligenceLevel)}
                aria-label="Filter by intelligence tier"
                className="min-h-[34px] px-2.5 py-1 text-xs bg-[#090E1A] border border-slate-800 rounded-md text-slate-200"
              >
                <option value="all">All Tiers</option>
                <option value="low">Low Tier</option>
                <option value="medium">Medium Tier</option>
                <option value="high">High Tier</option>
                <option value="extreme">Extreme Tier</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as ModelSortOption)}
                aria-label="Sort models"
                className="min-h-[34px] px-2.5 py-1 text-xs bg-[#090E1A] border border-slate-800 rounded-md text-slate-200"
              >
                <option value="recommended">Sort: Recommended</option>
                <option value="free_first">Sort: Free First</option>
                <option value="context">Sort: Context Size</option>
                <option value="alpha">Sort: Name A–Z</option>
              </select>
            </div>
          </div>
        </section>

        {/* Saved Presets */}
        {presets.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-display text-sm font-semibold text-slate-200">
              Saved Model Presets
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-sm font-semibold text-slate-100">
                        {preset.name}
                      </h3>
                      <button
                        type="button"
                        onClick={() => user && void deleteModelPreset(user.uid, preset.id)}
                        className="text-slate-500 hover:text-rose-400 transition-colors"
                        aria-label={`Delete preset ${preset.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {preset.description && (
                      <p className="text-xs text-slate-400">{preset.description}</p>
                    )}
                    <p className="text-xs font-mono text-slate-400 pt-1 break-words">
                      {preset.models.join(', ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => {
                        const readySet = new Set(
                          models.filter(isModelSelectableClient).map((m) => m.compositeId),
                        );
                        const usable = preset.models.filter((id) => readySet.has(id));
                        setSelected(usable);
                        if (usable.length < preset.models.length) {
                          setFeedback(
                            `Loaded ${usable.length} of ${preset.models.length} preset models (unavailable models excluded).`,
                          );
                        } else {
                          setFeedback(null);
                        }
                      }}
                      className="text-xs font-medium text-slate-300 hover:text-white"
                    >
                      Load Selection
                    </button>
                    <span className="text-slate-700" aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => {
                        const readySet = new Set(
                          models.filter(isModelSelectableClient).map((m) => m.compositeId),
                        );
                        const usable = preset.models.filter((id) => readySet.has(id));
                        onStartCouncilWithSelection(
                          usable,
                          readySet.has(preset.moderatorModel) ? preset.moderatorModel : usable[0],
                        );
                      }}
                      className="text-xs font-medium text-blue-400 hover:text-blue-300"
                    >
                      Launch Council
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Model Directory Table / List */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="tabular-nums">
              Showing {filteredModels.length} models ({filteredModels.filter((m) => m.available).length} ready ·{' '}
              {filteredModels.filter((m) => isModelFreeTier(m)).length} free no-sub)
            </span>
            <span>Availability reflects live provider discovery and current account health</span>
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80">
            {filteredModels.map((m) => {
              const isSelected = selected.includes(m.compositeId);
              const cfg = PROVIDER_REGISTRY[m.provider];
              const isFree = isModelFreeTier(m);
              const freeLabel = getModelAccessLabel(m);
              const ctxLabel = formatContextWindow(m.contextWindowTokens);
              return (
                <div
                  key={m.compositeId}
                  className={`px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors ${
                    isSelected ? 'bg-blue-950/25' : 'hover:bg-slate-800/30'
                  }`}
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <ProviderAvatar provider={m.provider} modelId={m.modelId} size="xs" />
                      <span className="font-display font-semibold text-sm text-slate-100">
                        {m.displayName}
                      </span>
                      <span className="font-mono text-xs text-slate-400">{m.modelId}</span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className={`text-xs font-medium ${cfg?.textClass || 'text-slate-300'}`}>
                        {cfg?.name || m.provider}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span
                        className={`text-xs font-medium ${
                          isFree ? 'text-emerald-400' : 'text-amber-300/90'
                        }`}
                      >
                        {isFree ? 'Free · No Sub' : freeLabel}
                      </span>
                      {m.tier && (
                        <>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="text-xs text-slate-400 capitalize">{m.tier} tier</span>
                        </>
                      )}
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className={`text-xs ${getStatusTextClass(m.availabilityState)}`}>
                        {formatStatusLabel(m.availabilityState)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">{m.description}</p>

                    {!m.available && m.unavailableReason && (
                      <p className="text-xs text-amber-300/90 leading-relaxed">
                        Reason: {m.unavailableReason}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 pt-0.5">
                      <span>{m.capabilities.join(' · ')}</span>
                      {ctxLabel && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{ctxLabel}</span>
                        </>
                      )}
                      {m.supportsMultimodal && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Vision</span>
                        </>
                      )}
                      {m.pricingVerified &&
                        m.inputPricePer1MUsd !== null &&
                        m.outputPricePer1MUsd !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums font-mono">
                              ${m.inputPricePer1MUsd}/1M in · ${m.outputPricePer1MUsd}/1M out
                            </span>
                          </>
                        )}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-3">
                    {!m.available ? (
                      <button
                        type="button"
                        onClick={() => onNavigate('connections')}
                        className="min-h-[38px] px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
                      >
                        Resolve in Connections
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSelect(m.compositeId)}
                        className={`inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                        {isSelected ? 'Selected' : 'Select Model'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredModels.length === 0 && (
              <div className="px-5 py-10 text-center space-y-3">
                <p className="text-sm text-slate-400">No models match your search filters.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setAccessFilter('all');
                    setProviderFilter('all');
                    setTierFilter('all');
                    setAvailabilityFilter('all');
                  }}
                  className="px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
                >
                  Reset Filters
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
