import fs from 'node:fs';
import path from 'node:path';
import { getFirebaseServerConfig } from './auth.ts';
import {
  createKeyFingerprint,
  decryptApiKey,
  encryptApiKey,
} from './crypto.ts';
import { clearProviderCatalogForAllUsers } from './modelHealth.ts';
import {
  isValidProviderId,
  PROVIDER_IDS,
  PROVIDER_REGISTRY,
} from '../src/shared/providers.ts';
import {
  getPremiumPlan,
  isAdminEmail,
  type ConnectionStatus,
  type EffectiveSubscriptionInfo,
  type PaymentMethod,
  type ProviderConnectionSummary,
  type ProviderId,
  type SubscriptionCycle,
  type UserSubscriptionDoc,
} from '../src/shared/types.ts';

interface AdminSharedKeyRecord {
  providerId: ProviderId;
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
  updatedBy: string;
}

type AdminKeyStore = Partial<Record<ProviderId, AdminSharedKeyRecord>>;
type SubscriptionStore = Record<string, UserSubscriptionDoc>;

const DATA_DIR = path.resolve(process.cwd(), '.data');
const ADMIN_KEYS_FILE = path.join(DATA_DIR, 'admin-shared-keys.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function getEnvAdminKey(providerId: ProviderId): string | null {
  const candidates =
    providerId === 'google'
      ? [process.env.ADMIN_GEMINI_API_KEY, process.env.ADMIN_GOOGLE_API_KEY]
      : [process.env[`ADMIN_${providerId.toUpperCase()}_API_KEY`]];
  for (const val of candidates) {
    const trimmed = val?.trim();
    if (trimmed && trimmed.length >= 10 && !trimmed.startsWith('MY_')) {
      return trimmed;
    }
  }
  return null;
}

export function loadAdminSharedKeys(): AdminKeyStore {
  const raw = readJsonFile<Record<string, AdminSharedKeyRecord>>(ADMIN_KEYS_FILE, {});
  const out: AdminKeyStore = {};
  for (const [k, v] of Object.entries(raw)) {
    if (isValidProviderId(k) && v) {
      out[k] = v;
    }
  }
  return out;
}

export function resolveAdminSharedApiKey(providerId: ProviderId): string | null {
  const store = loadAdminSharedKeys();
  const rec = store[providerId];
  if (rec && rec.status === 'connected' && rec.encryptedKey && rec.iv && rec.authTag) {
    try {
      return decryptApiKey({
        encryptedKey: rec.encryptedKey,
        iv: rec.iv,
        authTag: rec.authTag,
      });
    } catch {
      // Fall through to env override if decrypt fails
    }
  }
  return getEnvAdminKey(providerId);
}

export function getAdminSharedKeyMetadata(providerId: ProviderId): {
  configured: boolean;
  source: 'vault' | 'env' | null;
  status: ConnectionStatus;
  keyFingerprint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
  availableModelsCount: number;
} {
  const store = loadAdminSharedKeys();
  const rec = store[providerId];
  if (rec && rec.status === 'connected') {
    return {
      configured: true,
      source: 'vault',
      status: rec.status,
      keyFingerprint: rec.keyFingerprint,
      verifiedAt: rec.verifiedAt,
      lastError: rec.lastError || null,
      availableModelsCount: rec.availableModelsCount || 0,
    };
  }
  const envKey = getEnvAdminKey(providerId);
  if (envKey) {
    return {
      configured: true,
      source: 'env',
      status: 'connected',
      keyFingerprint: `Admin Env (${createKeyFingerprint(envKey)})`,
      verifiedAt: null,
      lastError: null,
      availableModelsCount: 0,
    };
  }
  return {
    configured: false,
    source: null,
    status: rec?.status || 'disconnected',
    keyFingerprint: rec?.keyFingerprint || null,
    verifiedAt: rec?.verifiedAt || null,
    lastError: rec?.lastError || null,
    availableModelsCount: rec?.availableModelsCount || 0,
  };
}

export function saveAdminSharedApiKey(params: {
  providerId: ProviderId;
  apiKey?: string;
  availableModelsCount: number;
  status?: ConnectionStatus;
  lastError?: string;
  updatedBy: string;
}): AdminSharedKeyRecord {
  const store = loadAdminSharedKeys();
  const existing = store[params.providerId];
  const nowIso = new Date().toISOString();

  let envelope = existing
    ? { encryptedKey: existing.encryptedKey, iv: existing.iv, authTag: existing.authTag }
    : { encryptedKey: '', iv: '', authTag: '' };
  let fingerprint = existing?.keyFingerprint || 'Admin Managed';

  if (params.apiKey && params.apiKey.trim()) {
    const clean = params.apiKey.trim();
    envelope = encryptApiKey(clean);
    fingerprint = createKeyFingerprint(clean);
  }

  const record: AdminSharedKeyRecord = {
    providerId: params.providerId,
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
    updatedBy: params.updatedBy,
  };

  store[params.providerId] = record;
  writeJsonFile(ADMIN_KEYS_FILE, store);
  clearProviderCatalogForAllUsers(params.providerId);
  return record;
}

export function deleteAdminSharedApiKey(providerId: ProviderId): void {
  const store = loadAdminSharedKeys();
  if (store[providerId]) {
    delete store[providerId];
    writeJsonFile(ADMIN_KEYS_FILE, store);
  }
  clearProviderCatalogForAllUsers(providerId);
}

export function getAdminSharedSummaries(): ProviderConnectionSummary[] {
  return PROVIDER_IDS.map((pid) => {
    const meta = PROVIDER_REGISTRY[pid];
    const info = getAdminSharedKeyMetadata(pid);
    return {
      providerId: pid,
      providerName: meta.name,
      method: info.configured ? 'admin_shared' : null,
      status: info.status,
      healthState: info.status === 'connected' ? 'verified' : info.status === 'error' ? 'invalid_credentials' : 'disconnected',
      healthMessage: info.lastError,
      keyFingerprint: info.keyFingerprint,
      verifiedAt: info.verifiedAt,
      lastError: info.lastError,
      availableModelsCount: info.availableModelsCount,
      discoveredModelsCount: info.availableModelsCount,
      oauthSupported: meta.oauthSupported,
      oauthNote: meta.oauthNote,
      workspaceKeyAvailable: false,
      isAdminManaged: true,
    };
  });
}

function isFutureIso(iso?: string): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && ms > Date.now();
}

async function fetchFirestoreSubscriptionDoc(
  uid: string,
  idToken: string,
): Promise<UserSubscriptionDoc | null> {
  if (!idToken) return null;
  try {
    const cfg = getFirebaseServerConfig();
    const dbId = cfg.firestoreDatabaseId || '(default)';
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(dbId)}/documents/subscriptions/${encodeURIComponent(uid)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as { fields?: Record<string, Record<string, string>> };
    const f = raw.fields;
    if (!f) return null;
    const str = (k: string) => String(f[k]?.stringValue || '');
    const tier = str('tier') === 'premium' ? 'premium' : 'free';
    return {
      uid: str('uid') || uid,
      email: str('email'),
      tier,
      cycle: (str('cycle') as SubscriptionCycle) || undefined,
      paymentMethod: (str('paymentMethod') as PaymentMethod) || undefined,
      paymentId: str('paymentId') || undefined,
      activatedAt: str('activatedAt') || undefined,
      expiresAt: str('expiresAt') || undefined,
      updatedAt: str('updatedAt') || '',
      updatedBy: str('updatedBy') || undefined,
    };
  } catch {
    return null;
  }
}

export async function getEffectiveSubscription(
  uid: string,
  idToken: string,
  email?: string,
): Promise<EffectiveSubscriptionInfo> {
  const isAdmin = isAdminEmail(email);
  const localStore = readJsonFile<SubscriptionStore>(SUBSCRIPTIONS_FILE, {});
  const localSub = localStore[uid] || null;
  const remoteSub = await fetchFirestoreSubscriptionDoc(uid, idToken);

  const candidates = [localSub, remoteSub].filter(
    (s): s is UserSubscriptionDoc => Boolean(s && s.tier === 'premium' && isFutureIso(s.expiresAt)),
  );
  candidates.sort((a, b) => Date.parse(b.expiresAt || '0') - Date.parse(a.expiresAt || '0'));
  const best = candidates[0] || null;

  if (best) {
    return {
      tier: 'premium',
      active: true,
      cycle: best.cycle,
      paymentMethod: best.paymentMethod,
      paymentId: best.paymentId,
      activatedAt: best.activatedAt,
      expiresAt: best.expiresAt,
      isAdminAccount: isAdmin,
    };
  }

  if (isAdmin) {
    return {
      tier: 'premium',
      active: true,
      isAdminAccount: true,
    };
  }

  return {
    tier: 'free',
    active: false,
    isAdminAccount: false,
  };
}

export function grantPremiumSubscription(params: {
  uid: string;
  email: string;
  cycle: SubscriptionCycle;
  paymentMethod: PaymentMethod;
  paymentId: string;
  updatedBy?: string;
}): UserSubscriptionDoc {
  const store = readJsonFile<SubscriptionStore>(SUBSCRIPTIONS_FILE, {});
  const existing = store[params.uid];
  const plan = getPremiumPlan(params.cycle);
  const nowMs = Date.now();
  const baseMs =
    existing && existing.tier === 'premium' && existing.expiresAt && Date.parse(existing.expiresAt) > nowMs
      ? Date.parse(existing.expiresAt)
      : nowMs;

  const expiresAt = new Date(baseMs + plan.durationDays * 86_400_000).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const doc: UserSubscriptionDoc = {
    uid: params.uid,
    email: params.email,
    tier: 'premium',
    cycle: plan.cycle,
    paymentMethod: params.paymentMethod,
    paymentId: params.paymentId,
    activatedAt: existing?.activatedAt && Date.parse(existing.expiresAt || '0') > nowMs ? existing.activatedAt : nowIso,
    expiresAt,
    updatedAt: nowIso,
    updatedBy: params.updatedBy || 'system',
  };

  store[params.uid] = doc;
  writeJsonFile(SUBSCRIPTIONS_FILE, store);
  clearProviderCatalogForAllUsers();
  return doc;
}

export function revokePremiumSubscription(uid: string): void {
  const store = readJsonFile<SubscriptionStore>(SUBSCRIPTIONS_FILE, {});
  if (store[uid]) {
    store[uid] = {
      ...store[uid],
      tier: 'free',
      updatedAt: new Date().toISOString(),
    };
    writeJsonFile(SUBSCRIPTIONS_FILE, store);
    clearProviderCatalogForAllUsers();
  }
}

export function listActiveSubscriptions(): UserSubscriptionDoc[] {
  const store = readJsonFile<SubscriptionStore>(SUBSCRIPTIONS_FILE, {});
  return Object.values(store).sort(
    (a, b) => Date.parse(b.updatedAt || '0') - Date.parse(a.updatedAt || '0'),
  );
}
