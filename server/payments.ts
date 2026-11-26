import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redactSensitiveText } from './crypto.ts';
import { grantPremiumSubscription } from './subscriptions.ts';
import {
  getPremiumPlan,
  TUT_GATEWAY_BASE_URL,
  TUT_MERCHANT_ID,
  TUT_MERCHANT_NAME,
  type GatewayCheckoutOrder,
  type PaymentMethod,
  type PaymentSubmissionDoc,
  type SubscriptionCycle,
  type TutGatewayConfig,
  type UserSubscriptionDoc,
} from '../src/shared/types.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const GATEWAY_ORDERS_FILE = path.join(DATA_DIR, 'gateway-orders.json');
const GATEWAY_CONFIG_FILE = path.join(DATA_DIR, 'gateway-config.json');

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

function isBlockedPrivateHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  if (
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    h === '0.0.0.0'
  ) {
    return true;
  }
  const m172 = /^172\.(\d+)\./.exec(h);
  if (m172) {
    const oct2 = Number(m172[1]);
    if (oct2 >= 16 && oct2 <= 31) return true;
  }
  return false;
}

function normalizeSafeGatewayOrigin(rawUrl: string, fallback = TUT_GATEWAY_BASE_URL): string {
  const candidate = rawUrl.trim() || fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Enter a valid http:// or https:// gateway URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Gateway URL must use http:// or https://.');
  }
  if (isBlockedPrivateHost(parsed.hostname)) {
    throw new Error('Private or loopback hostnames are not permitted for gateway URLs.');
  }
  return parsed.origin;
}

export function getTutGatewayConfig(): TutGatewayConfig {
  let fileCfg: Partial<TutGatewayConfig> = {};
  try {
    if (fs.existsSync(GATEWAY_CONFIG_FILE)) {
      fileCfg = JSON.parse(
        fs.readFileSync(GATEWAY_CONFIG_FILE, 'utf8'),
      ) as Partial<TutGatewayConfig>;
    }
  } catch {
    fileCfg = {};
  }

  const rawBase = (
    process.env.TUT_GATEWAY_BASE_URL ||
    fileCfg.gatewayBaseUrl ||
    TUT_GATEWAY_BASE_URL
  ).trim();

  let gatewayBaseUrl = TUT_GATEWAY_BASE_URL;
  try {
    gatewayBaseUrl = normalizeSafeGatewayOrigin(rawBase, TUT_GATEWAY_BASE_URL);
  } catch {
    gatewayBaseUrl = TUT_GATEWAY_BASE_URL;
  }

  const merchantId = (
    process.env.TUT_MERCHANT_ID ||
    fileCfg.merchantId ||
    TUT_MERCHANT_ID
  )
    .trim()
    .slice(0, 80);

  const merchantName = (
    process.env.TUT_MERCHANT_NAME ||
    fileCfg.merchantName ||
    TUT_MERCHANT_NAME
  )
    .trim()
    .slice(0, 80);

  return {
    gatewayBaseUrl,
    merchantId: merchantId || TUT_MERCHANT_ID,
    merchantName: merchantName || TUT_MERCHANT_NAME,
  };
}

export function saveTutGatewayConfig(input: Partial<TutGatewayConfig>): TutGatewayConfig {
  const current = getTutGatewayConfig();
  const gatewayBaseUrl = normalizeSafeGatewayOrigin(
    input.gatewayBaseUrl !== undefined ? input.gatewayBaseUrl : current.gatewayBaseUrl,
    TUT_GATEWAY_BASE_URL,
  );
  const merchantId = (
    input.merchantId !== undefined ? input.merchantId : current.merchantId
  )
    .trim()
    .slice(0, 80);
  const merchantName = (
    input.merchantName !== undefined ? input.merchantName : current.merchantName
  )
    .trim()
    .slice(0, 80);

  if (!merchantId) {
    throw new Error('Merchant ID cannot be empty.');
  }
  if (!merchantName) {
    throw new Error('Merchant Name cannot be empty.');
  }

  const next: TutGatewayConfig = {
    gatewayBaseUrl,
    merchantId,
    merchantName,
  };
  ensureDataDir();
  fs.writeFileSync(GATEWAY_CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function listUserPayments(uid: string): PaymentSubmissionDoc[] {
  return readPayments().filter((p) => p.userId === uid);
}

export function listAllPayments(): PaymentSubmissionDoc[] {
  return readPayments();
}

export function listUserGatewayOrders(uid: string): GatewayCheckoutOrder[] {
  return readGatewayOrders().filter((o) => o.uid === uid);
}

export function listAllGatewayOrders(): GatewayCheckoutOrder[] {
  return readGatewayOrders();
}

/**
 * Step 1: Create tamper-proof Card Checkout URL via T.U.T. Money Lending Authority Gateway
 * POST /api/gateway/create-session
 */
export async function createTutGatewaySession(params: {
  uid: string;
  email: string;
  cycle: SubscriptionCycle;
  returnUrl: string;
}): Promise<{ order: GatewayCheckoutOrder; checkoutUrl: string }> {
  const cfg = getTutGatewayConfig();
  const plan = getPremiumPlan(params.cycle);
  const orderId = `ORD-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  const order: GatewayCheckoutOrder = {
    orderId,
    uid: params.uid,
    email: params.email,
    cycle: plan.cycle,
    amountBdt: plan.priceBdt,
    merchantId: cfg.merchantId,
    merchantName: cfg.merchantName,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const orders = readGatewayOrders();
  orders.unshift(order);
  writeGatewayOrders(orders);

  const createSessionEndpoint = `${cfg.gatewayBaseUrl}/api/gateway/create-session`;

  let checkoutUrl = '';
  try {
    const sessionRes = await fetch(createSessionEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        amount: plan.priceBdt,
        merchantId: cfg.merchantId,
        merchantName: cfg.merchantName,
        orderId,
        returnUrl: params.returnUrl,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = (await sessionRes.json().catch(() => ({}))) as {
      checkoutUrl?: unknown;
      url?: unknown;
      error?: unknown;
      message?: unknown;
    };

    if (!sessionRes.ok) {
      const errMsg =
        typeof data.error === 'string'
          ? data.error
          : typeof data.message === 'string'
            ? data.message
            : `Gateway session creation failed (${sessionRes.status}).`;
      throw new Error(errMsg);
    }

    const rawCheckout =
      typeof data.checkoutUrl === 'string'
        ? data.checkoutUrl
        : typeof data.url === 'string'
          ? data.url
          : '';

    if (rawCheckout.trim()) {
      const resolved = new URL(rawCheckout.trim(), cfg.gatewayBaseUrl);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        throw new Error('Gateway returned an invalid checkout URL protocol.');
      }
      if (isBlockedPrivateHost(resolved.hostname)) {
        throw new Error('Gateway returned a disallowed checkout host.');
      }
      checkoutUrl = resolved.toString();
    }
  } catch (err) {
    // Re-throw explicit validation errors; otherwise allow /pay query fallback only if network failed
    if (
      err instanceof Error &&
      (err.message.includes('Gateway returned') ||
        err.message.includes('Gateway session creation failed'))
    ) {
      throw err;
    }
    throw new Error(
      `Unable to reach T.U.T. Checkout Gateway: ${redactSensitiveText(
        err instanceof Error ? err.message : String(err),
      )}`,
    );
  }

  if (!checkoutUrl) {
    const payUrl = new URL('/pay', cfg.gatewayBaseUrl);
    payUrl.searchParams.set('amount', String(plan.priceBdt));
    payUrl.searchParams.set('merchantId', cfg.merchantId);
    payUrl.searchParams.set('merchantName', cfg.merchantName);
    payUrl.searchParams.set('orderId', orderId);
    payUrl.searchParams.set('returnUrl', params.returnUrl);
    checkoutUrl = payUrl.toString();
  }

  return { order, checkoutUrl };
}

/**
 * Step 2: Verify ?tut_status=paid&tut_token=... server-side via
 * POST /api/gateway/verify-payment and credit the authenticated user's order safely.
 */
export async function verifyTutGatewayPayment(params: {
  uid: string;
  email: string;
  userName?: string;
  token?: string;
  orderId?: string;
  tutStatus?: string;
}): Promise<{
  verified: boolean;
  order?: GatewayCheckoutOrder;
  payment?: PaymentSubmissionDoc;
  subscription?: UserSubscriptionDoc;
  memoId?: string;
  error?: string;
}> {
  const statusSignal = (params.tutStatus || '').trim().toLowerCase();
  const cleanOrderHint = (params.orderId || '').trim();

  if (['cancelled', 'canceled', 'failed', 'declined', 'rejected'].includes(statusSignal)) {
    if (cleanOrderHint) {
      const orders = readGatewayOrders();
      const idx = orders.findIndex((o) => o.orderId === cleanOrderHint && o.uid === params.uid);
      if (idx !== -1 && orders[idx].status === 'pending') {
        orders[idx] = { ...orders[idx], status: 'failed' };
        writeGatewayOrders(orders);
      }
    }
    throw new Error(
      `T.U.T. Checkout returned status "${statusSignal}". No charge was applied.`,
    );
  }

  const cleanToken = (params.token || '').trim();
  if (!cleanToken || cleanToken.length > 4096) {
    throw new Error('Missing tut_token from T.U.T. Payment Gateway callback.');
  }

  const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
  const existingOrders = readGatewayOrders();

  // Replay guard: check if this exact token was already verified
  const tokenMatch = existingOrders.find(
    (o) => o.tokenHash === tokenHash && o.status === 'verified',
  );
  if (tokenMatch) {
    if (tokenMatch.uid !== params.uid) {
      throw new Error('This T.U.T. payment token has already been redeemed.');
    }
    const existingPayment = readPayments().find((p) => p.id === `pay_gw_${tokenMatch.orderId}`);
    const subscription = grantPremiumSubscription({
      uid: tokenMatch.uid,
      email: tokenMatch.email,
      cycle: tokenMatch.cycle,
      paymentMethod: 'mla',
      paymentId: existingPayment?.id || `pay_gw_${tokenMatch.orderId}`,
      updatedBy: 'tut_gateway_verify_payment',
    });
    return {
      verified: true,
      order: tokenMatch,
      payment: existingPayment,
      subscription,
      memoId: tokenMatch.memoId,
    };
  }

  const cfg = getTutGatewayConfig();
  const verifyEndpoint = `${cfg.gatewayBaseUrl}/api/gateway/verify-payment`;

  let verifyRes: globalThis.Response;
  try {
    verifyRes = await fetch(verifyEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: cleanToken }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new Error(
      `Unable to contact T.U.T. verification server: ${redactSensitiveText(
        err instanceof Error ? err.message : String(err),
      )}`,
    );
  }

  const verified = (await verifyRes.json().catch(() => ({}))) as {
    valid?: boolean;
    status?: string;
    orderId?: string;
    amount?: number | string;
    memoId?: string;
    error?: string;
    message?: string;
  };

  if (!verifyRes.ok || !verified.valid || String(verified.status || '').toLowerCase() !== 'paid') {
    const errMsg =
      typeof verified.error === 'string'
        ? verified.error
        : typeof verified.message === 'string'
          ? verified.message
          : 'T.U.T. Payment Gateway did not confirm a valid paid token.';
    throw new Error(errMsg);
  }

  const verifiedOrderId = String(verified.orderId || cleanOrderHint || '').trim();
  if (!verifiedOrderId) {
    throw new Error('Verified payment response did not include an orderId.');
  }

  const orders = readGatewayOrders();
  const idx = orders.findIndex((o) => o.orderId === verifiedOrderId && o.uid === params.uid);
  if (idx === -1) {
    const belongsToOther = orders.some((o) => o.orderId === verifiedOrderId);
    if (belongsToOther) {
      throw new Error(`Order ${verifiedOrderId} belongs to a different account.`);
    }
    throw new Error(`Order ${verifiedOrderId} was not found for your account.`);
  }

  const order = orders[idx];

  // Idempotent return if this order was already verified for the same user
  if (order.status === 'verified') {
    const existingPayment = readPayments().find((p) => p.id === `pay_gw_${order.orderId}`);
    const subscription = grantPremiumSubscription({
      uid: order.uid,
      email: order.email,
      cycle: order.cycle,
      paymentMethod: 'mla',
      paymentId: existingPayment?.id || `pay_gw_${order.orderId}`,
      updatedBy: 'tut_gateway_verify_payment',
    });
    return {
      verified: true,
      order,
      payment: existingPayment,
      subscription,
      memoId: order.memoId,
    };
  }

  const verifiedAmount = Number(verified.amount);
  if (!Number.isFinite(verifiedAmount) || verifiedAmount < order.amountBdt) {
    orders[idx] = { ...order, status: 'failed' };
    writeGatewayOrders(orders);
    throw new Error(
      `Verified T.U.T. amount (${verified.amount}৳) is less than required (${order.amountBdt}৳).`,
    );
  }

  const memoId = typeof verified.memoId === 'string' ? verified.memoId.trim() : '';
  const refRaw = memoId || verifiedOrderId;
  const normalizedRef = refRaw.toUpperCase().slice(0, 64);

  const nowIso = new Date().toISOString();
  orders[idx] = {
    ...order,
    status: 'verified',
    verifiedAt: nowIso,
    memoId: memoId || undefined,
    receiptRef: normalizedRef,
    tokenHash,
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
    trxId: normalizedRef.length >= 6 ? normalizedRef : verifiedOrderId,
    status: 'approved',
    reviewNote: memoId
      ? `Verified via T.U.T. Card Gateway (${order.orderId} · Memo ${memoId})`
      : `Verified via T.U.T. Card Gateway (${order.orderId})`,
    createdAt: nowIso,
    updatedAt: nowIso,
    reviewedBy: 'tut_gateway_verify_payment',
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
    updatedBy: 'tut_gateway_verify_payment',
  });

  return {
    verified: true,
    order: orders[idx],
    payment,
    subscription,
    memoId: memoId || undefined,
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
    reviewNote:
      params.reviewNote?.trim() || (params.approve ? 'Verified by Admin' : 'Transaction not found'),
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
