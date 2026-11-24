import { useMemo, useState } from 'react';
import {
  Check,
  RefreshCw,
  Search,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
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
import type {
  IntelligenceLevel,
  ModelInfo,
  ModelPresetDoc,
  ProviderId,
} from '../shared/types';

export function ManualModelPicker({
  models,
  selectedModels,
  onChangeSelected,
  onToggleModel,
  maxSelected = 6,
  presets = [],
  onApplyPreset,
  allowAvailabilityToggle = false,
  onRefreshCatalog,
  refreshing = false,
  onResolveProvider,
}: {
  models: ModelInfo[];
  selectedModels: string[];
  onChangeSelected: (nextIds: string[]) => void;
  onToggleModel: (compositeId: string) => void;
  maxSelected?: number;
  presets?: ModelPresetDoc[];
  onApplyPreset?: (preset: ModelPresetDoc) => void;
  allowAvailabilityToggle?: boolean;
  onRefreshCatalog?: () => void;
  refreshing?: boolean;
  onResolveProvider?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [accessFilter, setAccessFilter] = useState<ModelAccessFilter>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | ProviderId>('all');
  const [tierFilter, setTierFilter] = useState<'all' | IntelligenceLevel>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<'all' | 'coding' | 'reasoning' | 'multimodal'>('all');
  const [availabilityScope, setAvailabilityScope] = useState<'ready' | 'all'>('ready');
  const [sortBy, setSortBy] = useState<ModelSortOption>('recommended');

  const modelMap = useMemo(
    () => new Map(models.map((m) => [m.compositeId, m])),
    [models],
  );

  const scopedBaseModels = useMemo(() => {
    if (allowAvailabilityToggle && availabilityScope === 'all') {
      return models;
    }
    return models.filter(isModelSelectableClient);
  }, [models, allowAvailabilityToggle, availabilityScope]);

  const freeCount = useMemo(
    () => scopedBaseModels.filter((m) => isModelFreeTier(m)).length,
    [scopedBaseModels],
  );
  const paidCount = useMemo(
    () => scopedBaseModels.filter((m) => !isModelFreeTier(m)).length,
    [scopedBaseModels],
  );

  // Models matching accessFilter (so provider tab counts reflect current Free/Paid filter!)
  const accessFilteredModels = useMemo(() => {
    return scopedBaseModels.filter((m) => {
      if (accessFilter === 'free') return isModelFreeTier(m);
      if (accessFilter === 'paid') return !isModelFreeTier(m);
      return true;
    });
  }, [scopedBaseModels, accessFilter]);

  const providerCounts = useMemo(() => {
    const counts = new Map<ProviderId, number>();
    for (const m of accessFilteredModels) {
      counts.set(m.provider, (counts.get(m.provider) || 0) + 1);
    }
    return counts;
  }, [accessFilteredModels]);

  const activeProviders = useMemo(
    () => PROVIDER_IDS.filter((pid) => (providerCounts.get(pid) || 0) > 0 || providerFilter === pid),
    [providerCounts, providerFilter],
  );

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = accessFilteredModels.filter((m) => {
      if (providerFilter !== 'all' && m.provider !== providerFilter) return false;
      if (tierFilter !== 'all' && (m.tier || 'medium') !== tierFilter) return false;
      if (capabilityFilter === 'multimodal' && !m.supportsMultimodal) return false;
      if (
        capabilityFilter === 'coding' &&
        !m.capabilities.some((c) => c.toLowerCase().includes('coding')) &&
        !m.modelId.toLowerCase().includes('coder') &&
        !m.modelId.toLowerCase().includes('devstral')
      ) {
        return false;
      }
      if (
        capabilityFilter === 'reasoning' &&
        !m.capabilities.some((c) => c.toLowerCase().includes('reason'))
      ) {
        return false;
      }
      if (!q) return true;
      const pName = PROVIDER_REGISTRY[m.provider]?.name.toLowerCase() || m.provider;
      const freeLabel = getModelAccessLabel(m).toLowerCase();
      return (
        m.modelId.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        pName.includes(q) ||
        freeLabel.includes(q) ||
        m.capabilities.some((c) => c.toLowerCase().includes(q))
      );
    });
    return sortModelsForPicker(filtered, sortBy);
  }, [accessFilteredModels, providerFilter, tierFilter, capabilityFilter, search, sortBy]);

  const readyFreeMix = useMemo(
    () => pickQuickMixIds(models, 'best_free', Math.min(4, maxSelected)),
    [models, maxSelected],
  );
  const fastFreeMix = useMemo(
    () => pickQuickMixIds(models, 'fast_free', Math.min(3, maxSelected)),
    [models, maxSelected],
  );
  const allProvidersMix = useMemo(
    () => pickQuickMixIds(models, 'all_providers', Math.min(4, maxSelected)),
    [models, maxSelected],
  );

  const hasActiveFilters =
    search.trim().length > 0 ||
    accessFilter !== 'all' ||
    providerFilter !== 'all' ||
    tierFilter !== 'all' ||
    capabilityFilter !== 'all';

  const resetFilters = () => {
    setSearch('');
    setAccessFilter('all');
    setProviderFilter('all');
    setTierFilter('all');
    setCapabilityFilter('all');
  };

  return (
    <div className="space-y-4">
      {/* Selected Panel Dock */}
      <div className="bg-[#090E1A] border border-slate-800 rounded-xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-200 tabular-nums">
            Selected Panel ({selectedModels.length} / {maxSelected})
          </span>
          <div className="flex items-center gap-3">
            {onRefreshCatalog && (
              <button
                type="button"
                disabled={refreshing}
                onClick={onRefreshCatalog}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            )}
            {selectedModels.length > 0 && (
              <button
                type="button"
                onClick={() => onChangeSelected([])}
                className="text-xs text-slate-400 hover:text-rose-300 transition-colors"
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {selectedModels.length === 0 ? (
          <p className="text-xs text-slate-400">
            Tap any model below or choose a quick mix to build your chat panel.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedModels.map((cid) => {
              const info = modelMap.get(cid);
              const providerId = info?.provider || (cid.split(':')[0] as ProviderId);
              const cfg = PROVIDER_REGISTRY[providerId];
              const isFree = info ? isModelFreeTier(info) : false;
              const shortLabel =
                info?.displayName ||
                cid.split(':').slice(1).join(':').split('/').pop() ||
                cid;
              return (
                <button
                  key={cid}
                  type="button"
                  onClick={() => onToggleModel(cid)}
                  title={`Remove ${cid}`}
                  className="inline-flex items-center gap-2 min-h-[36px] pl-2.5 pr-2 py-1 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700/90 hover:border-rose-500/60 rounded-lg text-slate-100 transition-colors max-w-full"
                >
                  <span className={`font-medium shrink-0 ${cfg?.textClass || 'text-blue-400'}`}>
                    {cfg?.shortName || providerId}
                  </span>
                  <span className="truncate max-w-[180px] sm:max-w-[220px] font-mono text-[11px] text-slate-200">
                    {shortLabel}
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
      </div>

      {/* Quick Picks + Saved Presets */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400 mr-0.5">Quick Pick:</span>
          {readyFreeMix.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setAccessFilter('free');
                setProviderFilter('all');
                onChangeSelected(readyFreeMix);
              }}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-medium bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-700/60 text-emerald-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Best Free Mix ({readyFreeMix.length})
            </button>
          )}
          {fastFreeMix.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setAccessFilter('free');
                setProviderFilter('all');
                onChangeSelected(fastFreeMix);
              }}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              Fast Free ({fastFreeMix.length})
            </button>
          )}
          {allProvidersMix.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setAccessFilter('all');
                setProviderFilter('all');
                onChangeSelected(allProvidersMix);
              }}
              className="inline-flex items-center min-h-[36px] px-3 py-1.5 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              1 Per Provider ({allProvidersMix.length})
            </button>
          )}
        </div>

        {presets.length > 0 && onApplyPreset && (
          <select
            defaultValue=""
            onChange={(e) => {
              const p = presets.find((item) => item.id === e.target.value);
              if (p) onApplyPreset(p);
            }}
            aria-label="Load saved model preset"
            className="min-h-[36px] px-3 py-1.5 text-xs bg-[#090E1A] border border-slate-800 rounded-lg text-slate-200"
          >
            <option value="" disabled>
              Load Saved Preset...
            </option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Smart Filter Toolbar */}
      <div className="bg-[#090E1A] border border-slate-800 rounded-xl p-3.5 space-y-3">
        {/* Search + Access Segmented Filter + Sort */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models, OpenRouter, Groq, coding, vision..."
              className="w-full min-h-[40px] pl-9 pr-8 py-2 text-sm bg-[#111827] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Free / Subscription Smart Access Filter */}
            <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setAccessFilter('all')}
                className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
                  accessFilter === 'all'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({scopedBaseModels.length})
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
                Free · No Sub ({freeCount})
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
                Paid API ({paidCount})
              </button>
            </div>

            {allowAvailabilityToggle && (
              <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setAvailabilityScope('ready')}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    availabilityScope === 'ready'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Ready Only
                </button>
                <button
                  type="button"
                  onClick={() => setAvailabilityScope('all')}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    availabilityScope === 'all'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Full Catalog
                </button>
              </div>
            )}

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ModelSortOption)}
              aria-label="Sort models"
              className="min-h-[40px] px-3 py-1.5 text-xs bg-[#111827] border border-slate-800 rounded-lg text-slate-200"
            >
              <option value="recommended">Sort: Recommended</option>
              <option value="free_first">Sort: Free First</option>
              <option value="context">Sort: Context Size</option>
              <option value="alpha">Sort: Name A–Z</option>
            </select>
          </div>
        </div>

        {/* Provider Tabs + Tier & Capability Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setProviderFilter('all')}
              className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap tabular-nums shrink-0 ${
                providerFilter === 'all'
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-[#111827] border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              All Providers ({accessFilteredModels.length})
            </button>
            {activeProviders.map((pid) => {
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
                      : 'bg-[#111827] border-slate-800 text-slate-300 hover:border-slate-700'
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
              className="min-h-[32px] px-2.5 py-1 text-xs bg-[#111827] border border-slate-800 rounded-md text-slate-300"
            >
              <option value="all">All Tiers</option>
              <option value="low">Low Tier (Fast)</option>
              <option value="medium">Medium Tier</option>
              <option value="high">High Tier</option>
              <option value="extreme">Extreme Tier</option>
            </select>

            <select
              value={capabilityFilter}
              onChange={(e) =>
                setCapabilityFilter(e.target.value as 'all' | 'coding' | 'reasoning' | 'multimodal')
              }
              aria-label="Filter by capability"
              className="min-h-[32px] px-2.5 py-1 text-xs bg-[#111827] border border-slate-800 rounded-md text-slate-300"
            >
              <option value="all">All Capabilities</option>
              <option value="coding">Coding</option>
              <option value="reasoning">Reasoning</option>
              <option value="multimodal">Vision / Multimodal</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap px-1"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between gap-2 text-xs text-slate-400 px-0.5">
        <span className="tabular-nums">
          Showing {filteredAndSorted.length} {filteredAndSorted.length === 1 ? 'model' : 'models'}
          {accessFilter === 'free' ? ' · Free API (No Subscription)' : ''}
        </span>
        <span>Tap any row to add or remove</span>
      </div>

      {/* Model List */}
      <div className="bg-[#090E1A] border border-slate-800 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto divide-y divide-slate-800/80">
        {filteredAndSorted.map((m) => {
          const isSelected = selectedModels.includes(m.compositeId);
          const selectable = isModelSelectableClient(m);
          const cfg = PROVIDER_REGISTRY[m.provider];
          const isFree = isModelFreeTier(m);
          const freeLabel = getModelAccessLabel(m);
          const ctxLabel = formatContextWindow(m.contextWindowTokens);
          const canClick = selectable;

          return (
            <div
              key={m.compositeId}
              className={`px-4 py-3.5 flex items-center justify-between gap-3 transition-colors ${
                isSelected
                  ? 'bg-blue-950/35'
                  : canClick
                    ? 'hover:bg-slate-900/80'
                    : 'opacity-70 bg-slate-950/40'
              }`}
            >
              <button
                type="button"
                disabled={!canClick}
                onClick={() => canClick && onToggleModel(m.compositeId)}
                className="flex-1 min-w-0 text-left flex items-center justify-between gap-3 disabled:cursor-not-allowed"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-display text-sm font-semibold text-slate-100 truncate max-w-full">
                      {m.displayName}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className={`text-xs font-medium ${cfg?.textClass || 'text-slate-300'}`}>
                      {cfg?.shortName || m.provider}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span
                      className={`text-xs font-medium ${
                        isFree ? 'text-emerald-400' : 'text-amber-300/90'
                      }`}
                    >
                      {isFree ? 'Free · No Sub' : freeLabel}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                    <span className="font-mono text-[11px] text-slate-300 break-all">
                      {m.modelId}
                    </span>
                    {m.tier && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{m.tier} tier</span>
                      </>
                    )}
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
                    <span aria-hidden="true">·</span>
                    <span className={getStatusTextClass(m.availabilityState)}>
                      {formatStatusLabel(m.availabilityState)}
                    </span>
                  </div>

                  {!m.available && m.unavailableReason && (
                    <p className="text-xs text-amber-300/90">
                      {m.unavailableReason}
                    </p>
                  )}
                </div>

                {canClick && (
                  <span
                    className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'border-slate-700 bg-[#111827]'
                    }`}
                  >
                    {isSelected && <Check className="w-4 h-4" />}
                  </span>
                )}
              </button>

              {!canClick && onResolveProvider && (
                <button
                  type="button"
                  onClick={onResolveProvider}
                  className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white border border-slate-700 rounded-lg shrink-0 whitespace-nowrap"
                >
                  Fix Key
                </button>
              )}
            </div>
          );
        })}

        {filteredAndSorted.length === 0 && (
          <div className="px-5 py-10 text-center space-y-3">
            <p className="text-sm text-slate-300">
              {accessFilter === 'free' && freeCount === 0
                ? 'No free-tier (no-subscription) models are currently connected.'
                : 'No models match your current filters.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors"
                >
                  Clear Filters
                </button>
              )}
              {accessFilter === 'free' && freeCount === 0 && onResolveProvider && (
                <button
                  type="button"
                  onClick={onResolveProvider}
                  className="px-3.5 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                >
                  Connect Groq / OpenRouter / Cerebras
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
