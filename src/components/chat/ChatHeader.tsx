import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Download,
  FileJson,
  Scale,
  Square,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  formatParticipantDisplayLabel,
  isChatGptAliasModelId,
  isManagedSeatModelId,
  isValidProviderId,
  PROVIDER_REGISTRY,
} from '../../shared/providers';
import type { CouncilRoomDoc, ProviderId } from '../../shared/types';
import {
  getDuplicateProviderCompositeSet,
  getModelVisualIdentity,
  ProviderAvatar,
} from '../ProviderBadge';
import type { FallbackRecord, PreflightViewState } from './types';

function formatCompositeDisplay(compositeId: string): {
  providerId: ProviderId;
  providerName: string;
  modelId: string;
} {
  const idx = compositeId.indexOf(':');
  if (idx === -1) {
    return { providerId: 'google', providerName: 'Google Gemini', modelId: compositeId };
  }
  const raw = compositeId.slice(0, idx);
  if (isValidProviderId(raw)) {
    return {
      providerId: raw,
      providerName: PROVIDER_REGISTRY[raw].name,
      modelId: compositeId.slice(idx + 1),
    };
  }
  return { providerId: 'google', providerName: raw, modelId: compositeId.slice(idx + 1) };
}

export function ChatHeader({
  council,
  modeLabel,
  isChatMode,
  isRunning,
  preflightState,
  activeFallbacksByOriginal,
  warningCount,
  errorCount,
  runDetailsOpen,
  onToggleRunDetails,
  onStop,
  onExportMarkdown,
  onExportJSON,
  onBack,
  hideModelDetails = false,
}: {
  council: CouncilRoomDoc;
  modeLabel: string;
  isChatMode: boolean;
  isRunning: boolean;
  preflightState: PreflightViewState | null;
  activeFallbacksByOriginal: Map<string, FallbackRecord>;
  warningCount: number;
  errorCount: number;
  runDetailsOpen: boolean;
  onToggleRunDetails: () => void;
  onStop: () => void;
  onExportMarkdown: () => void;
  onExportJSON: () => void;
  onBack?: () => void;
  hideModelDetails?: boolean;
}) {
  const [modelsExpanded, setModelsExpanded] = useState(false);

  const totalBadgeCount = warningCount + errorCount;
  const totalTokens = (council.totalInputTokens || 0) + (council.totalOutputTokens || 0);

  const duplicateModelSet = getDuplicateProviderCompositeSet(
    council.selectedModels.map((cid) => activeFallbacksByOriginal.get(cid)?.fallbackCompositeId || cid),
  );

  return (
    <header className="w-full shrink-0 z-20 border-b border-white/[0.08] bg-[#0B1123]/85 backdrop-blur-xl">
      <div className="w-full px-3 sm:px-5 py-2.5">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          {/* Left: Native Back + Overlapping Avatars + Room Title */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Go back"
                className="-ml-1 lg:hidden inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl text-[#CBD5E1] hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setModelsExpanded((prev) => !prev)}
              aria-expanded={modelsExpanded}
              className="flex items-center gap-3 min-w-0 flex-1 text-left group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7AA7FF] rounded-xl py-0.5 pr-2"
            >
              <div className="flex items-center pl-2 shrink-0">
                {council.selectedModels.slice(0, 4).map((compositeId) => {
                  const fb = activeFallbacksByOriginal.get(compositeId);
                  const activeId = fb ? fb.fallbackCompositeId : compositeId;
                  const parsed = formatCompositeDisplay(activeId);
                  return (
                    <div
                      key={compositeId}
                      className="-ml-2 rounded-full ring-2 ring-[#0B1123]"
                    >
                      <ProviderAvatar
                        provider={parsed.providerId}
                        modelId={parsed.modelId}
                        useModelLogo={duplicateModelSet.has(activeId)}
                        size="sm"
                      />
                    </div>
                  );
                })}
                {council.selectedModels.length > 4 && (
                  <div className="-ml-2 w-8 h-8 rounded-full bg-slate-800 border-2 border-[#0B1123] flex items-center justify-center text-[11px] font-bold text-slate-200">
                    +{council.selectedModels.length - 4}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h1 className="font-display font-bold text-sm sm:text-[15px] text-[#F4F7FD] truncate">
                    {council.title}
                  </h1>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[#9AA7BF] shrink-0 transition-transform duration-200 ${
                      modelsExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-[#9AA7BF] truncate">
                  {isRunning && (
                    <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] animate-council-pulse" />
                      Live
                    </span>
                  )}
                  {isRunning && <span aria-hidden="true">·</span>}
                  <span>{modeLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {council.selectedModels.length}{' '}
                    {hideModelDetails ? 'seats' : 'models'}
                  </span>
                  {!isChatMode && council.moderatorModel !== 'none' && (
                    <span className="hidden md:inline-flex items-center gap-1 text-amber-200/80 ml-1">
                      · <Scale className="w-3 h-3 text-amber-300" /> Moderator
                    </span>
                  )}
                </div>
              </div>
            </button>
          </div>

          {/* Right: Compact Icon Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleRunDetails}
              aria-expanded={runDetailsOpen}
              aria-label="Run details"
              title="Run details"
              className={`relative inline-flex items-center justify-center gap-1.5 px-2.5 h-9 rounded-xl border text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                runDetailsOpen
                  ? 'bg-white/14 border-white/25 text-white'
                  : 'bg-white/[0.05] hover:bg-white/10 border-white/10 text-[#E6EBF5]'
              }`}
            >
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${
                  errorCount > 0
                    ? 'text-rose-400'
                    : warningCount > 0
                      ? 'text-[#FFB454]'
                      : 'text-[#9AA7BF]'
                }`}
              />
              <span className="hidden sm:inline">Details</span>
              {totalBadgeCount > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
                    errorCount > 0
                      ? 'bg-rose-500 text-white'
                      : 'bg-[#FFB454] text-[#0A0F1E]'
                  }`}
                >
                  {totalBadgeCount}
                </span>
              )}
            </button>

            {isRunning ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onExportMarkdown}
                  className="inline-flex items-center justify-center w-9 h-9 sm:w-auto sm:px-2.5 rounded-xl text-xs font-medium bg-white/[0.05] hover:bg-white/10 border border-white/10 text-[#E6EBF5] transition-colors cursor-pointer shrink-0 gap-1.5"
                  title="Export Markdown"
                  aria-label="Export Markdown"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden md:inline">MD</span>
                </button>
                <button
                  type="button"
                  onClick={onExportJSON}
                  className="hidden sm:inline-flex items-center justify-center w-9 h-9 md:w-auto md:px-2.5 rounded-xl text-xs font-medium bg-white/[0.05] hover:bg-white/10 border border-white/10 text-[#E6EBF5] transition-colors cursor-pointer shrink-0 gap-1.5"
                  title="Export JSON"
                  aria-label="Export JSON"
                >
                  <FileJson className="w-4 h-4" />
                  <span className="hidden md:inline">JSON</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Expandable Selected Council Models Roster */}
        <AnimatePresence initial={false}>
          {modelsExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#9AA7BF]">
                  <span>
                    Participants ({council.selectedModels.length})
                    {!hideModelDetails && council.intelligenceLevel
                      ? ` · ${council.intelligenceLevel} intelligence`
                      : ''}
                  </span>
                  <span className="tabular-nums">
                    {totalTokens.toLocaleString()} tokens
                    {council.estimatedCostUsd > 0 ? ` · $${council.estimatedCostUsd.toFixed(4)}` : ''}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {council.selectedModels.map((compositeId, seatIdx) => {
                    const fb = activeFallbacksByOriginal.get(compositeId);
                    const activeId = fb ? fb.fallbackCompositeId : compositeId;
                    const parsedActive = formatCompositeDisplay(activeId);
                    const isChatGpt = isChatGptAliasModelId(parsedActive.modelId);
                    const shouldHideModel = hideModelDetails || isManagedSeatModelId(parsedActive.modelId);
                    const visual = getModelVisualIdentity(
                      parsedActive.providerId,
                      parsedActive.modelId,
                      duplicateModelSet.has(activeId),
                    );
                    const isReady = preflightState
                      ? preflightState.readyModels.includes(activeId) || Boolean(fb)
                      : false;
                    const providerHeading = isChatGpt
                      ? 'ChatGPT'
                      : parsedActive.providerName;

                    return (
                      <div
                        key={`${compositeId}-${seatIdx}`}
                        className="rounded-xl bg-[#0A0F1E]/75 border border-white/10 px-3 py-2 text-xs space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-semibold">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: visual.accentHex }}
                            />
                            <span style={{ color: visual.accentHex }}>
                              {providerHeading}
                            </span>
                          </span>
                          {fb ? (
                            <span className="text-amber-300 font-medium">Fallback</span>
                          ) : isReady ? (
                            <span className="text-emerald-400 font-medium">Verified</span>
                          ) : null}
                        </div>
                        {shouldHideModel ? (
                          <p className="text-[#CBD5E1] truncate text-[11.5px]">
                            {formatParticipantDisplayLabel({
                              provider: parsedActive.providerId,
                              modelId: parsedActive.modelId,
                              hideModelDetails: true,
                              seatLabel: `Seat ${seatIdx + 1}`,
                            })}
                          </p>
                        ) : (
                          <p className="font-mono text-[#E6EBF5] truncate">{parsedActive.modelId}</p>
                        )}
                        {fb && !shouldHideModel && (
                          <p className="text-[#9AA7BF] truncate text-[11px]">
                            Replaced: <span className="font-mono">{fb.originalCompositeId}</span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
