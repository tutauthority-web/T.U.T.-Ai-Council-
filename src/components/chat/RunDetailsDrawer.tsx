import { ArrowRightLeft, ShieldAlert, ShieldCheck, UserMinus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { formatStatusLabel } from '../../lib/statusLabels';
import { formatParticipantDisplayLabel, isValidProviderId } from '../../shared/providers';
import type { ProviderId } from '../../shared/types';
import type {
  FallbackRecord,
  PreflightViewState,
  ProviderErrorRecord,
  RemovedModelRecord,
} from './types';

function formatCompositeSafe(compositeId: string, hideModelDetails: boolean): string {
  const idx = compositeId.indexOf(':');
  const rawProvider = idx === -1 ? 'google' : compositeId.slice(0, idx);
  const modelId = idx === -1 ? compositeId : compositeId.slice(idx + 1);
  const provider: ProviderId = isValidProviderId(rawProvider) ? rawProvider : 'google';
  return formatParticipantDisplayLabel({
    provider,
    modelId,
    hideModelDetails,
  });
}

export function RunDetailsDrawer({
  open,
  onClose,
  preflightState,
  fallbackHistory,
  persistedErrors,
  removedModels = [],
  hideModelDetails = false,
}: {
  open: boolean;
  onClose: () => void;
  preflightState: PreflightViewState | null;
  fallbackHistory: FallbackRecord[];
  persistedErrors: ProviderErrorRecord[];
  removedModels?: RemovedModelRecord[];
  hideModelDetails?: boolean;
}) {
  const hasAny =
    Boolean(preflightState?.readyModels.length) ||
    Boolean(preflightState?.rejectedModels.length) ||
    fallbackHistory.length > 0 ||
    removedModels.length > 0 ||
    persistedErrors.length > 0;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.section
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="w-full shrink-0 border-b border-white/10 bg-[#0D1428]/95 backdrop-blur-xl overflow-hidden z-10"
        >
          <div className="mx-auto w-full max-w-5xl px-3 sm:px-5 py-3 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-display font-semibold text-slate-100">
                <ShieldAlert className="w-4 h-4 text-[#FFB454] shrink-0" />
                <span>Run Details</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-lg text-[#9AA7BF] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Close run details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!hasAny && (
              <p className="text-[#9AA7BF]">
                No warnings, fallbacks, or errors in this session.
              </p>
            )}

            {preflightState && preflightState.readyModels.length > 0 && (
              <p className="text-emerald-300 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Verified:{' '}
                  <span className="font-mono text-emerald-200">
                    {preflightState.readyModels
                      .map((cid) =>
                        hideModelDetails ? formatCompositeSafe(cid, true) : cid,
                      )
                      .join(', ')}
                  </span>
                </span>
              </p>
            )}

            {preflightState && preflightState.rejectedModels.length > 0 && (
              <div className="space-y-1 text-amber-200 pt-1.5 border-t border-white/10">
                {preflightState.rejectedModels.map((r) => (
                  <p key={`preflight-${r.compositeId}`}>
                    Rejected{' '}
                    <span className="font-mono">
                      {formatParticipantDisplayLabel({
                        provider: r.provider,
                        modelId: r.modelId,
                        hideModelDetails,
                      })}
                    </span>{' '}
                    ({r.errorCategory || formatStatusLabel(r.availabilityState)}): {r.reason}
                  </p>
                ))}
              </div>
            )}

            {fallbackHistory.length > 0 && (
              <div className="space-y-1 pt-1.5 border-t border-white/10">
                {fallbackHistory.map((n) => (
                  <p key={n.id} className="flex items-start gap-2 text-amber-200">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-[#FFB454] shrink-0 mt-0.5" />
                    <span>
                      [{n.errorCategory}]{' '}
                      {hideModelDetails
                        ? formatCompositeSafe(n.originalCompositeId, true)
                        : n.originalModelLabel}{' '}
                      →{' '}
                      {hideModelDetails
                        ? formatCompositeSafe(n.fallbackCompositeId, true)
                        : n.fallbackModelLabel}{' '}
                      ({n.reason})
                    </span>
                  </p>
                ))}
              </div>
            )}

            {removedModels.length > 0 && (
              <div className="space-y-1 pt-1.5 border-t border-white/10">
                {removedModels.map((rm) => (
                  <p key={`removed-${rm.compositeId}`} className="flex items-start gap-2 text-amber-200">
                    <UserMinus className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Auto-removed unresponsive seat{' '}
                      <span className="font-mono text-amber-100">
                        {formatCompositeSafe(rm.compositeId, hideModelDetails)}
                      </span>
                      : {rm.reason}
                    </span>
                  </p>
                ))}
              </div>
            )}

            {persistedErrors.length > 0 && (
              <div className="space-y-1 pt-1.5 border-t border-white/10 text-rose-300 break-words">
                {persistedErrors.map((err) => (
                  <p key={err.id}>
                    <span className="font-mono">
                      {hideModelDetails
                        ? formatParticipantDisplayLabel({
                            provider: isValidProviderId(err.provider) ? err.provider : 'google',
                            modelId: err.modelId,
                            hideModelDetails: true,
                          })
                        : `${err.provider}:${err.modelId}`}
                    </span>{' '}
                    ({err.errorCode}): {err.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
