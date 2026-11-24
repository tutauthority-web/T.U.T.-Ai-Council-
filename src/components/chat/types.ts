import type { ErrorCategory, MessageReaction, PreflightModelCheck, ProviderId } from '../../shared/types';

export interface StreamingBufferItem {
  messageId: string;
  role: 'model' | 'moderator';
  provider: ProviderId;
  modelId: string;
  modelLabel: string;
  round: number;
  stageLabel: string;
  content: string;
  status: 'streaming' | 'completed' | 'stopped' | 'error';
  errorMessage?: string;
  reactions?: MessageReaction[];
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  estimatedCostUsd?: number;
}

export interface FallbackRecord {
  id: string;
  round: number;
  originalCompositeId: string;
  originalModelLabel: string;
  fallbackCompositeId: string;
  fallbackModelLabel: string;
  errorCategory: ErrorCategory | 'disconnected';
  reason: string;
}

export interface ProviderErrorRecord {
  id: string;
  provider: string;
  modelId: string;
  round: number;
  stageLabel: string;
  errorCode: string;
  message: string;
}

export interface RemovedModelRecord {
  compositeId: string;
  reason: string;
}

export interface PreflightViewState {
  readyModels: string[];
  rejectedModels: PreflightModelCheck[];
  warnings: string[];
}

export function parseCompositeIdDisplay(compositeId: string): {
  providerId: ProviderId;
  providerName: string;
  modelId: string;
} {
  const idx = compositeId.indexOf(':');
  if (idx === -1) {
    return {
      providerId: 'google',
      providerName: 'Google Gemini',
      modelId: compositeId,
    };
  }
  const raw = compositeId.slice(0, idx) as ProviderId;
  return {
    providerId: raw,
    providerName: raw,
    modelId: compositeId.slice(idx + 1),
  };
}
