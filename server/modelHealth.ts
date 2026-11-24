import { isFreeRateLimitedProvider } from '../src/shared/providers.ts';
import type {
  ErrorCategory,
  ModelInfo,
  ProviderHealthState,
  ProviderId,
} from '../src/shared/types.ts';
import { redactSensitiveText } from './crypto.ts';

export interface ClassifiedError {
  category: ErrorCategory;
  summary: string;
  rawMessage: string;
  retryable: boolean;
  statusCode?: number;
  providerErrorCode?: string;
  providerLevelBlock: boolean;
}

interface ProviderHealthRecord {
  state: ProviderHealthState;
  errorCategory?: ErrorCategory;
  message: string | null;
  updatedAt: number;
}

interface ModelUnavailableRecord {
  reason: string;
  errorCategory: ErrorCategory;
  updatedAt: number;
}

interface ModelVerifiedRecord {
  verifiedAt: number;
}

interface DiscoveredCacheRecord {
  models: ModelInfo[];
  fetchedAt: number;
}

const providerHealthMap = new Map<string, ProviderHealthRecord>();
const modelUnavailableMap = new Map<string, ModelUnavailableRecord>();
const modelVerifiedAccessMap = new Map<string, ModelVerifiedRecord>();
const discoveredCatalogCache = new Map<string, DiscoveredCacheRecord>();

export const MODEL_VERIFY_TTL_MS = 10 * 60_000;
export const MODEL_UNAVAILABLE_TTL_MS = 5 * 60_000;
export const PROVIDER_BLOCK_TTL_MS = 5 * 60_000;
export const RATE_LIMIT_TTL_MS = 60_000;
export const DISCOVERY_CACHE_TTL_MS = 2 * 60_000;

function pKey(uid: string, providerId: ProviderId): string {
  return `${uid}:${providerId}`;
}

function mKey(uid: string, compositeId: string): string {
  return `${uid}:${compositeId}`;
}

function extractStructuredErrorDetails(
  err: unknown,
  knownKey?: string,
): {
  status?: number;
  errorCode: string;
  rawMessage: string;
} {
  const anyErr = err as Record<string, any> | null | undefined;
  const rawStatusCandidate =
    anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status;
  const parsedStatus =
    typeof rawStatusCandidate === 'number'
      ? rawStatusCandidate
      : typeof rawStatusCandidate === 'string' && /^\d{3}$/.test(rawStatusCandidate.trim())
        ? Number(rawStatusCandidate.trim())
        : undefined;
  const status =
    parsedStatus !== undefined && Number.isFinite(parsedStatus) && parsedStatus >= 100 && parsedStatus <= 599
      ? parsedStatus
      : undefined;

  const nestedErr =
    anyErr?.error && typeof anyErr.error === 'object'
      ? (anyErr.error as Record<string, any>)
      : undefined;
  const codeCandidate =
    nestedErr?.code ??
    nestedErr?.type ??
    (typeof anyErr?.code === 'string' || typeof anyErr?.code === 'number' ? anyErr.code : undefined) ??
    anyErr?.type;
  const errorCode =
    codeCandidate !== undefined && codeCandidate !== null
      ? String(codeCandidate).trim().toLowerCase()
      : '';

  const messageCandidate =
    typeof anyErr?.message === 'string' && anyErr.message.trim()
      ? anyErr.message
      : typeof nestedErr?.message === 'string' && nestedErr.message.trim()
        ? nestedErr.message
        : err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null
            ? JSON.stringify(err)
            : String(err);

  return {
    status,
    errorCode,
    rawMessage: redactSensitiveText(messageCandidate || 'Provider request failed.', knownKey),
  };
}

export function classifyProviderError(
  err: unknown,
  providerId?: ProviderId,
  knownKey?: string,
): ClassifiedError {
  const { status, errorCode, rawMessage } = extractStructuredErrorDetails(err, knownKey);
  const lower = rawMessage.toLowerCase();
  const isFreeProvider = isFreeRateLimitedProvider(providerId);

  const hasRateLimitPhrase =
    errorCode === 'rate_limit_exceeded' ||
    errorCode === 'too_many_requests' ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('resource_exhausted');

  const hasTpmOrPayloadLimitPhrase =
    status === 413 ||
    lower.includes('tokens per minute') ||
    lower.includes('request too large') ||
    lower.includes('payload too large') ||
    /\btpm\b/.test(lower);

  const isInsufficientQuotaCode =
    errorCode === 'insufficient_quota' || errorCode === 'billing_hard_limit_reached';
  const hasInsufficientCreditPhrase =
    lower.includes('credit balance is too low') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('insufficient_quota');

  const hasPerModelRestrictionPhrase =
    lower.includes('organization must be verified') ||
    lower.includes('does not have access to model') ||
    lower.includes('not allowed to sample') ||
    lower.includes('model is not supported') ||
    lower.includes('not a chat model') ||
    (lower.includes('limit: 0') &&
      (status === 429 ||
        lower.includes('resource_exhausted') ||
        lower.includes('free_tier') ||
        lower.includes('quota exceeded')));

  // Free OpenAI-compatible providers (Groq, OpenRouter :free, Cerebras, Mistral):
  // A 429 or 413 TPM limit is ALWAYS "free limit reached, retry shortly", NEVER "credits exhausted" or permanent error.
  if (
    isFreeProvider &&
    (status === 429 || hasRateLimitPhrase || hasTpmOrPayloadLimitPhrase) &&
    !hasPerModelRestrictionPhrase
  ) {
    return {
      category: 'rate_limited',
      summary: 'Free limit reached, retry shortly.',
      rawMessage,
      retryable: true,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: false,
    };
  }

  // Per-model plan/tier restrictions must NOT block the whole provider
  if (hasPerModelRestrictionPhrase) {
    return {
      category: 'invalid_model',
      summary: 'This specific model is restricted or has zero quota on your current plan/tier.',
      rawMessage,
      retryable: false,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: false,
    };
  }

  // Credit / quota exhaustion: ONLY explicit 402, quota error code, or exact phrases (never bare numbers)
  if (status === 402 || isInsufficientQuotaCode || hasInsufficientCreditPhrase) {
    return {
      category: 'insufficient_credits',
      summary: 'Provider credits or billing quota exhausted.',
      rawMessage,
      retryable: false,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: !isFreeProvider,
    };
  }

  // Structured HTTP status mapping
  if (status === 401) {
    return {
      category: 'invalid_credentials',
      summary: 'API key credentials are invalid or unauthorized (401).',
      rawMessage,
      retryable: false,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: !isFreeProvider,
    };
  }

  if (status === 403) {
    return {
      category: 'invalid_credentials',
      summary: 'Permission denied for this request or model (403).',
      rawMessage,
      retryable: false,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: false,
    };
  }

  if (status === 404) {
    return {
      category: 'invalid_model',
      summary: 'Model ID was not found or is inaccessible for inference (404).',
      rawMessage,
      retryable: false,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: false,
    };
  }

  if (status === 429 || hasTpmOrPayloadLimitPhrase) {
    return {
      category: 'rate_limited',
      summary: isFreeProvider
        ? 'Free limit reached, retry shortly.'
        : 'Provider rate or token limit temporarily exceeded.',
      rawMessage,
      retryable: true,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: false,
    };
  }

  if (status !== undefined && status >= 500 && status <= 599) {
    return {
      category: 'transient_error',
      summary: `Provider endpoint experienced a temporary server error (${status}).`,
      rawMessage,
      retryable: true,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: false,
    };
  }

  // Phrase-only fallback (NEVER match bare digits like "401", "402", "403", "404", "429", "500")
  const hasExplicitKeyCode =
    errorCode === 'invalid_api_key' ||
    errorCode === 'authentication_error' ||
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect_api_key') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('incorrect api key') ||
    lower.includes('invalid x-api-key') ||
    lower.includes('decrypt_failed');

  if (
    hasExplicitKeyCode ||
    lower.includes('authentication_error') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthorized')
  ) {
    return {
      category: 'invalid_credentials',
      summary: 'API key credentials are invalid, expired, or lack required permissions.',
      rawMessage,
      retryable: false,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: !isFreeProvider && hasExplicitKeyCode,
    };
  }

  if (
    errorCode === 'model_not_found' ||
    errorCode === 'not_found_error' ||
    lower.includes('model_not_found') ||
    lower.includes('not_found_error') ||
    lower.includes('is not found') ||
    lower.includes('does not exist') ||
    lower.includes('not supported for') ||
    lower.includes('invalid model') ||
    lower.includes('unknown model')
  ) {
    return {
      category: 'invalid_model',
      summary: 'Model ID is invalid or not accessible for inference on this account.',
      rawMessage,
      retryable: false,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: false,
    };
  }

  if (hasRateLimitPhrase) {
    return {
      category: 'rate_limited',
      summary: isFreeProvider
        ? 'Free limit reached, retry shortly.'
        : 'Provider rate limit temporarily exceeded.',
      rawMessage,
      retryable: true,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: false,
    };
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('overloaded') ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway') ||
    lower.includes('gateway timeout')
  ) {
    return {
      category: 'transient_error',
      summary: 'Provider endpoint experienced a temporary network or capacity error.',
      rawMessage,
      retryable: true,
      statusCode: status,
      providerErrorCode: errorCode || undefined,
      providerLevelBlock: false,
    };
  }

  return {
    category: 'upstream_error',
    summary: rawMessage.slice(0, 260) || 'Provider request failed.',
    rawMessage,
    retryable: false,
    statusCode: status,
    providerErrorCode: errorCode || undefined,
    providerLevelBlock: false,
  };
}

export function formatClassifiedError(classified: ClassifiedError, maxLen = 700): string {
  const cleanRaw = classified.rawMessage.trim();
  if (!cleanRaw || cleanRaw === classified.summary || classified.category === 'upstream_error') {
    return (cleanRaw || classified.summary).slice(0, maxLen);
  }
  return `${classified.summary} Raw provider error: ${cleanRaw}`.slice(0, maxLen);
}

export function recordProviderHealth(
  uid: string,
  providerId: ProviderId,
  state: ProviderHealthState,
  message: string | null,
  errorCategory?: ErrorCategory,
  updatedAtMs = Date.now(),
): void {
  providerHealthMap.set(pKey(uid, providerId), {
    state,
    errorCategory,
    message,
    updatedAt: updatedAtMs,
  });

  if (
    state === 'insufficient_credits' ||
    state === 'invalid_credentials' ||
    state === 'unavailable' ||
    state === 'rate_limited'
  ) {
    const prefix = `${uid}:${providerId}:`;
    for (const key of modelVerifiedAccessMap.keys()) {
      if (key.startsWith(prefix)) {
        modelVerifiedAccessMap.delete(key);
      }
    }
  }
}

export function clearProviderHealth(uid: string, providerId: ProviderId): void {
  providerHealthMap.delete(pKey(uid, providerId));
  discoveredCatalogCache.delete(pKey(uid, providerId));
  const prefix = `${uid}:${providerId}:`;
  for (const key of modelUnavailableMap.keys()) {
    if (key.startsWith(prefix)) {
      modelUnavailableMap.delete(key);
    }
  }
  for (const key of modelVerifiedAccessMap.keys()) {
    if (key.startsWith(prefix)) {
      modelVerifiedAccessMap.delete(key);
    }
  }
}

export function clearRateLimitedModelsForUser(uid: string, providerId?: ProviderId): void {
  const prefix = providerId ? `${uid}:${providerId}:` : `${uid}:`;
  for (const [key, rec] of modelUnavailableMap.entries()) {
    if (key.startsWith(prefix) && rec.errorCategory === 'rate_limited') {
      modelUnavailableMap.delete(key);
    }
  }
}

export function getProviderHealth(
  uid: string,
  providerId: ProviderId,
  nowMs = Date.now(),
): { state: ProviderHealthState; errorCategory?: ErrorCategory; message: string | null } {
  const rec = providerHealthMap.get(pKey(uid, providerId));
  if (!rec) return { state: 'connected', message: null };
  if (rec.state === 'rate_limited' && nowMs - rec.updatedAt > RATE_LIMIT_TTL_MS) {
    providerHealthMap.delete(pKey(uid, providerId));
    return { state: 'connected', message: null };
  }
  if (
    (rec.state === 'insufficient_credits' ||
      rec.state === 'invalid_credentials' ||
      rec.state === 'unavailable') &&
    nowMs - rec.updatedAt > PROVIDER_BLOCK_TTL_MS
  ) {
    providerHealthMap.delete(pKey(uid, providerId));
    return { state: 'connected', message: null };
  }
  return {
    state: rec.state,
    errorCategory: rec.errorCategory,
    message: rec.message,
  };
}

export function recordModelUnavailable(
  uid: string,
  compositeId: string,
  reason: string,
  errorCategory: ErrorCategory = 'invalid_model',
  updatedAtMs = Date.now(),
): void {
  modelVerifiedAccessMap.delete(mKey(uid, compositeId));
  modelUnavailableMap.set(mKey(uid, compositeId), {
    reason,
    errorCategory,
    updatedAt: updatedAtMs,
  });
}

export function getModelUnavailableReason(
  uid: string,
  compositeId: string,
  nowMs = Date.now(),
): { reason: string; errorCategory: ErrorCategory } | null {
  const rec = modelUnavailableMap.get(mKey(uid, compositeId));
  if (!rec) return null;
  const ttl = rec.errorCategory === 'rate_limited' ? RATE_LIMIT_TTL_MS : MODEL_UNAVAILABLE_TTL_MS;
  if (nowMs - rec.updatedAt > ttl) {
    modelUnavailableMap.delete(mKey(uid, compositeId));
    return null;
  }
  return { reason: rec.reason, errorCategory: rec.errorCategory };
}

export function recordModelAccessVerified(
  uid: string,
  providerId: ProviderId,
  compositeId: string,
): void {
  modelUnavailableMap.delete(mKey(uid, compositeId));
  modelVerifiedAccessMap.set(mKey(uid, compositeId), { verifiedAt: Date.now() });
  recordProviderHealth(uid, providerId, 'inference_ready', null);
}

export function isModelAccessVerified(uid: string, compositeId: string): boolean {
  const rec = modelVerifiedAccessMap.get(mKey(uid, compositeId));
  if (!rec) return false;
  if (Date.now() - rec.verifiedAt > MODEL_VERIFY_TTL_MS) {
    modelVerifiedAccessMap.delete(mKey(uid, compositeId));
    return false;
  }
  return true;
}

export function getVerifiedModelsCount(uid: string, providerId: ProviderId): number {
  const prefix = `${uid}:${providerId}:`;
  const now = Date.now();
  let count = 0;
  for (const [key, rec] of modelVerifiedAccessMap.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (now - rec.verifiedAt > MODEL_VERIFY_TTL_MS) {
      modelVerifiedAccessMap.delete(key);
      continue;
    }
    count += 1;
  }
  return count;
}

export function setDiscoveredCatalogCache(
  uid: string,
  providerId: ProviderId,
  models: ModelInfo[],
): void {
  discoveredCatalogCache.set(pKey(uid, providerId), {
    models,
    fetchedAt: Date.now(),
  });
}

export function getDiscoveredCatalogCache(
  uid: string,
  providerId: ProviderId,
): ModelInfo[] | null {
  const rec = discoveredCatalogCache.get(pKey(uid, providerId));
  if (!rec) return null;
  if (Date.now() - rec.fetchedAt > DISCOVERY_CACHE_TTL_MS) {
    discoveredCatalogCache.delete(pKey(uid, providerId));
    return null;
  }
  return rec.models;
}

export function clearProviderCatalogForAllUsers(providerId?: ProviderId): void {
  if (!providerId) {
    discoveredCatalogCache.clear();
    providerHealthMap.clear();
    return;
  }
  const suffix = `:${providerId}`;
  for (const key of discoveredCatalogCache.keys()) {
    if (key.endsWith(suffix)) {
      discoveredCatalogCache.delete(key);
    }
  }
  for (const key of providerHealthMap.keys()) {
    if (key.endsWith(suffix)) {
      providerHealthMap.delete(key);
    }
  }
}
