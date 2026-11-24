import type { ModelAvailabilityState, ProviderHealthState } from '../shared/types';

export function formatStatusLabel(
  state: ProviderHealthState | ModelAvailabilityState,
): string {
  switch (state) {
    case 'inference_ready':
      return 'Inference Ready';
    case 'verified':
      return 'Verified';
    case 'connected':
      return 'Connected';
    case 'rate_limited':
      return 'Rate Limited';
    case 'insufficient_credits':
      return 'Insufficient Credits';
    case 'invalid_credentials':
      return 'Invalid Credentials';
    case 'unavailable':
      return 'Unavailable';
    case 'disconnected':
    default:
      return 'Disconnected';
  }
}

export function getStatusTextClass(
  state: ProviderHealthState | ModelAvailabilityState,
): string {
  switch (state) {
    case 'inference_ready':
      return 'text-emerald-400 font-medium';
    case 'verified':
      return 'text-blue-300 font-medium';
    case 'connected':
      return 'text-slate-200 font-medium';
    case 'rate_limited':
    case 'insufficient_credits':
      return 'text-amber-400 font-medium';
    case 'invalid_credentials':
    case 'unavailable':
      return 'text-rose-400 font-medium';
    case 'disconnected':
    default:
      return 'text-slate-400';
  }
}
