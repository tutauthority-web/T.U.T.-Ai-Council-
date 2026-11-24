import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import { createKeyFingerprint, redactSensitiveText } from './crypto.ts';
import { grantPremiumSubscription } from './subscriptions.ts';
import {
  getPremiumPlan,
  TUT_HOSTED_CHECKOUT_URL,
  TUT_MERCHANT_NAME,
  type GatewayCheckoutOrder,
  type MlaMemberInfo,
  type PaymentMethod,
  type PaymentSubmissionDoc,
  type SubscriptionCycle,
  type TutWalletWebConfig,
  type UserSubscriptionDoc,
} from '../src/shared/types.ts';

export interface MlaConfig {
  projectId: string;
  firestoreDatabaseId: string;
  membersCollection: string;
  emailField: string;
  balanceField: string;
  accountNumberField: string;
  displayNameField: string;
  apiKey: string;
  authDomain: string;
  appId: string;
  storageBucket: string;
  messagingSenderId: string;
  checkoutUrl: string;
  verifyReceiptUrl: string;
  gatewayUrl: string;
  configured: boolean;
  hasApiKey?: boolean;
  apiKeyPreview?: string | null;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const GATEWAY_ORDERS_FILE = path.join(DATA_DIR, 'gateway-orders.json');
const MLA_CONFIG_FILE = path.join(DATA_DIR, 'mla-config.json');

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readPayments(): PaymentSubmissionDoc[] {
  try {
    if (!fs.existsSync(PAYMENTS_FILE)) return [];
    const raw = fs.readFileSync(PAYMENTS_FILE, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PaymentSubmissionDoc[]) : [];
  } catch {
    return [];
  }
}

function writePayments(list: PaymentSubmissionDoc[]): void {
  ensureDataDir();
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
}

function isBlockedPrivateHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || h === '0.0.0.0') {
    return true;
  }
  const m172 = /^172\.(\d+)\./.exec(h);
  if (m172) {
    const oct2 = Number(m172[1]);
    if (oct2 >= 16 && oct2 <= 31) return true;
  }
  return false;
}

function normalizeSafeGatewayUrl(rawUrl: string, fallbackUrl?: string): string {
  const candidate = rawUrl.trim() || fallbackUrl || TUT_HOSTED_CHECKOUT_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Enter a valid http:// or https:// URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Gateway URL must use http:// or https://.');
  }
  if (isBlockedPrivateHost(parsed.hostname)) {
    throw new Error('Private or loopback hostnames are not permitted for gateway URLs.');
  }
  if (parsed.protocol === 'http:' && parsed.hostname.endsWith('.run.app')) {
    parsed.protocol = 'https:';
  }
  return parsed.toString();
}

function defaultVerifyUrlForCheckout(checkoutUrl: string): string {
  try {
    return `${new URL(checkoutUrl).origin}/api/gateway/verify-receipt`;
  } catch {
    return `${new URL(TUT_HOSTED_CHECKOUT_URL).origin}/api/gateway/verify-receipt`;
  }
}

export function getMlaConfig(): MlaConfig {
  let fileCfg: Partial<MlaConfig> = {};
  try {
    if (fs.existsSync(MLA_CONFIG_FILE)) {
      fileCfg = JSON.parse(fs.readFileSync(MLA_CONFIG_FILE, 'utf8')) as Partial<MlaConfig>;
    }
  } catch {
    fileCfg = {};
  }

  const projectId = (
    process.env.TUT_FIREBASE_PROJECT_ID ||
    process.env.MLA_FIREBASE_PROJECT_ID ||
    fileCfg.projectId ||
    ''
  ).trim();
  const firestoreDatabaseId = (
    process.env.TUT_FIREBASE_DATABASE_ID ||
    process.env.MLA_FIRESTORE_DATABASE_ID ||
    fileCfg.firestoreDatabaseId ||
    '(default)'
  ).trim();
  const membersCollection = (
    process.env.MLA_MEMBERS_COLLECTION ||
    fileCfg.membersCollection ||
    'members'
  ).trim();
  const emailField = (process.env.MLA_EMAIL_FIELD || fileCfg.emailField || 'email').trim();
  const balanceField = (process.env.MLA_BALANCE_FIELD || fileCfg.balanceField || 'balance').trim();
  const accountNumberField = (fileCfg.accountNumberField || 'accountNumber').trim();
  const displayNameField = (fileCfg.displayNameField || 'displayName').trim();
  const apiKey = (process.env.TUT_FIREBASE_API_KEY || fileCfg.apiKey || '').trim();
  const authDomain = (
    process.env.TUT_FIREBASE_AUTH_DOMAIN ||
    fileCfg.authDomain ||
    (projectId ? `${projectId}.firebaseapp.com` : '')
  ).trim();
  const appId = (process.env.TUT_FIREBASE_APP_ID || fileCfg.appId || '').trim();
  const storageBucket = (
    process.env.TUT_FIREBASE_STORAGE_BUCKET ||
    fileCfg.storageBucket ||
    (projectId ? `${projectId}.firebasestorage.app` : '')
  ).trim();
  const messagingSenderId = (
    process.env.TUT_FIREBASE_MESSAGING_SENDER_ID ||
    fileCfg.messagingSenderId ||
    ''
  ).trim();

  const rawCheckoutUrl = (
    process.env.TUT_PAYMENT_CHECKOUT_URL ||
    process.env.TUT_GATEWAY_URL ||
    fileCfg.checkoutUrl ||
    fileCfg.gatewayUrl ||
    TUT_HOSTED_CHECKOUT_URL
  ).trim();
  let checkoutUrl = TUT_HOSTED_CHECKOUT_URL;
  try {
    checkoutUrl = normalizeSafeGatewayUrl(rawCheckoutUrl, TUT_HOSTED_CHECKOUT_URL);
  } catch {
    checkoutUrl = TUT_HOSTED_CHECKOUT_URL;
  }

  const rawVerifyUrl = (
    process.env.TUT_VERIFY_RECEIPT_URL ||
    fileCfg.verifyReceiptUrl ||
    defaultVerifyUrlForCheckout(checkoutUrl)
  ).trim();
  let verifyReceiptUrl = defaultVerifyUrlForCheckout(checkoutUrl);
  try {
    verifyReceiptUrl = normalizeSafeGatewayUrl(rawVerifyUrl, defaultVerifyUrlForCheckout(checkoutUrl));
  } catch {
    verifyReceiptUrl = defaultVerifyUrlForCheckout(checkoutUrl);
  }

  return {
    projectId,
    firestoreDatabaseId,
    membersCollection,
    emailField,
    balanceField,
    accountNumberField,
    displayNameField,
    apiKey,
    authDomain,
    appId,
    storageBucket,
    messagingSenderId,
    checkoutUrl,
    verifyReceiptUrl,
    gatewayUrl: checkoutUrl,
    configured: Boolean(projectId),
  };
}

export function getSafeMlaConfigForAdmin(): MlaConfig {
  const cfg = getMlaConfig();
  return {
    ...cfg,
    apiKey: '',
    hasApiKey: Boolean(cfg.apiKey),
    apiKeyPreview: cfg.apiKey ? createKeyFingerprint(cfg.apiKey) : null,
  };
}

export function getPublicWalletClientConfig(): {
  checkoutUrl: string;
  verifyReceiptUrl: string;
  mlaConfigured: boolean;
  walletFirebaseConfig: TutWalletWebConfig | null;
} {
  const cfg = getMlaConfig();
  const walletFirebaseConfig =
    cfg.projectId && cfg.apiKey && cfg.authDomain && cfg.appId
      ? {
          projectId: cfg.projectId,
          firestoreDatabaseId: cfg.firestoreDatabaseId || '(default)',
          apiKey: cfg.apiKey,
          authDomain: cfg.authDomain,
          appId: cfg.appId,
          storageBucket: cfg.storageBucket || undefined,
          messagingSenderId: cfg.messagingSenderId || undefined,
        }
      : null;

  return {
    checkoutUrl: cfg.checkoutUrl,
    verifyReceiptUrl: cfg.verifyReceiptUrl,
    mlaConfigured: cfg.configured,
    walletFirebaseConfig,
  };
}

export function saveMlaConfig(input: Partial<MlaConfig>): MlaConfig {
  const current = getMlaConfig();
  const rawCheckout = (
    input.checkoutUrl !== undefined
      ? input.checkoutUrl
      : input.gatewayUrl !== undefined
        ? input.gatewayUrl
        : current.checkoutUrl
  ).trim();
  const validatedCheckoutUrl = normalizeSafeGatewayUrl(
    rawCheckout || TUT_HOSTED_CHECKOUT_URL,
    TUT_HOSTED_CHECKOUT_URL,
  );

  const rawVerify = (
    input.verifyReceiptUrl !== undefined ? input.verifyReceiptUrl : current.verifyReceiptUrl
  ).trim();
  const validatedVerifyUrl = normalizeSafeGatewayUrl(
    rawVerify || defaultVerifyUrlForCheckout(validatedCheckoutUrl),
    defaultVerifyUrlForCheckout(validatedCheckoutUrl),
  );

  const nextProjectId = (
    input.projectId !== undefined ? input.projectId : current.projectId
  ).trim();

  const nextApiKey =
    input.apiKey !== undefined && input.apiKey.trim() ? input.apiKey.trim() : current.apiKey;

  const next: Omit<
    MlaConfig,
    'configured' | 'hasApiKey' | 'apiKeyPreview'
  > = {
    projectId: nextProjectId,
    firestoreDatabaseId:
      (input.firestoreDatabaseId !== undefined
        ? input.firestoreDatabaseId
        : current.firestoreDatabaseId
      ).trim() || '(default)',
    membersCollection:
      (input.membersCollection !== undefined
        ? input.membersCollection
        : current.membersCollection
      ).trim() || 'members',
    emailField:
      (input.emailField !== undefined ? input.emailField : current.emailField).trim() || 'email',
    balanceField:
      (input.balanceField !== undefined ? input.balanceField : current.balanceField).trim() ||
      'balance',
    accountNumberField:
      (input.accountNumberField !== undefined
        ? input.accountNumberField
        : current.accountNumberField
      ).trim() || 'accountNumber',
    displayNameField:
      (input.displayNameField !== undefined
        ? input.displayNameField
        : current.displayNameField
      ).trim() || 'displayName',
    apiKey: nextApiKey,
    authDomain: (
      input.authDomain !== undefined ? input.authDomain : current.authDomain
    ).trim(),
    appId: (input.appId !== undefined ? input.appId : current.appId).trim(),
    storageBucket: (
      input.storageBucket !== undefined ? input.storageBucket : current.storageBucket
    ).trim(),
    messagingSenderId: (
      input.messagingSenderId !== undefined ? input.messagingSenderId : current.messagingSenderId
    ).trim(),
    checkoutUrl: validatedCheckoutUrl,
    verifyReceiptUrl: validatedVerifyUrl,
    gatewayUrl: validatedCheckoutUrl,
  };
  ensureDataDir();
  fs.writeFileSync(MLA_CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return getSafeMlaConfigForAdmin();
}

type FirestoreFieldValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
};

function readStringField(
  fields: Record<string, FirestoreFieldValue>,
  candidates: string[],
  fallback = '',
): string {
  for (const key of candidates) {
    const val = fields[key]?.stringValue;
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return fallback;
}

function readNumberField(
  fields: Record<string, FirestoreFieldValue>,
  candidates: string[],
): { fieldName: string; value: number; isInteger: boolean } | null {
  for (const key of candidates) {
    const f = fields[key];
    if (!f) continue;
    if (typeof f.doubleValue === 'number' && Number.isFinite(f.doubleValue)) {
      return { fieldName: key, value: f.doubleValue, isInteger: false };
    }
    if (typeof f.integerValue === 'string' && /^-?\d+$/.test(f.integerValue)) {
      return { fieldName: key, value: Number(f.integerValue), isInteger: true };
    }
  }
  return null;
}

async function verifyTutWalletIdToken(
  tutWalletIdToken: string,
  expectedEmail: string,
  apiKey: string,
): Promise<string | null> {
  const cleanToken = tutWalletIdToken.trim();
  if (!cleanToken || !apiKey) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: cleanToken }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{ email?: string; emailVerified?: boolean }>;
    };
    const match = data.users?.[0];
    if (!match?.email) return null;
    if (match.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
      return null;
    }
    return cleanToken;
  } catch {
    return null;
  }
}

async function getMlaAuthToken(params: {
  cfg: MlaConfig;
  expectedEmail: string;
  userIdToken?: string;
  tutWalletIdToken?: string;
}): Promise<string | null> {
  if (params.tutWalletIdToken && params.cfg.apiKey) {
    const verifiedWalletToken = await verifyTutWalletIdToken(
      params.tutWalletIdToken,
      params.expectedEmail,
      params.cfg.apiKey,
    );
    if (verifiedWalletToken) return verifiedWalletToken;
  }

  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/datastore'],
    });
    const client = await auth.getClient();
    const tokenRes = await client.getAccessToken();
    if (tokenRes?.token) return tokenRes.token;
  } catch {
    // Fall back to user ID token or Firebase Web API key query
  }
  return params.userIdToken || null;
}

async function runMlaMemberQuery(params: {
  cfg: MlaConfig;
  token: string | null;
  collectionId: string;
  fieldPath: string;
  email: string;
}): Promise<{
  ok: boolean;
  status: number;
  errorText?: string;
  docName?: string;
  updateTime?: string;
  fields?: Record<string, FirestoreFieldValue>;
}> {
  const keyParam = params.cfg.apiKey ? `?key=${encodeURIComponent(params.cfg.apiKey)}` : '';
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(params.cfg.projectId)}/databases/${encodeURIComponent(params.cfg.firestoreDatabaseId)}/documents`;

  const doFetch = async (authBearer: string | null) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authBearer) {
      headers.Authorization = `Bearer ${authBearer}`;
    }
    return fetch(`${baseUrl}:runQuery${keyParam}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: params.collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath: params.fieldPath },
              op: 'EQUAL',
              value: { stringValue: params.email },
            },
          },
          limit: 1,
        },
      }),
      signal: AbortSignal.timeout(6000),
    });
  };

  let res = await doFetch(params.token);
  // If Bearer token came from another Firebase project and was rejected, retry using API key alone
  if ((res.status === 401 || res.status === 403) && params.token && params.cfg.apiKey) {
    const keyOnlyRes = await doFetch(null);
    if (keyOnlyRes.ok) {
      res = keyOnlyRes;
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorText: redactSensitiveText(await res.text()),
    };
  }

  const rows = (await res.json()) as Array<{
    document?: {
      name: string;
      updateTime?: string;
      fields?: Record<string, FirestoreFieldValue>;
    };
  }>;
  const hit = rows.find((r) => r.document?.fields);
  if (!hit?.document) {
    return { ok: true, status: 200 };
  }
  return {
    ok: true,
    status: 200,
    docName: hit.document.name,
    updateTime: hit.document.updateTime,
    fields: hit.document.fields,
  };
}

export async function lookupMlaMemberByEmail(
  email: string,
  userIdToken?: string,
  tutWalletIdToken?: string,
): Promise<{
  configured: boolean;
  found: boolean;
  member: MlaMemberInfo | null;
  docName?: string;
  updateTime?: string;
  balanceFieldName?: string;
  balanceIsInteger?: boolean;
  needsWalletSignIn?: boolean;
  error?: string;
}> {
  const cfg = getMlaConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      found: false,
      member: null,
      error:
        'T.U.T. Money Lending Authority Firestore is not linked yet. Ask Admin to configure the MLA Project ID & Database.',
    };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { configured: true, found: false, member: null, error: 'Verified Gmail is required.' };
  }

  const token = await getMlaAuthToken({
    cfg,
    expectedEmail: normalizedEmail,
    userIdToken,
    tutWalletIdToken,
  });
  if (!token && !cfg.apiKey) {
    return {
      configured: true,
      found: false,
      member: null,
      error: 'Authentication token required to query T.U.T. Money Lending Authority Firestore.',
    };
  }

  const collectionsToTry = Array.from(
    new Set([cfg.membersCollection, 'users', 'wallets', 'accounts']),
  );
  const emailFieldsToTry = Array.from(new Set([cfg.emailField, 'email', 'gmail']));
  const emailVariants = Array.from(new Set([normalizedEmail, email.trim()]));

  let lastStatusError: string | undefined;
  let needsWalletSignIn = false;

  for (const collectionId of collectionsToTry) {
    for (const fieldPath of emailFieldsToTry) {
      for (const candidateEmail of emailVariants) {
        const qRes = await runMlaMemberQuery({
          cfg,
          token,
          collectionId,
          fieldPath,
          email: candidateEmail,
        });
        if (!qRes.ok) {
          if (qRes.status === 401 || qRes.status === 403) {
            needsWalletSignIn = !tutWalletIdToken;
            lastStatusError = tutWalletIdToken
              ? 'Access denied by T.U.T. Wallet Firestore security rules for this Gmail.'
              : 'Sign in to your T.U.T. Wallet account to authorize balance sync, or use T.U.T. Hosted Checkout above.';
          } else {
            lastStatusError =
              qRes.status === 404
                ? `MLA database or collection "${collectionId}" was not found.`
                : `MLA lookup error (${qRes.status}).`;
          }
          continue;
        }
        if (qRes.fields && qRes.docName) {
          const balanceInfo = readNumberField(qRes.fields, [
            cfg.balanceField,
            'balanceBdt',
            'balance',
            'availableBalance',
            'walletBalance',
            'amount',
          ]);
          const memberId = qRes.docName.split('/').pop() || normalizedEmail;
          const member: MlaMemberInfo = {
            memberId,
            email: readStringField(qRes.fields, [cfg.emailField, 'email', 'gmail'], candidateEmail),
            displayName: readStringField(
              qRes.fields,
              [cfg.displayNameField, 'displayName', 'name', 'fullName'],
              candidateEmail.split('@')[0],
            ),
            accountNumber:
              readStringField(
                qRes.fields,
                [cfg.accountNumberField, 'accountNumber', 'cardNumber', 'memberCode'],
              ) || undefined,
            cardLabel: readStringField(qRes.fields, ['cardLabel', 'cardType', 'tier']) || 'MLA Member',
            balanceBdt: balanceInfo ? balanceInfo.value : 0,
            status: readStringField(qRes.fields, ['status', 'accountStatus'], 'active'),
            syncedAt: new Date().toISOString(),
          };
          return {
            configured: true,
            found: true,
            member,
            docName: qRes.docName,
            updateTime: qRes.updateTime,
            balanceFieldName: balanceInfo?.fieldName || cfg.balanceField,
            balanceIsInteger: balanceInfo?.isInteger || false,
          };
        }
      }
    }
  }

  return {
    configured: true,
    found: false,
    member: null,
    needsWalletSignIn,
    error: lastStatusError,
  };
}

export async function purchasePremiumWithMla(params: {
  uid: string;
  email: string;
  userName?: string;
  idToken: string;
  tutWalletIdToken?: string;
  cycle: SubscriptionCycle;
}): Promise<{
  payment: PaymentSubmissionDoc;
  subscription: UserSubscriptionDoc;
  updatedBalanceBdt: number;
}> {
  const cfg = getMlaConfig();
  const plan = getPremiumPlan(params.cycle);
  const lookup = await lookupMlaMemberByEmail(
    params.email,
    params.idToken,
    params.tutWalletIdToken,
  );

  if (!lookup.configured) {
    throw new Error(lookup.error || 'T.U.T. Money Lending Authority Firestore is not linked.');
  }
  if (!lookup.found || !lookup.member || !lookup.docName) {
    throw new Error(
      lookup.error ||
        `No T.U.T. Money Lending Authority member account matches ${params.email}.`,
    );
  }
  if (lookup.member.status.toLowerCase() === 'suspended' || lookup.member.status.toLowerCase() === 'blocked') {
    throw new Error('Your T.U.T. Money Lending Authority account is currently inactive.');
  }
  if (lookup.member.balanceBdt < plan.priceBdt) {
    throw new Error(
      `Insufficient MLA balance: ${lookup.member.balanceBdt} Taka available, ${plan.priceBdt} Taka required for ${plan.label}.`,
    );
  }

  const token = await getMlaAuthToken({
    cfg,
    expectedEmail: params.email,
    userIdToken: params.idToken,
    tutWalletIdToken: params.tutWalletIdToken,
  });
  if (!token && !cfg.apiKey) {
    throw new Error('Missing authorization token to complete MLA payment.');
  }

  const nextBalance = Number((lookup.member.balanceBdt - plan.priceBdt).toFixed(2));
  const fieldName = lookup.balanceFieldName || 'balance';
  const patchParams = new URLSearchParams();
  patchParams.append('updateMask.fieldPaths', fieldName);
  if (lookup.updateTime) {
    patchParams.set('currentDocument.updateTime', lookup.updateTime);
  }
  if (cfg.apiKey) {
    patchParams.set('key', cfg.apiKey);
  }

  const patchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    patchHeaders.Authorization = `Bearer ${token}`;
  }

  const patchRes = await fetch(
    `https://firestore.googleapis.com/v1/${lookup.docName}?${patchParams.toString()}`,
    {
      method: 'PATCH',
      headers: patchHeaders,
      body: JSON.stringify({
        fields: {
          [fieldName]: lookup.balanceIsInteger && Number.isInteger(nextBalance)
            ? { integerValue: String(nextBalance) }
            : { doubleValue: nextBalance },
        },
      }),
      signal: AbortSignal.timeout(6000),
    },
  );

  if (!patchRes.ok) {
    if (patchRes.status === 409 || patchRes.status === 412) {
      throw new Error('MLA account balance changed during checkout. Please sync and retry.');
    }
    if (patchRes.status === 403 || patchRes.status === 401) {
      throw new Error(
        'MLA Firestore rejected direct balance deduction. Please use T.U.T. Hosted Checkout for instant settlement.',
      );
    }
    throw new Error(`MLA balance deduction failed (${patchRes.status}).`);
  }

  const nowIso = new Date().toISOString();
  const paymentId = `pay_mla_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const payment: PaymentSubmissionDoc = {
    id: paymentId,
    userId: params.uid,
    userEmail: params.email,
    userName: params.userName,
    method: 'mla',
    cycle: plan.cycle,
    amountBdt: plan.priceBdt,
    trxId: `MLA-${lookup.member.memberId.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
    senderNumber: lookup.member.accountNumber,
    status: 'approved',
    reviewNote: `Instant settlement via T.U.T. MLA (${lookup.member.displayName})`,
    createdAt: nowIso,
    updatedAt: nowIso,
    reviewedBy: 'mla_auto_settlement',
  };

  const all = readPayments();
  all.unshift(payment);
  writePayments(all);

  const subscription = grantPremiumSubscription({
    uid: params.uid,
    email: params.email,
    cycle: plan.cycle,
    paymentMethod: 'mla',
    paymentId,
    updatedBy: 'mla_auto_settlement',
  });

  return {
    payment,
    subscription,
    updatedBalanceBdt: nextBalance,
  };
}

export function submitManualWalletPayment(params: {
  uid: string;
  email: string;
  userName?: string;
  method: Exclude<PaymentMethod, 'mla'>;
  cycle: SubscriptionCycle;
  trxId: string;
  senderNumber?: string;
}): PaymentSubmissionDoc {
  const cleanTrx = params.trxId.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,24}$/.test(cleanTrx)) {
    throw new Error('Enter a valid 6–24 character alphanumeric Transaction ID (TrxID).');
  }

  const cleanSender = params.senderNumber?.replace(/[\s\-()]/g, '').trim() || undefined;
  if (cleanSender && !/^\+?\d{8,16}$/.test(cleanSender)) {
    throw new Error('Enter a valid sender mobile number or leave it blank.');
  }

  const all = readPayments();
  const duplicate = all.find(
    (p) => p.trxId.toUpperCase() === cleanTrx && p.status !== 'rejected',
  );
  if (duplicate) {
    throw new Error(`Transaction ID ${cleanTrx} has already been submitted.`);
  }

  const plan = getPremiumPlan(params.cycle);
  const nowIso = new Date().toISOString();
  const payment: PaymentSubmissionDoc = {
    id: `pay_${params.method}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
    userId: params.uid,
    userEmail: params.email,
    userName: params.userName,
    method: params.method,
    cycle: plan.cycle,
    amountBdt: plan.priceBdt,
    trxId: cleanTrx,
    senderNumber: cleanSender,
    status: 'pending',
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  all.unshift(payment);
  writePayments(all);
  return payment;
}

export function listUserPayments(uid: string): PaymentSubmissionDoc[] {
  return readPayments().filter((p) => p.userId === uid);
}

export function listAllPayments(): PaymentSubmissionDoc[] {
  return readPayments();
}

export function reviewManualPayment(params: {
  paymentId: string;
  approve: boolean;
  reviewNote?: string;
  adminEmail: string;
}): { payment: PaymentSubmissionDoc; subscription?: UserSubscriptionDoc } {
  const all = readPayments();
  const idx = all.findIndex((p) => p.id === params.paymentId);
  if (idx === -1) {
    throw new Error('Payment submission not found.');
  }

  const target = all[idx];
  if (target.status === 'approved' && params.approve) {
    throw new Error('Payment submission is already approved.');
  }

  const nowIso = new Date().toISOString();
  const updated: PaymentSubmissionDoc = {
    ...target,
    status: params.approve ? 'approved' : 'rejected',
    reviewNote: params.reviewNote?.trim() || (params.approve ? 'Verified by Admin' : 'Transaction not found'),
    updatedAt: nowIso,
    reviewedBy: params.adminEmail,
  };
  all[idx] = updated;
  writePayments(all);

  if (params.approve) {
    const subscription = grantPremiumSubscription({
      uid: target.userId,
      email: target.userEmail,
      cycle: target.cycle,
      paymentMethod: target.method,
      paymentId: target.id,
      updatedBy: params.adminEmail,
    });
    return { payment: updated, subscription };
  }

  return { payment: updated };
}

function readGatewayOrders(): GatewayCheckoutOrder[] {
  try {
    if (!fs.existsSync(GATEWAY_ORDERS_FILE)) return [];
    const raw = fs.readFileSync(GATEWAY_ORDERS_FILE, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GatewayCheckoutOrder[]) : [];
  } catch {
    return [];
  }
}

function writeGatewayOrders(orders: GatewayCheckoutOrder[]): void {
  ensureDataDir();
  fs.writeFileSync(GATEWAY_ORDERS_FILE, JSON.stringify(orders.slice(0, 500), null, 2), {
    mode: 0o600,
  });
}

export function listUserGatewayOrders(uid: string): GatewayCheckoutOrder[] {
  return readGatewayOrders().filter((o) => o.uid === uid);
}

export function listAllGatewayOrders(): GatewayCheckoutOrder[] {
  return readGatewayOrders();
}

export function createTutGatewayOrder(params: {
  uid: string;
  email: string;
  cycle: SubscriptionCycle;
  returnUrl: string;
}): { order: GatewayCheckoutOrder; checkoutUrl: string } {
  const plan = getPremiumPlan(params.cycle);
  const orderId = `ORD-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const order: GatewayCheckoutOrder = {
    orderId,
    uid: params.uid,
    email: params.email,
    cycle: plan.cycle,
    amountBdt: plan.priceBdt,
    merchant: TUT_MERCHANT_NAME,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const orders = readGatewayOrders();
  orders.unshift(order);
  writeGatewayOrders(orders);

  const cfg = getMlaConfig();
  const baseUrl = cfg.checkoutUrl || TUT_HOSTED_CHECKOUT_URL;
  const checkoutUrl = new URL(baseUrl);
  checkoutUrl.searchParams.set('tut_pay', '1');
  checkoutUrl.searchParams.set('amount', String(plan.priceBdt));
  checkoutUrl.searchParams.set('merchant', TUT_MERCHANT_NAME);
  checkoutUrl.searchParams.set('orderId', orderId);
  checkoutUrl.searchParams.set('returnUrl', params.returnUrl);

  return { order, checkoutUrl: checkoutUrl.toString() };
}

export async function verifyTutGatewayReturn(params: {
  uid: string;
  email: string;
  userName?: string;
  orderId?: string;
  returnParams: Record<string, string>;
}): Promise<{
  verified: boolean;
  proxyBlocked?: boolean;
  order?: GatewayCheckoutOrder;
  payment?: PaymentSubmissionDoc;
  subscription?: UserSubscriptionDoc;
  error?: string;
}> {
  const returnOrderId = (
    params.orderId ||
    params.returnParams.orderId ||
    params.returnParams.order_id ||
    ''
  ).trim();
  if (!returnOrderId) {
    throw new Error('Missing orderId from T.U.T. checkout return.');
  }

  const orders = readGatewayOrders();
  const idx = orders.findIndex((o) => o.orderId === returnOrderId && o.uid === params.uid);
  if (idx === -1) {
    throw new Error(`Order ${returnOrderId} was not found for your account.`);
  }

  const order = orders[idx];
  if (order.status === 'verified') {
    const existingPayment = readPayments().find((p) => p.trxId === order.receiptRef || p.id === `pay_gw_${order.orderId}`);
    const subscription = grantPremiumSubscription({
      uid: order.uid,
      email: order.email,
      cycle: order.cycle,
      paymentMethod: 'mla',
      paymentId: existingPayment?.id || `pay_gw_${order.orderId}`,
      updatedBy: 'tut_gateway_verified',
    });
    return {
      verified: true,
      order,
      payment: existingPayment,
      subscription,
    };
  }

  const statusSignal = String(
    params.returnParams.tut_status ||
      params.returnParams.status ||
      params.returnParams.payment_status ||
      '',
  )
    .trim()
    .toLowerCase();

  if (['cancelled', 'canceled', 'failed', 'declined', 'rejected'].includes(statusSignal)) {
    orders[idx] = { ...order, status: 'failed' };
    writeGatewayOrders(orders);
    throw new Error(`T.U.T. Hosted Checkout returned status "${statusSignal}". No charge was applied.`);
  }

  const receiptCandidate = (
    params.returnParams.receipt ||
    params.returnParams.receiptId ||
    params.returnParams.trxId ||
    params.returnParams.transactionId ||
    params.returnParams.proof ||
    params.returnParams.token ||
    ''
  ).trim();

  const cfg = getMlaConfig();
  const verifyEndpoint =
    cfg.verifyReceiptUrl || defaultVerifyUrlForCheckout(cfg.checkoutUrl || TUT_HOSTED_CHECKOUT_URL);

  const verifyPayload = {
    orderId: order.orderId,
    amount: order.amountBdt,
    merchant: order.merchant,
    receipt: receiptCandidate || undefined,
    receiptId: params.returnParams.receiptId || receiptCandidate || undefined,
    trxId: params.returnParams.trxId || params.returnParams.transactionId || receiptCandidate || undefined,
    transactionId: params.returnParams.transactionId || params.returnParams.trxId || undefined,
    token: params.returnParams.token || undefined,
    proof: params.returnParams.proof || params.returnParams.signature || receiptCandidate || undefined,
    signature: params.returnParams.signature || undefined,
    params: params.returnParams,
  };

  let verifyRes: globalThis.Response;
  try {
    verifyRes = await fetch(verifyEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(verifyPayload),
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });

    // Follow a safe same-host HTTP->HTTPS redirect cleanly
    if (verifyRes.status === 301 || verifyRes.status === 307 || verifyRes.status === 308) {
      const loc = verifyRes.headers.get('location') || '';
      if (loc) {
        const target = new URL(loc, verifyEndpoint);
        const orig = new URL(verifyEndpoint);
        if (target.hostname === orig.hostname && target.protocol === 'https:') {
          verifyRes = await fetch(target.toString(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(verifyPayload),
            redirect: 'manual',
            signal: AbortSignal.timeout(8000),
          });
        }
      }
    }
  } catch (err) {
    return {
      verified: false,
      order,
      error: `Unable to contact T.U.T. receipt verification server: ${redactSensitiveText(
        err instanceof Error ? err.message : String(err),
      )}`,
    };
  }

  const contentType = (verifyRes.headers.get('content-type') || '').toLowerCase();
  if (verifyRes.status === 302 || verifyRes.status === 301 || !contentType.includes('application/json')) {
    return {
      verified: false,
      proxyBlocked: true,
      order,
      error:
        'T.U.T. gateway verify-receipt requires a direct session cookie or returned a non-JSON proxy redirect.',
    };
  }

  const body = (await verifyRes.json().catch(() => ({}))) as Record<string, unknown>;
  const bodyStatus = String(body.status || '').toLowerCase();
  const isExplicitlyInvalid =
    body.verified === false ||
    body.valid === false ||
    body.ok === false ||
    ['failed', 'invalid', 'cancelled', 'canceled', 'rejected'].includes(bodyStatus);

  const isVerified =
    verifyRes.ok &&
    !isExplicitlyInvalid &&
    (body.verified === true ||
      body.valid === true ||
      body.ok === true ||
      body.paid === true ||
      body.success === true ||
      ['paid', 'verified', 'completed', 'success', 'approved'].includes(bodyStatus));

  if (!isVerified) {
    const errMsg =
      typeof body.error === 'string'
        ? body.error
        : typeof body.message === 'string'
          ? body.message
          : 'T.U.T. receipt verification did not confirm payment.';
    if (isExplicitlyInvalid) {
      orders[idx] = { ...order, status: 'failed' };
      writeGatewayOrders(orders);
    }
    return {
      verified: false,
      order,
      error: errMsg,
    };
  }

  const paidAmountRaw = body.amount ?? body.amountBdt ?? body.paidAmount;
  if (paidAmountRaw !== undefined && Number.isFinite(Number(paidAmountRaw))) {
    if (Number(paidAmountRaw) < order.amountBdt) {
      orders[idx] = { ...order, status: 'failed' };
      writeGatewayOrders(orders);
      throw new Error(
        `Verified T.U.T. amount (${paidAmountRaw}৳) is less than required (${order.amountBdt}৳).`,
      );
    }
  }

  const verifiedTrxId = String(
    body.trxId || body.transactionId || body.receiptId || body.receipt || receiptCandidate || order.orderId,
  )
    .trim()
    .toUpperCase();

  const nowIso = new Date().toISOString();
  orders[idx] = {
    ...order,
    status: 'verified',
    verifiedAt: nowIso,
    receiptRef: verifiedTrxId,
  };
  writeGatewayOrders(orders);

  const paymentId = `pay_gw_${order.orderId}`;
  const payment: PaymentSubmissionDoc = {
    id: paymentId,
    userId: order.uid,
    userEmail: order.email,
    userName: params.userName,
    method: 'mla',
    cycle: order.cycle,
    amountBdt: order.amountBdt,
    trxId: verifiedTrxId,
    status: 'approved',
    reviewNote: `Verified via T.U.T. Hosted Checkout (${order.orderId})`,
    createdAt: nowIso,
    updatedAt: nowIso,
    reviewedBy: 'tut_gateway_verify_receipt',
  };

  const allPayments = readPayments();
  allPayments.unshift(payment);
  writePayments(allPayments);

  const subscription = grantPremiumSubscription({
    uid: order.uid,
    email: order.email,
    cycle: order.cycle,
    paymentMethod: 'mla',
    paymentId,
    updatedBy: 'tut_gateway_verify_receipt',
  });

  return {
    verified: true,
    order: orders[idx],
    payment,
    subscription,
  };
}

export function submitPendingGatewayReceipt(params: {
  uid: string;
  email: string;
  userName?: string;
  orderId: string;
  receiptRef?: string;
  note?: string;
}): PaymentSubmissionDoc {
  const cleanOrderId = params.orderId.trim();
  if (!cleanOrderId) {
    throw new Error('Missing T.U.T. Hosted Checkout orderId.');
  }

  const orders = readGatewayOrders();
  const order = orders.find((o) => o.orderId === cleanOrderId && o.uid === params.uid);
  if (!order) {
    throw new Error(`Order ${cleanOrderId} was not found for your account.`);
  }
  if (order.status === 'verified') {
    throw new Error(`Order ${cleanOrderId} has already been verified.`);
  }

  const refCandidate = (params.receiptRef || cleanOrderId).trim().toUpperCase().slice(0, 48);
  const allPayments = readPayments();
  const existing = allPayments.find(
    (p) =>
      p.userId === params.uid &&
      (p.id === `pay_gw_pending_${cleanOrderId}` ||
        (p.trxId.toUpperCase() === refCandidate && p.status !== 'rejected')),
  );
  if (existing) {
    return existing;
  }

  const nowIso = new Date().toISOString();
  const payment: PaymentSubmissionDoc = {
    id: `pay_gw_pending_${cleanOrderId}`,
    userId: params.uid,
    userEmail: params.email,
    userName: params.userName,
    method: 'mla',
    cycle: order.cycle,
    amountBdt: order.amountBdt,
    trxId: refCandidate,
    status: 'pending',
    reviewNote:
      params.note?.trim() ||
      `T.U.T. Hosted Checkout return (${cleanOrderId}) awaiting receipt verification`,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  allPayments.unshift(payment);
  writePayments(allPayments);
  return payment;
}
