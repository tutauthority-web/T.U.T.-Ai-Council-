import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Landmark,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import { ProviderAvatar } from '../components/ProviderBadge';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteAdminSharedConnection,
  fetchAdminPortalOverviewApi,
  grantAdminSubscriberApi,
  reviewAdminPayment,
  revokeAdminSubscriberApi,
  saveAdminGatewayConfig,
  saveAdminSharedConnection,
  testAdminSharedConnection,
} from '../lib/apiClient';
import { formatStatusLabel, getStatusTextClass } from '../lib/statusLabels';
import {
  detectProviderFromApiKey,
  PROVIDER_LIST,
  PROVIDER_REGISTRY,
  RECOMMENDED_FREE_PROVIDER_IDS,
} from '../shared/providers';
import {
  ADMIN_EMAIL,
  getPremiumPlan,
  PREMIUM_PLANS,
  PREMIUM_PROVIDER_PRIORITY,
  TUT_GATEWAY_BASE_URL,
  TUT_MERCHANT_ID,
  TUT_MERCHANT_NAME,
  type GatewayCheckoutOrder,
  type PaymentSubmissionDoc,
  type ProviderConnectionSummary,
  type ProviderId,
  type SubscriptionCycle,
  type TutGatewayConfig,
  type UserSubscriptionDoc,
} from '../shared/types';

type AdminTab = 'payments' | 'subscribers' | 'apis' | 'gateway';

const STARTER_FREE_SET = new Set<ProviderId>(RECOMMENDED_FREE_PROVIDER_IDS);

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getDaysRemaining(expiresAt?: string): number {
  if (!expiresAt) return 0;
  const ms = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

export function AdminPortalPage({
  onNavigate,
  onBack,
}: {
  onNavigate: (route: AppRoute) => void;
  onBack?: () => void;
}) {
  const { isAdmin, refreshSubscription, refreshProviderState } = useAuth();

  const [activeTab, setActiveTab] = useState<AdminTab>('payments');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [payments, setPayments] = useState<PaymentSubmissionDoc[]>([]);
  const [subscriptions, setSubscriptions] = useState<UserSubscriptionDoc[]>([]);
  const [gatewayOrders, setGatewayOrders] = useState<GatewayCheckoutOrder[]>([]);
  const [adminConnections, setAdminConnections] = useState<ProviderConnectionSummary[]>([]);
  const [gatewayConfig, setGatewayConfig] = useState<TutGatewayConfig | null>(null);

  // Payment Review Filter & Notes
  const [paymentFilter, setPaymentFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);

  // Subscriber Grant & Filter
  const [grantUid, setGrantUid] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantCycle, setGrantCycle] = useState<SubscriptionCycle>('1m');
  const [granting, setGranting] = useState(false);
  const [subscriberSearch, setSubscriberSearch] = useState('');
  const [busySubUid, setBusySubUid] = useState<string | null>(null);

  // Admin Shared API Pool
  const [poolFilter, setPoolFilter] = useState<'all' | 'free' | 'connected'>('all');
  const [quickKey, setQuickKey] = useState('');
  const [showQuickKey, setShowQuickKey] = useState(false);
  const [quickProviderOverride, setQuickProviderOverride] = useState<ProviderId>('cohere');
  const [quickBusy, setQuickBusy] = useState(false);
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [openGuides, setOpenGuides] = useState<Record<string, boolean>>({});
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [apiFeedback, setApiFeedback] = useState<Record<string, { type: 'ok' | 'err'; text: string }>>({});

  // T.U.T. Money Lending Authority Gateway Settings
  const [gatewayForm, setGatewayForm] = useState<TutGatewayConfig>({
    gatewayBaseUrl: TUT_GATEWAY_BASE_URL,
    merchantId: TUT_MERCHANT_ID,
    merchantName: TUT_MERCHANT_NAME,
  });
  const [gatewaySaving, setGatewaySaving] = useState(false);

  const detectedQuickProvider = useMemo(() => detectProviderFromApiKey(quickKey), [quickKey]);
  const effectiveQuickProvider = detectedQuickProvider || quickProviderOverride;

  const loadOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminPortalOverviewApi();
      setPayments(data.payments);
      setSubscriptions(data.subscriptions);
      setGatewayOrders(data.gatewayOrders);
      setAdminConnections(data.connections);
      setGatewayConfig(data.gatewayConfig);
      setGatewayForm({
        gatewayBaseUrl: data.gatewayConfig.gatewayBaseUrl || TUT_GATEWAY_BASE_URL,
        merchantId: data.gatewayConfig.merchantId || TUT_MERCHANT_ID,
        merchantName: data.gatewayConfig.merchantName || TUT_MERCHANT_NAME,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void loadOverview();
  }, [isAdmin]);

  const kpis = useMemo(() => {
    const pendingCount = payments.filter((p) => p.status === 'pending').length;
    const revenueBdt = payments
      .filter((p) => p.status === 'approved')
      .reduce((sum, p) => sum + (p.amountBdt || 0), 0);
    const activeSubsCount = subscriptions.filter(
      (s) => s.tier === 'premium' && getDaysRemaining(s.expiresAt) > 0,
    ).length;
    const connectedApisCount = adminConnections.filter((c) => c.status === 'connected').length;
    return { pendingCount, revenueBdt, activeSubsCount, connectedApisCount };
  }, [payments, subscriptions, adminConnections]);

  const visiblePayments = useMemo(() => {
    const q = paymentSearch.trim().toLowerCase();
    return payments.filter((p) => {
      if (paymentFilter !== 'all' && p.status !== paymentFilter) return false;
      if (!q) return true;
      return (
        p.userEmail.toLowerCase().includes(q) ||
        p.trxId.toLowerCase().includes(q) ||
        p.userId.toLowerCase().includes(q)
      );
    });
  }, [payments, paymentFilter, paymentSearch]);

  const visibleSubscribers = useMemo(() => {
    const q = subscriberSearch.trim().toLowerCase();
    return subscriptions.filter((s) => {
      if (!q) return true;
      return s.email.toLowerCase().includes(q) || s.uid.toLowerCase().includes(q);
    });
  }, [subscriptions, subscriberSearch]);

  const filteredAdminApis = useMemo(() => {
    if (poolFilter === 'free') {
      return adminConnections.filter((c) => STARTER_FREE_SET.has(c.providerId));
    }
    if (poolFilter === 'connected') {
      return adminConnections.filter((c) => c.status === 'connected');
    }
    return adminConnections;
  }, [adminConnections, poolFilter]);

  // Unique known users from payments + subscriptions for quick-fill dropdown
  const knownUsers = useMemo(() => {
    const map = new Map<string, { uid: string; email: string }>();
    for (const s of subscriptions) {
      if (s.uid && s.email) map.set(s.uid, { uid: s.uid, email: s.email });
    }
    for (const p of payments) {
      if (p.userId && p.userEmail && !map.has(p.userId)) {
        map.set(p.userId, { uid: p.userId, email: p.userEmail });
      }
    }
    return Array.from(map.values());
  }, [subscriptions, payments]);

  if (!isAdmin) {
    return (
      <AppShell
        currentRoute="admin"
        pageTitle="Admin Portal"
        onNavigate={onNavigate}
        showBackButton
        onBack={onBack || (() => onNavigate('portal'))}
      >
        <div className="max-w-lg mx-auto my-12 bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-4 text-center">
          <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold text-slate-100">
              Administrator Access Required
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              This portal is reserved strictly for the verified Admin account ({ADMIN_EMAIL}).
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('portal')}
            className="min-h-[42px] px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
          >
            Go to User Portal
          </button>
        </div>
      </AppShell>
    );
  }

  const handleReviewPayment = async (paymentId: string, approve: boolean) => {
    setBusyPaymentId(paymentId);
    setError(null);
    setNotice(null);
    try {
      await reviewAdminPayment(paymentId, approve, reviewNotes[paymentId]);
      await loadOverview();
      await refreshSubscription();
      setNotice(
        approve
          ? 'Payment approved and user Premium validity activated.'
          : 'Payment marked as rejected.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyPaymentId(null);
    }
  };

  const handleGrantSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    setGranting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await grantAdminSubscriberApi({
        uid: grantUid.trim(),
        email: grantEmail.trim(),
        cycle: grantCycle,
      });
      setSubscriptions(res.subscriptions);
      setGrantUid('');
      setGrantEmail('');
      setNotice(
        `Granted ${getPremiumPlan(grantCycle).label} Premium access to ${res.subscription.email}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGranting(false);
    }
  };

  const handleQuickExtend = async (sub: UserSubscriptionDoc) => {
    setBusySubUid(sub.uid);
    setError(null);
    setNotice(null);
    try {
      const res = await grantAdminSubscriberApi({
        uid: sub.uid,
        email: sub.email,
        cycle: '1m',
      });
      setSubscriptions(res.subscriptions);
      setNotice(`Extended ${sub.email} by +30 days.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySubUid(null);
    }
  };

  const handleRevokeSubscriber = async (sub: UserSubscriptionDoc) => {
    setBusySubUid(sub.uid);
    setError(null);
    setNotice(null);
    try {
      const updated = await revokeAdminSubscriberApi(sub.uid);
      setSubscriptions(updated);
      setNotice(`Revoked Premium access for ${sub.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySubUid(null);
    }
  };

  const handleQuickConnectAdminKey = async () => {
    const trimmed = quickKey.trim();
    if (!trimmed) return;
    const pid = effectiveQuickProvider;
    setQuickBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await saveAdminSharedConnection(pid, trimmed);
      setAdminConnections(res.connections);
      setQuickKey('');
      await refreshProviderState(true);
      setApiFeedback((prev) => ({
        ...prev,
        [pid]: {
          type: 'ok',
          text: `${PROVIDER_REGISTRY[pid].name} connected (${res.modelsCount || 0} models discovered).`,
        },
      }));
      setNotice(`Saved ${PROVIDER_REGISTRY[pid].name} key to Admin Shared Pool.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuickBusy(false);
    }
  };

  const handleSaveAdminProviderKey = async (pid: ProviderId) => {
    const key = (draftKeys[pid] || '').trim();
    if (!key) {
      setApiFeedback((prev) => ({
        ...prev,
        [pid]: { type: 'err', text: 'Enter an API key before saving.' },
      }));
      return;
    }
    setBusyProvider(pid);
    try {
      const res = await saveAdminSharedConnection(pid, key);
      setAdminConnections(res.connections);
      setDraftKeys((prev) => ({ ...prev, [pid]: '' }));
      await refreshProviderState(true);
      setApiFeedback((prev) => ({
        ...prev,
        [pid]: {
          type: res.ok ? 'ok' : 'err',
          text: res.ok
            ? `Shared Admin key verified (${res.modelsCount || 0} live models).`
            : res.error || 'Verification warning.',
        },
      }));
    } catch (err) {
      setApiFeedback((prev) => ({
        ...prev,
        [pid]: { type: 'err', text: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleTestAdminProvider = async (pid: ProviderId) => {
    setBusyProvider(pid);
    try {
      const res = await testAdminSharedConnection(pid);
      setAdminConnections(res.connections);
      await refreshProviderState(true);
      setApiFeedback((prev) => ({
        ...prev,
        [pid]: {
          type: res.ok ? 'ok' : 'err',
          text: res.ok
            ? `Shared Admin key healthy (${res.modelsCount || 0} live models).`
            : res.error || 'Provider check returned an issue.',
        },
      }));
    } catch (err) {
      setApiFeedback((prev) => ({
        ...prev,
        [pid]: { type: 'err', text: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleDeleteAdminProvider = async (pid: ProviderId) => {
    setBusyProvider(pid);
    try {
      const next = await deleteAdminSharedConnection(pid);
      setAdminConnections(next);
      await refreshProviderState(true);
      setApiFeedback((prev) => ({
        ...prev,
        [pid]: { type: 'ok', text: 'Removed from Admin Shared Pool.' },
      }));
    } catch (err) {
      setApiFeedback((prev) => ({
        ...prev,
        [pid]: { type: 'err', text: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleSaveGatewayConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setGatewaySaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveAdminGatewayConfig({
        gatewayBaseUrl: gatewayForm.gatewayBaseUrl,
        merchantId: gatewayForm.merchantId,
        merchantName: gatewayForm.merchantName,
      });
      setGatewayConfig(saved);
      setGatewayForm(saved);
      setNotice('T.U.T. Money Lending Authority Gateway configuration saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGatewaySaving(false);
    }
  };

  return (
    <AppShell
      currentRoute="admin"
      pageTitle="Admin Portal"
      onNavigate={onNavigate}
      showBackButton
      onBack={onBack || (() => onNavigate('portal'))}
      primaryAction={
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadOverview()}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      }
    >
      <div className="space-y-8 pb-8">
        {/* Admin Identity Banner */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              <span>T.U.T AI Council Administration</span>
            </p>
            <h2 className="font-display text-2xl font-bold text-slate-50">
              Billing Operations, Subscribers &amp; Shared API Pool
            </h2>
            <p className="text-xs text-slate-400">
              Signed in as <strong className="text-slate-200">{ADMIN_EMAIL}</strong> · Separated from User Portal and Checkout views.
            </p>
          </div>
        </section>

        {/* 4-Column Admin KPI Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <p className="text-xs text-slate-400">Pending Payment Reviews</p>
            <p
              className={`mt-2 font-display text-2xl font-bold ${
                kpis.pendingCount > 0 ? 'text-amber-300' : 'text-slate-100'
              }`}
            >
              {kpis.pendingCount}
            </p>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <p className="text-xs text-slate-400">Approved Revenue</p>
            <p className="mt-2 font-display text-2xl font-bold text-emerald-400">
              {kpis.revenueBdt.toLocaleString()}৳
            </p>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <p className="text-xs text-slate-400">Active Premium Users</p>
            <p className="mt-2 font-display text-2xl font-bold text-slate-100">
              {kpis.activeSubsCount}
            </p>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <p className="text-xs text-slate-400">Admin Shared Pool APIs</p>
            <p className="mt-2 font-display text-2xl font-bold text-slate-100">
              {kpis.connectedApisCount} / {PROVIDER_LIST.length}
            </p>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-4 text-xs text-rose-200 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/35 p-4 text-xs text-emerald-200 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Operational Portal Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-xl self-start w-fit max-w-full overflow-x-auto">
          {(
            [
              {
                id: 'payments',
                label: `Payments & Gateway${kpis.pendingCount > 0 ? ` (${kpis.pendingCount})` : ''}`,
              },
              { id: 'subscribers', label: `Subscribers (${subscriptions.length})` },
              { id: 'apis', label: `Shared API Pool (${kpis.connectedApisCount})` },
              { id: 'gateway', label: 'T.U.T. Gateway' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: PAYMENTS & HOSTED GATEWAY ORDERS */}
        {activeTab === 'payments' && (
          <div className="space-y-6">
            <section className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-100">
                    Payment Verification Queue
                  </h3>
                  <p className="text-xs text-slate-400">
                    Review bKash and Nagad manual Send Money submissions. Approving activates Premium validity immediately.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={paymentSearch}
                      onChange={(e) => setPaymentSearch(e.target.value)}
                      placeholder="Filter email or TrxID..."
                      className="w-full sm:w-52 min-h-[38px] pl-8 pr-3 py-1.5 text-xs bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500"
                    />
                  </div>
                  <div className="flex items-center gap-1 p-1 bg-[#090E1A] border border-slate-800 rounded-lg self-start">
                    {(
                      [
                        ['pending', `Pending (${kpis.pendingCount})`],
                        ['approved', 'Approved'],
                        ['rejected', 'Rejected'],
                        ['all', `All (${payments.length})`],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPaymentFilter(key)}
                        className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                          paymentFilter === key
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {visiblePayments.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">
                  No payment submissions match this filter.
                </p>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {visiblePayments.map((p) => (
                    <div
                      key={p.id}
                      className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="space-y-1 text-xs min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-100">{p.userEmail}</span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="uppercase font-medium text-amber-300">{p.method}</span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="font-bold text-white tabular-nums">{p.amountBdt}৳</span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="text-slate-300">{getPremiumPlan(p.cycle).label}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-slate-400 tabular-nums">
                          <span>
                            TrxID: <strong className="font-mono text-slate-200">{p.trxId}</strong>
                          </span>
                          {p.senderNumber && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">From {p.senderNumber}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>{formatDate(p.createdAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              p.status === 'approved'
                                ? 'text-emerald-400 font-medium'
                                : p.status === 'rejected'
                                  ? 'text-rose-400 font-medium'
                                  : 'text-amber-300 font-medium'
                            }
                          >
                            {p.status}
                          </span>
                        </div>
                        {p.reviewNote && (
                          <p className="text-[11px] text-slate-400">Note: {p.reviewNote}</p>
                        )}
                      </div>

                      {p.status === 'pending' && (
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <input
                            type="text"
                            placeholder="Review note (optional)"
                            value={reviewNotes[p.id] || ''}
                            onChange={(e) =>
                              setReviewNotes((prev) => ({
                                ...prev,
                                [p.id]: e.target.value,
                              }))
                            }
                            className="min-h-[38px] px-3 py-1.5 text-xs bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500"
                          />
                          <button
                            type="button"
                            disabled={busyPaymentId === p.id}
                            onClick={() => void handleReviewPayment(p.id, true)}
                            className="inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busyPaymentId === p.id}
                            onClick={() => void handleReviewPayment(p.id, false)}
                            className="inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-rose-600/80 hover:bg-rose-500 text-white rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Hosted Checkout Gateway Order Ledger */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-sky-400" />
                  T.U.T. Hosted Checkout Orders ({gatewayOrders.length})
                </h3>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="text-left font-medium px-5 py-3">Order ID</th>
                      <th className="text-left font-medium px-5 py-3">User Email</th>
                      <th className="text-left font-medium px-5 py-3">Plan</th>
                      <th className="text-right font-medium px-5 py-3">Amount</th>
                      <th className="text-left font-medium px-5 py-3">Status</th>
                      <th className="text-left font-medium px-5 py-3">Memo / Ref</th>
                      <th className="text-right font-medium px-5 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 tabular-nums">
                    {gatewayOrders.slice(0, 25).map((o) => (
                      <tr key={o.orderId} className="hover:bg-slate-800/20">
                        <td className="px-5 py-3 font-mono text-slate-200 whitespace-nowrap">
                          {o.orderId}
                        </td>
                        <td className="px-5 py-3 text-slate-300">{o.email}</td>
                        <td className="px-5 py-3 text-slate-300 whitespace-nowrap">
                          {getPremiumPlan(o.cycle).label}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold text-slate-100 whitespace-nowrap">
                          {o.amountBdt}৳
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <span
                            className={
                              o.status === 'verified'
                                ? 'text-emerald-400 font-medium'
                                : o.status === 'failed'
                                  ? 'text-rose-400 font-medium'
                                  : 'text-amber-300 font-medium'
                            }
                          >
                            {o.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-slate-400 whitespace-nowrap">
                          {o.memoId || o.receiptRef || '—'}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-400 whitespace-nowrap">
                          {formatDate(o.createdAt)}
                        </td>
                      </tr>
                    ))}
                    {gatewayOrders.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                          No T.U.T. Card Checkout orders initiated yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: SUBSCRIBERS & VALIDITY MANAGEMENT */}
        {activeTab === 'subscribers' && (
          <div className="space-y-6">
            {/* Manual Grant / Extend Form */}
            <section className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-emerald-400" />
                    Grant or Extend Premium Membership
                  </h3>
                  <p className="text-xs text-slate-400">
                    Manually activate or extend Premium validity for a verified user UID &amp; email.
                  </p>
                </div>
                {knownUsers.length > 0 && (
                  <select
                    aria-label="Prefill known user"
                    value=""
                    onChange={(e) => {
                      const picked = knownUsers.find((u) => u.uid === e.target.value);
                      if (picked) {
                        setGrantUid(picked.uid);
                        setGrantEmail(picked.email);
                      }
                    }}
                    className="min-h-[38px] px-3 py-1.5 text-xs bg-[#090E1A] border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="">Quick-fill known user...</option>
                    {knownUsers.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <form onSubmit={handleGrantSubscriber} className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                <input
                  type="text"
                  required
                  value={grantUid}
                  onChange={(e) => setGrantUid(e.target.value)}
                  placeholder="Firebase User UID"
                  className="min-h-[42px] px-3 py-2 bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100 font-mono"
                />
                <input
                  type="email"
                  required
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  placeholder="member@gmail.com"
                  className="min-h-[42px] px-3 py-2 bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100"
                />
                <select
                  aria-label="Premium plan duration"
                  value={grantCycle}
                  onChange={(e) => setGrantCycle(e.target.value as SubscriptionCycle)}
                  className="min-h-[42px] px-3 py-2 bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100"
                >
                  {PREMIUM_PLANS.map((plan) => (
                    <option key={plan.cycle} value={plan.cycle}>
                      {plan.label} ({plan.priceBdt}৳)
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={granting}
                  className="min-h-[42px] px-4 py-2 font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {granting ? 'Granting...' : 'Grant / Extend Premium'}
                </button>
              </form>
            </section>

            {/* Subscriber Directory */}
            <section className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h3 className="font-display text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-400" />
                  Subscriber Directory
                </h3>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={subscriberSearch}
                    onChange={(e) => setSubscriberSearch(e.target.value)}
                    placeholder="Search email or UID..."
                    className="w-full sm:w-60 min-h-[38px] pl-8 pr-3 py-1.5 text-xs bg-[#111827] border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500"
                  />
                </div>
              </div>

              <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-400">
                      <th className="text-left font-medium px-5 py-3">Member</th>
                      <th className="text-left font-medium px-5 py-3">Plan</th>
                      <th className="text-left font-medium px-5 py-3">Method</th>
                      <th className="text-left font-medium px-5 py-3">Expires</th>
                      <th className="text-right font-medium px-5 py-3">Days Left</th>
                      <th className="text-left font-medium px-5 py-3">Status</th>
                      <th className="text-right font-medium px-5 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 tabular-nums">
                    {visibleSubscribers.map((sub) => {
                      const daysLeft = getDaysRemaining(sub.expiresAt);
                      const running = sub.tier === 'premium' && daysLeft > 0;
                      const planLabel = sub.cycle ? getPremiumPlan(sub.cycle).label : '—';
                      return (
                        <tr key={sub.uid} className="hover:bg-slate-800/20">
                          <td className="px-5 py-3.5">
                            <p className="font-medium text-slate-100">{sub.email}</p>
                            <p className="font-mono text-[11px] text-slate-500">{sub.uid}</p>
                          </td>
                          <td className="px-5 py-3.5 text-slate-300 whitespace-nowrap">{planLabel}</td>
                          <td className="px-5 py-3.5 uppercase text-xs text-slate-400 whitespace-nowrap">
                            {sub.paymentMethod || '—'}
                          </td>
                          <td className="px-5 py-3.5 text-slate-300 whitespace-nowrap">
                            {formatDate(sub.expiresAt)}
                          </td>
                          <td className="px-5 py-3.5 text-right font-semibold text-slate-100 whitespace-nowrap">
                            {running ? `${daysLeft}d` : '0d'}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            {running ? (
                              <span className="text-emerald-400 font-medium">Running</span>
                            ) : sub.tier === 'free' ? (
                              <span className="text-slate-400 font-medium">Revoked / Free</span>
                            ) : (
                              <span className="text-amber-300 font-medium">Expired</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                disabled={busySubUid === sub.uid}
                                onClick={() => void handleQuickExtend(sub)}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 cursor-pointer disabled:opacity-50"
                              >
                                +30d
                              </button>
                              {sub.tier === 'premium' && (
                                <button
                                  type="button"
                                  disabled={busySubUid === sub.uid}
                                  onClick={() => void handleRevokeSubscriber(sub)}
                                  className="min-h-[34px] px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 border border-rose-900/60 text-xs font-medium text-rose-300 cursor-pointer disabled:opacity-50"
                                >
                                  Revoke
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {visibleSubscribers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                          No subscriber records found yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: ADMIN SHARED API POOL */}
        {activeTab === 'apis' && (
          <div className="space-y-6">
            <section className="rounded-xl border border-amber-500/35 bg-[#121A2F] p-5 space-y-2 text-xs">
              <p className="font-semibold text-amber-300 flex items-center gap-1.5">
                <Crown className="w-4 h-4" />
                Premium Shared API Pool &amp; Auto-Priority Routing
              </p>
              <p className="text-slate-300 leading-relaxed">
                Keys configured here (or saved under <strong>{ADMIN_EMAIL}</strong>) automatically power every active Premium subscriber. Auto-selection priority order:{' '}
                <strong className="text-white">
                  {PREMIUM_PROVIDER_PRIORITY.map((p) => PROVIDER_REGISTRY[p].shortName).join(' → ')}
                </strong>{' '}
                (repeating cyclically when seats &gt; 4).
              </p>
            </section>

            {/* Smart Key Auto-Connect */}
            <section className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                  <h3 className="font-display text-sm font-semibold text-slate-100">
                    Smart Admin Key Auto-Connect
                  </h3>
                </div>
                <span className="text-xs text-slate-400">
                  Auto-detects key format or choose Cohere / Mistral manually
                </span>
              </div>

              <div className="flex flex-col md:flex-row gap-2.5">
                <div className="relative flex-1">
                  <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showQuickKey ? 'text' : 'password'}
                    autoComplete="off"
                    value={quickKey}
                    onChange={(e) => setQuickKey(e.target.value)}
                    placeholder="Paste Admin provider API key..."
                    className="w-full min-h-[44px] pl-10 pr-11 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-amber-500 rounded-xl text-slate-100 placeholder-slate-500 font-mono focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowQuickKey((v) => !v)}
                    aria-label={showQuickKey ? 'Hide key' : 'Show key'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer"
                  >
                    {showQuickKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {detectedQuickProvider ? (
                  <div className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#090E1A] border border-amber-500/40 flex items-center gap-2 shrink-0">
                    <ProviderAvatar provider={detectedQuickProvider} size="xs" />
                    <span className="text-xs font-medium text-amber-300 whitespace-nowrap">
                      {PROVIDER_REGISTRY[detectedQuickProvider].name}
                    </span>
                  </div>
                ) : (
                  <select
                    aria-label="Select provider"
                    value={quickProviderOverride}
                    onChange={(e) => setQuickProviderOverride(e.target.value as ProviderId)}
                    className="min-h-[44px] px-3 py-2 text-xs bg-[#090E1A] border border-slate-800 rounded-xl text-slate-200 shrink-0"
                  >
                    {PROVIDER_LIST.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  disabled={quickBusy || !quickKey.trim()}
                  onClick={() => void handleQuickConnectAdminKey()}
                  className="min-h-[44px] px-5 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
                >
                  {quickBusy
                    ? 'Saving...'
                    : `Save ${PROVIDER_REGISTRY[effectiveQuickProvider].shortName}`}
                </button>
              </div>
            </section>

            {/* Filter Strip */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                All Admin keys are AES-256-GCM encrypted in the server shared pool.
              </p>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[#111827] border border-slate-800 shrink-0">
                {(
                  [
                    ['all', `All (${adminConnections.length})`],
                    ['free', 'Priority & Free'],
                    ['connected', `Connected (${kpis.connectedApisCount})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPoolFilter(key)}
                    className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                      poolFilter === key
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Admin Provider Cards */}
            <div className="space-y-4">
              {filteredAdminApis.map((conn) => {
                const cfg = PROVIDER_REGISTRY[conn.providerId];
                const isConnected = conn.status === 'connected';
                const isBusy = busyProvider === conn.providerId;
                const keyVisible = Boolean(visibleKeys[conn.providerId]);
                const guideOpen = Boolean(openGuides[conn.providerId]);
                const msg = apiFeedback[conn.providerId];

                return (
                  <section
                    key={conn.providerId}
                    className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                      <div className="flex items-center gap-3 min-w-0">
                        <ProviderAvatar provider={conn.providerId} size="sm" />
                        <div className="min-w-0">
                          <h4 className="font-display text-base font-semibold text-slate-100">
                            {conn.providerName}
                          </h4>
                          <p className="text-xs text-slate-400 truncate">
                            {isConnected
                              ? `Shared Pool Active · Fingerprint ${conn.keyFingerprint} · ${conn.discoveredModelsCount} live models`
                              : 'Not configured in Admin Shared Pool'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`text-xs font-medium ${getStatusTextClass(
                            isConnected ? conn.healthState : 'disconnected',
                          )}`}
                        >
                          {formatStatusLabel(isConnected ? conn.healthState : 'disconnected')}
                        </span>
                        <a
                          href={cfg.consoleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg whitespace-nowrap"
                        >
                          <span>Console</span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </a>
                      </div>
                    </div>

                    {msg && (
                      <div
                        className={`text-xs rounded-lg p-3 border ${
                          msg.type === 'ok'
                            ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                            : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                        }`}
                      >
                        {msg.text}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <div className="relative flex-1">
                        <input
                          type={keyVisible ? 'text' : 'password'}
                          autoComplete="off"
                          value={draftKeys[conn.providerId] || ''}
                          onChange={(e) =>
                            setDraftKeys((prev) => ({
                              ...prev,
                              [conn.providerId]: e.target.value,
                            }))
                          }
                          placeholder={
                            isConnected
                              ? 'Paste new shared API key to replace...'
                              : cfg.keyPlaceholder
                          }
                          className="w-full min-h-[42px] pl-3.5 pr-11 py-2 text-xs bg-[#090E1A] border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setVisibleKeys((prev) => ({
                              ...prev,
                              [conn.providerId]: !prev[conn.providerId],
                            }))
                          }
                          aria-label={keyVisible ? 'Hide key' : 'Show key'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          {keyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSaveAdminProviderKey(conn.providerId)}
                        className="min-h-[42px] px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl whitespace-nowrap cursor-pointer disabled:opacity-50"
                      >
                        {isBusy ? 'Saving...' : isConnected ? 'Replace Shared Key' : 'Save Shared Key'}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {isConnected && (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleTestAdminProvider(conn.providerId)}
                              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                              Test Pool Key
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleDeleteAdminProvider(conn.providerId)}
                              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-950/50 border border-rose-900/50 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Remove
                            </button>
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setOpenGuides((prev) => ({
                            ...prev,
                            [conn.providerId]: !prev[conn.providerId],
                          }))
                        }
                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        <span>Setup steps</span>
                        {guideOpen ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {guideOpen && (
                      <div className="pt-3 border-t border-slate-800/80 space-y-1.5 text-xs text-slate-300">
                        {cfg.setupSteps.map((step, i) => (
                          <div key={step} className="flex items-start gap-2">
                            <span className="font-mono text-slate-500">0{i + 1}.</span>
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: T.U.T. MONEY LENDING AUTHORITY GATEWAY CONFIG */}
        {activeTab === 'gateway' && (
          <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-4">
              <div className="space-y-1">
                <h3 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-sky-400" />
                  T.U.T. Money Lending Authority Card Gateway
                </h3>
                <p className="text-xs text-slate-400">
                  Server creates checkout sessions at{' '}
                  <span className="font-mono text-slate-300">/api/gateway/create-session</span>{' '}
                  and verifies returned <span className="font-mono text-slate-300">tut_token</span>{' '}
                  proofs at <span className="font-mono text-slate-300">/api/gateway/verify-payment</span>.
                </p>
              </div>
              <span className="text-xs font-medium text-emerald-400 whitespace-nowrap">
                {gatewayConfig?.gatewayBaseUrl ? 'Gateway Active' : 'Default Active'}
              </span>
            </div>

            <form
              onSubmit={handleSaveGatewayConfig}
              className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs"
            >
              <div className="space-y-1 md:col-span-2">
                <label htmlFor="admin-gw-base" className="text-slate-300 font-medium">
                  Gateway Base Origin (TUT_GATEWAY_BASE_URL)
                </label>
                <input
                  id="admin-gw-base"
                  type="url"
                  required
                  placeholder={TUT_GATEWAY_BASE_URL}
                  value={gatewayForm.gatewayBaseUrl}
                  onChange={(e) =>
                    setGatewayForm((f) => ({ ...f, gatewayBaseUrl: e.target.value }))
                  }
                  className="w-full min-h-[42px] px-3 py-2 bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100 font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="admin-merchant-id" className="text-slate-300 font-medium">
                  Merchant ID (TUT_MERCHANT_ID)
                </label>
                <input
                  id="admin-merchant-id"
                  type="text"
                  required
                  maxLength={80}
                  placeholder={TUT_MERCHANT_ID}
                  value={gatewayForm.merchantId}
                  onChange={(e) =>
                    setGatewayForm((f) => ({ ...f, merchantId: e.target.value }))
                  }
                  className="w-full min-h-[42px] px-3 py-2 bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100 font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="admin-merchant-name" className="text-slate-300 font-medium">
                  Merchant Display Name (TUT_MERCHANT_NAME)
                </label>
                <input
                  id="admin-merchant-name"
                  type="text"
                  required
                  maxLength={80}
                  placeholder={TUT_MERCHANT_NAME}
                  value={gatewayForm.merchantName}
                  onChange={(e) =>
                    setGatewayForm((f) => ({ ...f, merchantName: e.target.value }))
                  }
                  className="w-full min-h-[42px] px-3 py-2 bg-[#090E1A] border border-slate-800 rounded-lg text-slate-100"
                />
              </div>
              <div className="md:col-span-2 rounded-lg border border-slate-800 bg-[#090E1A] p-3.5 space-y-1 text-[11px] text-slate-400 font-mono">
                <p>
                  Create Session: {gatewayForm.gatewayBaseUrl.replace(/\/+$/, '')}/api/gateway/create-session
                </p>
                <p>
                  Verify Payment: {gatewayForm.gatewayBaseUrl.replace(/\/+$/, '')}/api/gateway/verify-payment
                </p>
              </div>
              <div className="flex items-center md:col-span-2">
                <button
                  type="submit"
                  disabled={gatewaySaving}
                  className="w-full sm:w-auto min-h-[42px] px-6 py-2 font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {gatewaySaving ? 'Saving...' : 'Save Gateway Settings'}
                </button>
              </div>
            </form>
          </section>
        )}
      </div>
    </AppShell>
  );
}
