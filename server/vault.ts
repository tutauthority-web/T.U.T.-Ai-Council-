import { getFirebaseServerConfig } from './auth.ts';
import {
  isValidProviderId,
  PROVIDER_IDS,
  PROVIDER_REGISTRY,
} from '../src/shared/providers.ts';
import {
  createKeyFingerprint,
  decryptApiKey,
  encryptApiKey,
  redactSensitiveText,
} from './crypto.ts';
import {
  clearProviderHealth,
  getDiscoveredCatalogCache,
  getProviderHealth,
  getVerifiedModelsCount,
} from './modelHealth.ts';
import {
  getAdminSharedKeyMetadata,
  resolveAdminSharedApiKey,
} from './subscriptions.ts';
import type {
  ConnectionMethod,
  ConnectionStatus,
  ProviderConnectionSummary,
  ProviderHealthState,
  ProviderId,
} from '../src/shared/types.ts';

interface StoredCredentialDoc {
  providerId: ProviderId;
  userId: string;
  method: ConnectionMethod;
  encryptedKey: string;
  iv: string;
  authTag: string;
  keyFingerprint: string;
  status: ConnectionStatus;
  lastError?: string;
  verifiedAt: string;
  availableModelsCount: number;
  createdAt: string;
  updatedAt: string;
}

function getFirestoreBaseUrl(): string {
  const cfg = getFirebaseServerConfig();
  const dbId = cfg.firestoreDatabaseId || '(default)';
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(dbId)}/documents`;
}

function toFirestoreFields(doc: StoredCredentialDoc): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    providerId: { stringValue: doc.providerId },
    userId: { stringValue: doc.userId },
    method: { stringValue: doc.method },
    encryptedKey: { stringValue: doc.encryptedKey },
    iv: { stringValue: doc.iv },
    authTag: { stringValue: doc.authTag },
    keyFingerprint: { stringValue: doc.keyFingerprint },
    status: { stringValue: doc.status },
    verifiedAt: { stringValue: doc.verifiedAt },
    availableModelsCount: { integerValue: String(doc.availableModelsCount) },
    createdAt: { stringValue: doc.createdAt },
    updatedAt: { stringValue: doc.updatedAt },
  };
  if (doc.lastError !== undefined && doc.lastError !== '') {
    fields.lastError = { stringValue: doc.lastError.slice(0, 512) };
  }
  return fields;
}

function fromFirestoreDocument(raw: { fields?: Record<string, Record<string, unknown>> }): StoredCredentialDoc | null {
  const f = raw.fields;
  if (!f) return null;
  const str = (k: string): string => String(f[k]?.stringValue ?? '');
  const num = (k: string): number => Number(f[k]?.integerValue ?? 0);
  const providerRaw = str('providerId');
  if (!isValidProviderId(providerRaw)) return null;
  const providerId: ProviderId = providerRaw;
  return {
    providerId,
    userId: str('userId'),
    method: (str('method') as ConnectionMethod) || 'byok',
    encryptedKey: str('encryptedKey'),
    iv: str('iv'),
    authTag: str('authTag'),
    keyFingerprint: str('keyFingerprint'),
    status: (str('status') as ConnectionStatus) || 'disconnected',
    lastError: str('lastError') || undefined,
    verifiedAt: str('verifiedAt'),
    availableModelsCount: num('availableModelsCount'),
    createdAt: str('createdAt'),
    updatedAt: str('updatedAt'),
  };
}

export function isWorkspaceGeminiKeyConfigured(): boolean {
  const k = process.env.GEMINI_API_KEY?.trim();
  return Boolean(k && k !== 'MY_GEMINI_API_KEY' && k.length > 10);
}

export async function getStoredCredentialDoc(
  uid: string,
  idToken: string,
  providerId: ProviderId,
): Promise<StoredCredentialDoc | null> {
  const url = `${getFirestoreBaseUrl()}/users/${encodeURIComponent(uid)}/providerCredentials/${encodeURIComponent(providerId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to load credential metadata (${res.status}): ${redactSensitiveText(text)}`);
  }
  const data = (await res.json()) as { fields?: Record<string, Record<string, unknown>> };
  return fromFirestoreDocument(data);
}

export async function listStoredCredentialDocs(
  uid: string,
  idToken: string,
): Promise<Map<ProviderId, StoredCredentialDoc>> {
  const docs = await Promise.all(
    PROVIDER_IDS.map((pid) => getStoredCredentialDoc(uid, idToken, pid)),
  );
  const map = new Map<ProviderId, StoredCredentialDoc>();
  for (const doc of docs) {
    if (doc) map.set(doc.providerId, doc);
  }
  return map;
}

export async function saveVerifiedCredential(params: {
  uid: string;
  idToken: string;
  providerId: ProviderId;
  method: ConnectionMethod;
  apiKey?: string;
  availableModelsCount: number;
  status?: ConnectionStatus;
  lastError?: string;
}): Promise<StoredCredentialDoc> {
  const existing = await getStoredCredentialDoc(params.uid, params.idToken, params.providerId);
  const nowIso = new Date().toISOString();

  let envelope = existing
    ? {
        encryptedKey: existing.encryptedKey,
        iv: existing.iv,
        authTag: existing.authTag,
      }
    : { encryptedKey: '', iv: '', authTag: '' };
  let fingerprint = existing?.keyFingerprint || 'workspace-env';

  if (params.method === 'byok' && params.apiKey) {
    envelope = encryptApiKey(params.apiKey.trim());
    fingerprint = createKeyFingerprint(params.apiKey.trim());
  } else if (params.method === 'workspace_env') {
    envelope = encryptApiKey('WORKSPACE_ENV_GEMINI_KEY');
    fingerprint = 'Workspace Env Key';
  }

  const doc: StoredCredentialDoc = {
    providerId: params.providerId,
    userId: params.uid,
    method: params.method,
    encryptedKey: envelope.encryptedKey,
    iv: envelope.iv,
    authTag: envelope.authTag,
    keyFingerprint: fingerprint,
    status: params.status || 'connected',
    lastError: params.lastError,
    verifiedAt: nowIso,
    availableModelsCount: params.availableModelsCount,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const url = `${getFirestoreBaseUrl()}/users/${encodeURIComponent(params.uid)}/providerCredentials/${encodeURIComponent(params.providerId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(doc) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to persist encrypted credential (${res.status}): ${redactSensitiveText(text)}`);
  }
  if ((params.status || 'connected') === 'connected') {
    clearProviderHealth(params.uid, params.providerId);
  }
  return doc;
}

export async function deleteStoredCredential(
  uid: string,
  idToken: string,
  providerId: ProviderId,
): Promise<void> {
  clearProviderHealth(uid, providerId);
  const url = `${getFirestoreBaseUrl()}/users/${encodeURIComponent(uid)}/providerCredentials/${encodeURIComponent(providerId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete credential (${res.status}): ${redactSensitiveText(text)}`);
  }
}

export async function resolveRuntimeApiKey(
  uid: string,
  idToken: string,
  providerId: ProviderId,
  options?: { isPremium?: boolean },
): Promise<string | null> {
  const doc = await getStoredCredentialDoc(uid, idToken, providerId);
  if (doc && doc.status === 'connected') {
    if (doc.method === 'workspace_env') {
      if (providerId === 'google' && isWorkspaceGeminiKeyConfigured()) {
        return process.env.GEMINI_API_KEY!.trim();
      }
    } else if (doc.encryptedKey && doc.iv && doc.authTag) {
      try {
        return decryptApiKey({
          encryptedKey: doc.encryptedKey,
          iv: doc.iv,
          authTag: doc.authTag,
        });
      } catch {
        throw new Error(
          `DECRYPT_FAILED: Stored ${providerId} credential could not be decrypted. Please re-enter and verify your API key in Connections.`,
        );
      }
    }
  }

  if (options?.isPremium) {
    const adminKey = resolveAdminSharedApiKey(providerId);
    if (adminKey) return adminKey;
  }

  return null;
}

export async function getConnectionSummaries(
  uid: string,
  idToken: string,
  authoritativeProviderStates?: Record<
    ProviderId,
    {
      connected: boolean;
      healthState: ProviderHealthState;
      message: string | null;
      discoveredCount: number;
      inferenceReadyCount: number;
    }
  >,
  options?: { isPremium?: boolean },
): Promise<ProviderConnectionSummary[]> {
  const docs = await listStoredCredentialDocs(uid, idToken);
  const workspaceReady = isWorkspaceGeminiKeyConfigured();

  return PROVIDER_IDS.map((providerId) => {
    const meta = PROVIDER_REGISTRY[providerId];
    const stored = docs.get(providerId);
    const adminMeta =
      options?.isPremium && (!stored || stored.status !== 'connected')
        ? getAdminSharedKeyMetadata(providerId)
        : null;
    const usingAdmin = Boolean(adminMeta?.configured && adminMeta.status === 'connected');

    const runtimeHealth = getProviderHealth(uid, providerId);
    const liveOverride = authoritativeProviderStates?.[providerId];

    let healthState: ProviderHealthState;
    if (usingAdmin) {
      healthState = liveOverride ? liveOverride.healthState : runtimeHealth.state;
    } else if (!stored || stored.status === 'disconnected') {
      healthState = 'disconnected';
    } else if (stored.status === 'error') {
      healthState =
        runtimeHealth.state === 'insufficient_credits'
          ? 'insufficient_credits'
          : runtimeHealth.state === 'rate_limited'
            ? 'rate_limited'
            : 'invalid_credentials';
    } else if (liveOverride) {
      healthState = liveOverride.healthState;
    } else {
      healthState = runtimeHealth.state;
    }

    const healthMessage =
      healthState === 'disconnected'
        ? null
        : liveOverride?.message ||
          runtimeHealth.message ||
          (stored?.status === 'error'
            ? stored.lastError || 'Invalid credentials or verification error'
            : adminMeta?.lastError || null);

    const liveDiscovered =
      liveOverride?.discoveredCount ??
      getDiscoveredCatalogCache(uid, providerId)?.length ??
      (usingAdmin ? adminMeta?.availableModelsCount || 0 : 0);

    const liveInferenceReady =
      healthState === 'insufficient_credits' ||
      healthState === 'invalid_credentials' ||
      healthState === 'rate_limited' ||
      healthState === 'unavailable' ||
      healthState === 'disconnected'
        ? 0
        : liveOverride?.inferenceReadyCount ?? getVerifiedModelsCount(uid, providerId);

    return {
      providerId,
      providerName: meta.name,
      method: usingAdmin ? 'admin_shared' : stored ? stored.method : null,
      status: usingAdmin ? 'connected' : stored ? stored.status : 'disconnected',
      healthState,
      healthMessage,
      keyFingerprint: usingAdmin
        ? 'Admin Managed'
        : stored
          ? stored.keyFingerprint
          : null,
      verifiedAt: usingAdmin ? adminMeta?.verifiedAt || null : stored ? stored.verifiedAt : null,
      lastError: usingAdmin ? adminMeta?.lastError || null : stored?.lastError || null,
      availableModelsCount: liveInferenceReady,
      discoveredModelsCount: liveDiscovered,
      oauthSupported: meta.oauthSupported,
      oauthNote: meta.oauthNote,
      workspaceKeyAvailable: providerId === 'google' ? workspaceReady : false,
      isAdminManaged: usingAdmin,
    };
  });
}
