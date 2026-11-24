import { auth } from './firebase';
import type {
  CouncilSSEEvent,
  DiscussionMode,
  EffectiveSubscriptionInfo,
  GatewayCheckoutOrder,
  IntelligenceLevel,
  MlaMemberInfo,
  ModelInfo,
  PaymentSubmissionDoc,
  PreflightReport,
  ProviderConnectionSummary,
  ProviderHealthState,
  ProviderId,
  ReplyToRef,
  RunMessageInput,
  SmartSelectResult,
  SubscriptionCycle,
  TutWalletWebConfig,
  UserSubscriptionDoc,
} from '../shared/types';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required.');
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchConnections(): Promise<ProviderConnectionSummary[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/connections', { headers });
  const data = (await res.json()) as { connections?: ProviderConnectionSummary[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load provider connections.');
  }
  return data.connections || [];
}

export async function connectProviderBYOK(
  providerId: ProviderId,
  apiKey: string,
): Promise<{
  ok: boolean;
  healthState?: ProviderHealthState;
  modelsCount?: number;
  error: string | null;
  connections: ProviderConnectionSummary[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/connections/byok', {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId, apiKey }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    healthState?: ProviderHealthState;
    modelsCount?: number;
    connections?: ProviderConnectionSummary[];
    error?: string | null;
  };
  if (!res.ok) {
    throw new Error(data.error || 'API key verification failed.');
  }
  return {
    ok: Boolean(data.ok),
    healthState: data.healthState,
    modelsCount: data.modelsCount,
    error: data.error || null,
    connections: data.connections || [],
  };
}

export async function connectWorkspaceGemini(): Promise<{
  ok: boolean;
  healthState?: ProviderHealthState;
  modelsCount?: number;
  error: string | null;
  connections: ProviderConnectionSummary[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/connections/workspace-gemini', {
    method: 'POST',
    headers,
  });
  const data = (await res.json()) as {
    ok?: boolean;
    healthState?: ProviderHealthState;
    modelsCount?: number;
    connections?: ProviderConnectionSummary[];
    error?: string | null;
  };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to verify workspace Gemini key.');
  }
  return {
    ok: Boolean(data.ok),
    healthState: data.healthState,
    modelsCount: data.modelsCount,
    error: data.error || null,
    connections: data.connections || [],
  };
}

export async function testProviderConnection(
  providerId: ProviderId,
): Promise<{
  ok: boolean;
  healthState?: ProviderHealthState;
  modelsCount?: number;
  error: string | null;
  connections: ProviderConnectionSummary[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/connections/${encodeURIComponent(providerId)}/test`, {
    method: 'POST',
    headers,
  });
  const data = (await res.json()) as {
    ok?: boolean;
    healthState?: ProviderHealthState;
    modelsCount?: number;
    error?: string | null;
    connections?: ProviderConnectionSummary[];
  };
  if (!res.ok && !data.connections) {
    throw new Error(data.error || 'Connection test failed.');
  }
  return {
    ok: Boolean(data.ok),
    healthState: data.healthState,
    modelsCount: data.modelsCount,
    error: data.error || null,
    connections: data.connections || [],
  };
}

export async function disconnectProvider(
  providerId: ProviderId,
): Promise<ProviderConnectionSummary[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/connections/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
    headers,
  });
  const data = (await res.json()) as { connections?: ProviderConnectionSummary[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to disconnect provider.');
  }
  return data.connections || [];
}

export async function fetchDiscoveredModels(forceRefresh = false): Promise<{
  models: ModelInfo[];
  connections?: ProviderConnectionSummary[];
  discoveryErrors: Record<string, string>;
  warnings: string[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/models${forceRefresh ? '?refresh=1' : ''}`, { headers });
  const data = (await res.json()) as {
    models?: ModelInfo[];
    connections?: ProviderConnectionSummary[];
    discoveryErrors?: Record<string, string>;
    warnings?: string[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to retrieve model catalog.');
  }
  return {
    models: data.models || [],
    connections: data.connections,
    discoveryErrors: data.discoveryErrors || {},
    warnings: data.warnings || [],
  };
}

export async function runPreflightApi(
  targetCompositeIds?: string[],
  probeUnverified = false,
): Promise<PreflightReport> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/councils/preflight', {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetCompositeIds, probeUnverified }),
  });
  const data = (await res.json()) as PreflightReport & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Preflight verification failed.');
  }
  return data;
}

export async function smartSelectModelsApi(
  prompt: string,
  mode: DiscussionMode,
  intelligenceLevel: IntelligenceLevel = 'low',
  options?: { freeOnly?: boolean; preferredProviders?: ProviderId[]; seatCount?: number },
): Promise<SmartSelectResult> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/models/smart-select', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      mode,
      intelligenceLevel,
      freeOnly: Boolean(options?.freeOnly),
      preferredProviders: options?.preferredProviders,
      seatCount: options?.seatCount,
    }),
  });
  const data = (await res.json()) as SmartSelectResult & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Smart model selection failed.');
  }
  return data;
}

export async function streamCouncilRun(
  councilId: string,
  payload: {
    mode: DiscussionMode;
    intelligenceLevel?: IntelligenceLevel;
    selectedModels: string[];
    moderatorModel: string;
    maxRounds: number;
    startRound: number;
    priorMessages: RunMessageInput[];
    userPrompt: string;
    userMessageId?: string;
    replyTo?: ReplyToRef;
    moderateOnly?: boolean;
  },
  onEvent: (event: CouncilSSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/councils/${encodeURIComponent(councilId)}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `Council run failed (${res.status}).`);
  }
  if (!res.body) {
    throw new Error('Server did not return an event stream.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr) as CouncilSSEEvent;
        onEvent(parsed);
      } catch {
        // Ignore malformed SSE frame
      }
    }
  }
}

export async function stopCouncilRunApi(councilId: string): Promise<void> {
  const headers = await getAuthHeaders();
  await fetch(`/api/councils/${encodeURIComponent(councilId)}/stop`, {
    method: 'POST',
    headers,
  });
}

// --- Subscription & Payment APIs ---

export async function fetchSubscriptionState(): Promise<{
  subscription: EffectiveSubscriptionInfo;
  payments: PaymentSubmissionDoc[];
  gatewayOrders: GatewayCheckoutOrder[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/subscription', { headers });
  const data = (await res.json()) as {
    subscription?: EffectiveSubscriptionInfo;
    payments?: PaymentSubmissionDoc[];
    gatewayOrders?: GatewayCheckoutOrder[];
    error?: string;
  };
  if (!res.ok || !data.subscription) {
    throw new Error(data.error || 'Failed to load subscription status.');
  }
  return {
    subscription: data.subscription,
    payments: data.payments || [],
    gatewayOrders: data.gatewayOrders || [],
  };
}

export interface TutGatewayPublicConfig {
  checkoutUrl: string;
  verifyReceiptUrl: string;
  mlaConfigured: boolean;
  walletFirebaseConfig: TutWalletWebConfig | null;
}

export async function fetchTutGatewayConfigApi(): Promise<TutGatewayPublicConfig> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/payments/tut-gateway/config', { headers });
  const data = (await res.json()) as Partial<TutGatewayPublicConfig> & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load T.U.T. Wallet & Checkout config.');
  }
  return {
    checkoutUrl: data.checkoutUrl || '',
    verifyReceiptUrl: data.verifyReceiptUrl || '',
    mlaConfigured: Boolean(data.mlaConfigured),
    walletFirebaseConfig: data.walletFirebaseConfig || null,
  };
}

export async function checkMlaMembershipApi(tutWalletIdToken?: string): Promise<{
  configured: boolean;
  found: boolean;
  member: MlaMemberInfo | null;
  needsWalletSignIn?: boolean;
  error: string | null;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/payments/mla/check', {
    method: 'POST',
    headers,
    body: JSON.stringify(tutWalletIdToken ? { tutWalletIdToken } : {}),
  });
  const data = (await res.json()) as {
    configured?: boolean;
    found?: boolean;
    member?: MlaMemberInfo | null;
    needsWalletSignIn?: boolean;
    error?: string | null;
  };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to check T.U.T. MLA account.');
  }
  return {
    configured: Boolean(data.configured),
    found: Boolean(data.found),
    member: data.member || null,
    needsWalletSignIn: Boolean(data.needsWalletSignIn),
    error: data.error || null,
  };
}

export async function purchasePremiumWithMlaApi(
  cycle: SubscriptionCycle,
  tutWalletIdToken?: string,
): Promise<{
  ok: boolean;
  payment: PaymentSubmissionDoc;
  subscription: EffectiveSubscriptionInfo;
  updatedBalanceBdt: number;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/payments/mla/purchase', {
    method: 'POST',
    headers,
    body: JSON.stringify(
      tutWalletIdToken ? { cycle, tutWalletIdToken } : { cycle },
    ),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    payment?: PaymentSubmissionDoc;
    subscription?: EffectiveSubscriptionInfo;
    updatedBalanceBdt?: number;
    error?: string;
  };
  if (!res.ok || !data.subscription || !data.payment) {
    throw new Error(data.error || 'MLA payment failed.');
  }
  return {
    ok: true,
    payment: data.payment,
    subscription: data.subscription,
    updatedBalanceBdt: Number(data.updatedBalanceBdt ?? 0),
  };
}

export async function submitManualWalletPaymentApi(payload: {
  method: 'bkash' | 'nagad';
  cycle: SubscriptionCycle;
  trxId: string;
  senderNumber?: string;
}): Promise<PaymentSubmissionDoc> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/payments/manual', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { payment?: PaymentSubmissionDoc; error?: string };
  if (!res.ok || !data.payment) {
    throw new Error(data.error || 'Payment submission failed.');
  }
  return data.payment;
}

export async function initTutGatewayCheckoutApi(
  cycle: SubscriptionCycle,
  returnUrl: string,
): Promise<{
  ok: boolean;
  order: GatewayCheckoutOrder;
  checkoutUrl: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/payments/tut-gateway/init', {
    method: 'POST',
    headers,
    body: JSON.stringify({ cycle, returnUrl }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    order?: GatewayCheckoutOrder;
    checkoutUrl?: string;
    error?: string;
  };
  if (!res.ok || !data.order || !data.checkoutUrl) {
    throw new Error(data.error || 'Failed to start T.U.T. Hosted Checkout.');
  }
  return {
    ok: true,
    order: data.order,
    checkoutUrl: data.checkoutUrl,
  };
}

export async function verifyTutGatewayCheckoutApi(
  orderId: string,
  returnParams: Record<string, string>,
): Promise<{
  verified: boolean;
  proxyBlocked?: boolean;
  order?: GatewayCheckoutOrder;
  payment?: PaymentSubmissionDoc;
  subscription?: EffectiveSubscriptionInfo;
  error?: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/payments/tut-gateway/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify({ orderId, returnParams }),
  });
  const data = (await res.json()) as {
    verified?: boolean;
    proxyBlocked?: boolean;
    order?: GatewayCheckoutOrder;
    payment?: PaymentSubmissionDoc;
    subscription?: EffectiveSubscriptionInfo;
    error?: string;
  };
  if (!res.ok && !data.proxyBlocked) {
    throw new Error(data.error || 'T.U.T. receipt verification failed.');
  }
  return {
    verified: Boolean(data.verified),
    proxyBlocked: Boolean(data.proxyBlocked),
    order: data.order,
    payment: data.payment,
    subscription: data.subscription,
    error: data.error,
  };
}

export async function submitPendingGatewayReceiptApi(payload: {
  orderId: string;
  receiptRef?: string;
  note?: string;
}): Promise<PaymentSubmissionDoc> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/payments/tut-gateway/submit-receipt', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { payment?: PaymentSubmissionDoc; error?: string };
  if (!res.ok || !data.payment) {
    throw new Error(data.error || 'Failed to submit receipt for Admin review.');
  }
  return data.payment;
}

// --- Admin Shared Pool, Payment Review & MLA Config ---

export async function fetchAdminSharedConnections(): Promise<ProviderConnectionSummary[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/connections', { headers });
  const data = (await res.json()) as { connections?: ProviderConnectionSummary[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load Admin shared providers.');
  }
  return data.connections || [];
}

export async function saveAdminSharedConnection(
  providerId: ProviderId,
  apiKey: string,
): Promise<{
  ok: boolean;
  healthState?: ProviderHealthState;
  modelsCount?: number;
  error: string | null;
  connections: ProviderConnectionSummary[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/connections/shared', {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId, apiKey }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    healthState?: ProviderHealthState;
    modelsCount?: number;
    connections?: ProviderConnectionSummary[];
    error?: string | null;
  };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to save Admin API key.');
  }
  return {
    ok: Boolean(data.ok),
    healthState: data.healthState,
    modelsCount: data.modelsCount,
    error: data.error || null,
    connections: data.connections || [],
  };
}

export async function testAdminSharedConnection(providerId: ProviderId): Promise<{
  ok: boolean;
  healthState?: ProviderHealthState;
  modelsCount?: number;
  error: string | null;
  connections: ProviderConnectionSummary[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/admin/connections/shared/${encodeURIComponent(providerId)}/test`, {
    method: 'POST',
    headers,
  });
  const data = (await res.json()) as {
    ok?: boolean;
    healthState?: ProviderHealthState;
    modelsCount?: number;
    connections?: ProviderConnectionSummary[];
    error?: string | null;
  };
  if (!res.ok && !data.connections) {
    throw new Error(data.error || 'Admin key test failed.');
  }
  return {
    ok: Boolean(data.ok),
    healthState: data.healthState,
    modelsCount: data.modelsCount,
    error: data.error || null,
    connections: data.connections || [],
  };
}

export async function deleteAdminSharedConnection(
  providerId: ProviderId,
): Promise<ProviderConnectionSummary[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/admin/connections/shared/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
    headers,
  });
  const data = (await res.json()) as { connections?: ProviderConnectionSummary[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to remove Admin shared API key.');
  }
  return data.connections || [];
}

export async function fetchAdminPayments(): Promise<PaymentSubmissionDoc[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/payments', { headers });
  const data = (await res.json()) as { payments?: PaymentSubmissionDoc[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load payment verification queue.');
  }
  return data.payments || [];
}

export async function reviewAdminPayment(
  paymentId: string,
  approve: boolean,
  reviewNote?: string,
): Promise<{ payment: PaymentSubmissionDoc; payments: PaymentSubmissionDoc[] }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ approve, reviewNote }),
  });
  const data = (await res.json()) as {
    payment?: PaymentSubmissionDoc;
    payments?: PaymentSubmissionDoc[];
    error?: string;
  };
  if (!res.ok || !data.payment) {
    throw new Error(data.error || 'Failed to review payment.');
  }
  return {
    payment: data.payment,
    payments: data.payments || [],
  };
}

export interface MlaConfigInfo {
  projectId: string;
  firestoreDatabaseId: string;
  membersCollection: string;
  emailField: string;
  balanceField: string;
  checkoutUrl: string;
  verifyReceiptUrl: string;
  gatewayUrl: string;
  authDomain: string;
  appId: string;
  storageBucket: string;
  messagingSenderId: string;
  apiKey?: string;
  hasApiKey?: boolean;
  apiKeyPreview?: string | null;
  configured: boolean;
}

export async function fetchAdminMlaConfig(): Promise<MlaConfigInfo> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/mla-config', { headers });
  const data = (await res.json()) as { config?: MlaConfigInfo; error?: string };
  if (!res.ok || !data.config) {
    throw new Error(data.error || 'Failed to load MLA configuration.');
  }
  return data.config;
}

export async function saveAdminMlaConfig(
  payload: Partial<Omit<MlaConfigInfo, 'configured' | 'hasApiKey' | 'apiKeyPreview'>>,
): Promise<MlaConfigInfo> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/mla-config', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { config?: MlaConfigInfo; error?: string };
  if (!res.ok || !data.config) {
    throw new Error(data.error || 'Failed to save MLA configuration.');
  }
  return data.config;
}

export interface AdminPortalOverview {
  payments: PaymentSubmissionDoc[];
  subscriptions: UserSubscriptionDoc[];
  gatewayOrders: GatewayCheckoutOrder[];
  connections: ProviderConnectionSummary[];
  mlaConfig: MlaConfigInfo;
}

export async function fetchAdminPortalOverviewApi(): Promise<AdminPortalOverview> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/overview', { headers });
  const data = (await res.json()) as Partial<AdminPortalOverview> & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load Admin Portal data.');
  }
  return {
    payments: data.payments || [],
    subscriptions: data.subscriptions || [],
    gatewayOrders: data.gatewayOrders || [],
    connections: data.connections || [],
    mlaConfig: data.mlaConfig || {
      projectId: '',
      firestoreDatabaseId: '(default)',
      membersCollection: 'members',
      emailField: 'email',
      balanceField: 'balance',
      checkoutUrl: '',
      verifyReceiptUrl: '',
      gatewayUrl: '',
      authDomain: '',
      appId: '',
      storageBucket: '',
      messagingSenderId: '',
      hasApiKey: false,
      apiKeyPreview: null,
      configured: false,
    },
  };
}

export async function grantAdminSubscriberApi(payload: {
  uid: string;
  email: string;
  cycle: SubscriptionCycle;
}): Promise<{ subscription: UserSubscriptionDoc; subscriptions: UserSubscriptionDoc[] }> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/subscribers/grant', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as {
    subscription?: UserSubscriptionDoc;
    subscriptions?: UserSubscriptionDoc[];
    error?: string;
  };
  if (!res.ok || !data.subscription) {
    throw new Error(data.error || 'Failed to grant Premium access.');
  }
  return {
    subscription: data.subscription,
    subscriptions: data.subscriptions || [],
  };
}

export async function revokeAdminSubscriberApi(uid: string): Promise<UserSubscriptionDoc[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/admin/subscribers/${encodeURIComponent(uid)}/revoke`, {
    method: 'POST',
    headers,
  });
  const data = (await res.json()) as {
    subscriptions?: UserSubscriptionDoc[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to revoke Premium access.');
  }
  return data.subscriptions || [];
}

