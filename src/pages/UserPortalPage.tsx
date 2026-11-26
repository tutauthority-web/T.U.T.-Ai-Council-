import { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Crown,
  Download,
  KeyRound,
  Landmark,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import { PortalSettingsPanel } from '../components/portal/PortalSettingsPanel';
import { PortalUsagePanel } from '../components/portal/PortalUsagePanel';
import { useAuth } from '../contexts/AuthContext';
import { PROVIDER_LIST } from '../shared/providers';
import {
  getPremiumPlan,
  PREMIUM_PROVIDER_PRIORITY,
  type PaymentMethod,
  type PaymentSubmissionDoc,
} from '../shared/types';

export type PortalTab = 'account' | 'usage' | 'settings';

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

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMethodLabel(method?: PaymentMethod): string {
  if (method === 'mla') return 'T.U.T. Gateway';
  if (method === 'bkash') return 'bKash';
  if (method === 'nagad') return 'Nagad';
  return 'Account';
}

function computeValidityStats(
  activatedAt?: string,
  expiresAt?: string,
  cycle?: string,
): {
  isValid: boolean;
  isExpiringSoon: boolean;
  daysLeft: number;
  hoursLeft: number;
  progressRemainingPct: number;
  label: string;
} {
  if (!expiresAt) {
    return {
      isValid: false,
      isExpiringSoon: false,
      daysLeft: 0,
      hoursLeft: 0,
      progressRemainingPct: 0,
      label: 'No active expiry',
    };
  }
  const nowMs = Date.now();
  const expMs = Date.parse(expiresAt);
  if (Number.isNaN(expMs) || expMs <= nowMs) {
    return {
      isValid: false,
      isExpiringSoon: false,
      daysLeft: 0,
      hoursLeft: 0,
      progressRemainingPct: 0,
      label: `Expired ${formatDate(expiresAt)}`,
    };
  }

  const diffMs = expMs - nowMs;
  const totalHours = Math.floor(diffMs / 3_600_000);
  const daysLeft = Math.floor(totalHours / 24);
  const hoursLeft = totalHours % 24;

  const plan = cycle ? getPremiumPlan(cycle) : null;
  const startMs = activatedAt ? Date.parse(activatedAt) : NaN;
  const spanMs =
    !Number.isNaN(startMs) && expMs > startMs
      ? expMs - startMs
      : (plan?.durationDays || 30) * 86_400_000;
  const pct = Math.max(4, Math.min(100, Math.round((diffMs / spanMs) * 100)));

  return {
    isValid: true,
    isExpiringSoon: daysLeft < 5,
    daysLeft,
    hoursLeft,
    progressRemainingPct: pct,
    label: daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h remaining` : `${hoursLeft}h remaining`,
  };
}

export function UserPortalPage({
  onNavigate,
  activeTab: controlledTab,
  onChangeTab,
}: {
  onNavigate: (route: AppRoute) => void;
  activeTab?: PortalTab;
  onChangeTab?: (tab: PortalTab) => void;
}) {
  const {
    user,
    profile,
    subscription,
    payments,
    isPremium,
    isAdmin,
    councils,
    usageRecords,
    connections,
    refreshSubscription,
    refreshProviderState,
  } = useAuth();

  const [internalTab, setInternalTab] = useState<PortalTab>('account');
  const currentTab = controlledTab ?? internalTab;
  const handleTabSelect = (tab: PortalTab) => {
    setInternalTab(tab);
    onChangeTab?.(tab);
  };

  const [paymentFilter, setPaymentFilter] = useState<'all' | 'approved' | 'pending' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<PaymentSubmissionDoc | null>(null);

  const connectedCount = useMemo(
    () => connections.filter((c) => c.status === 'connected').length,
    [connections],
  );

  const activePlan = subscription?.cycle ? getPremiumPlan(subscription.cycle) : null;
  const validity = useMemo(
    () =>
      computeValidityStats(
        subscription?.activatedAt,
        subscription?.expiresAt,
        subscription?.cycle,
      ),
    [subscription?.activatedAt, subscription?.expiresAt, subscription?.cycle],
  );

  const totalApprovedBdt = useMemo(
    () =>
      payments
        .filter((p) => p.status === 'approved')
        .reduce((sum, p) => sum + (p.amountBdt || 0), 0),
    [payments],
  );

  const pendingPaymentsCount = useMemo(
    () => payments.filter((p) => p.status === 'pending').length,
    [payments],
  );

  const filteredPayments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return payments.filter((p) => {
      if (paymentFilter !== 'all' && p.status !== paymentFilter) return false;
      if (!q) return true;
      return (
        p.trxId.toLowerCase().includes(q) ||
        p.method.toLowerCase().includes(q) ||
        getPremiumPlan(p.cycle).label.toLowerCase().includes(q) ||
        (p.reviewNote || '').toLowerCase().includes(q)
      );
    });
  }, [payments, paymentFilter, searchQuery]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshSubscription(), refreshProviderState(false)]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDownloadReceipt = (payment: PaymentSubmissionDoc) => {
    const planInfo = getPremiumPlan(payment.cycle);
    const payload = {
      documentType: 'T.U.T AI Council Payment Receipt',
      paymentId: payment.id,
      status: payment.status,
      memberEmail: payment.userEmail,
      planLabel: planInfo.label,
      durationDays: planInfo.durationDays,
      amountBdt: payment.amountBdt,
      currency: 'BDT',
      paymentMethod: formatMethodLabel(payment.method),
      transactionReference: payment.trxId,
      senderNumber: payment.senderNumber || null,
      reviewNote: payment.reviewNote || null,
      reviewedBy: payment.reviewedBy || null,
      submittedAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tut-receipt-${payment.trxId.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const latestCompletedPayment = payments.find((p) => p.status === 'approved');
  const wasPreviouslyPremium = Boolean(
    !isPremium && (subscription?.expiresAt || latestCompletedPayment),
  );

  return (
    <AppShell
      currentRoute={currentTab === 'usage' ? 'usage' : currentTab === 'settings' ? 'settings' : 'portal'}
      pageTitle="Portal"
      onNavigate={onNavigate}
      primaryAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] sm:px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
            aria-label="Sync account data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Admin
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-6 pb-8">
        {/* Account Identity Strip */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#111827] border border-slate-800/90 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-3.5 min-w-0">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={profile?.displayName || 'Account avatar'}
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-xl object-cover border border-slate-700 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-[#121A2F] border border-slate-700 flex items-center justify-center font-display text-lg font-bold text-slate-100 shrink-0">
                {(profile?.displayName || user?.email || 'U').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg sm:text-xl font-bold text-slate-50 truncate">
                  {profile?.displayName || user?.displayName || 'Council Member'}
                </h2>
                <span
                  className={`text-xs font-semibold whitespace-nowrap ${
                    isAdmin
                      ? 'text-amber-300'
                      : isPremium
                        ? 'text-emerald-400'
                        : 'text-sky-400'
                  }`}
                >
                  {isAdmin
                    ? '· Administrator'
                    : isPremium
                      ? '· Premium Running'
                      : '· Free Tier'}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                {user?.email}
                <span className="text-slate-600 mx-1.5" aria-hidden="true">·</span>
                <span className="font-mono text-[11px] text-slate-500">
                  UID {user?.uid?.slice(0, 10)}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('premium')}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Crown className="w-3.5 h-3.5" />
            {isPremium && !isAdmin ? 'Extend Validity' : 'Upgrade to Premium'}
          </button>
        </section>

        {/* 3-Segment App Tab Switcher */}
        <div
          role="tablist"
          aria-label="Portal sections"
          className="grid grid-cols-3 gap-1 p-1 bg-[#111827] border border-slate-800 rounded-xl max-w-md"
        >
          {(
            [
              { id: 'account', label: 'Account', icon: User },
              { id: 'usage', label: 'Usage & Limits', icon: Activity },
              { id: 'settings', label: 'Settings', icon: Settings },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = currentTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => handleTabSelect(id)}
                className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab 1: Account, Validity & Payments */}
        {currentTab === 'account' && (
          <div className="space-y-6 animate-panel-enter">
            {/* Primary Focal Anchor: Subscription Running & Validity Status */}
            <section
              className={`rounded-2xl border p-5 sm:p-6 space-y-5 ${
                isPremium
                  ? 'bg-[#121A2F] border-amber-500/45'
                  : 'bg-[#111827] border-slate-800'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-2 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    {isPremium ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400">
                          {isAdmin ? 'Admin Full Access Active' : 'Premium Subscription Running'}
                        </span>
                        {activePlan && !isAdmin && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-amber-300 tabular-nums">
                              {activePlan.label} ({activePlan.priceBdt}৳)
                            </span>
                          </>
                        )}
                        {subscription?.paymentMethod && !isAdmin && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-slate-300">
                              Paid via {formatMethodLabel(subscription.paymentMethod)}
                            </span>
                          </>
                        )}
                      </>
                    ) : wasPreviouslyPremium ? (
                      <>
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="text-amber-300">Premium Validity Expired</span>
                        {subscription?.expiresAt && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-slate-400 tabular-nums">
                              Ended {formatDate(subscription.expiresAt)}
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4 text-sky-400 shrink-0" />
                        <span className="text-sky-400">Free Tier · Bring Your Own Key (BYOK)</span>
                      </>
                    )}
                  </div>

                  <h3 className="font-display text-lg sm:text-xl font-bold text-slate-100">
                    {isAdmin
                      ? 'Full Administrator Privileges & Shared Pool Access'
                      : isPremium
                        ? `${activePlan ? activePlan.label : 'Council Premium'} · ${
                            validity.isValid ? validity.label : 'Active'
                          }`
                        : wasPreviouslyPremium
                          ? 'Your Premium window has ended — workspace switched to Free BYOK mode'
                          : 'Running on personal API keys — zero monthly fee'}
                  </h3>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {isPremium
                      ? `Admin-connected provider APIs are unlocked across your workspace. New councils auto-seat models using cycling priority (${PREMIUM_PROVIDER_PRIORITY.map((p) => p.toUpperCase()).join(' → ')}).`
                      : `Connect your own keys for free providers (Gemini, Groq, OpenRouter, Cohere, Mistral, Cerebras) or activate Premium from 29৳/month for instant Admin-managed APIs.`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigate('new-council')}
                    className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Launch Council
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('premium')}
                    className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-100 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>{isPremium && !isAdmin ? 'Renew / Extend' : 'View Plans (29৳)'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Validity Timeline Bar (for active Premium subscribers) */}
              {isPremium && !isAdmin && subscription?.expiresAt && (
                <div className="pt-4 border-t border-slate-800/80 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <CalendarClock className="w-3.5 h-3.5 text-amber-400" />
                      Activated {formatDate(subscription.activatedAt)}
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      Valid until <strong className="text-slate-100">{formatDate(subscription.expiresAt)}</strong>
                    </span>
                    <span
                      className={`font-semibold ${
                        validity.isExpiringSoon ? 'text-amber-300' : 'text-emerald-400'
                      }`}
                    >
                      {validity.label}
                      {validity.isExpiringSoon ? ' · Renew soon' : ''}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#090E1A] rounded-full overflow-hidden border border-slate-800">
                    <div
                      className={`h-full rounded-full transition-all ${
                        validity.isExpiringSoon ? 'bg-amber-400' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${validity.progressRemainingPct}%` }}
                    />
                  </div>
                  {subscription.paymentId && (
                    <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                      Active Subscription Ref: {subscription.paymentId}
                    </p>
                  )}
                </div>
              )}

              {/* Pending verification callout */}
              {pendingPaymentsCount > 0 && (
                <div className="pt-3 border-t border-slate-800/80 flex items-center gap-2 text-xs text-amber-300">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>
                    You have {pendingPaymentsCount} payment submission{pendingPaymentsCount > 1 ? 's' : ''} awaiting Admin verification. Validity updates automatically once approved.
                  </span>
                </div>
              )}
            </section>

            {/* 4-Column Account Metrics */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 tabular-nums">
              <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5">
                <p className="text-xs text-slate-400">Current Tier</p>
                <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-slate-100">
                  {isAdmin ? 'Admin' : isPremium ? 'Premium' : 'Free Tier'}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {isAdmin
                    ? 'Unrestricted'
                    : isPremium && validity.isValid
                      ? validity.label
                      : 'BYOK personal keys'}
                </p>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5">
                <p className="text-xs text-slate-400">Total Paid (Approved)</p>
                <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-slate-100">
                  {totalApprovedBdt.toLocaleString()}৳
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {payments.filter((p) => p.status === 'approved').length} approved receipts
                </p>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5">
                <p className="text-xs text-slate-400">Provider Access</p>
                <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-slate-100">
                  {connectedCount} / {PROVIDER_LIST.length}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {isPremium ? 'Admin pool + overrides' : 'Connected personal keys'}
                </p>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5">
                <p className="text-xs text-slate-400">Council Activity</p>
                <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-slate-100">
                  {councils.length}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {usageRecords.length} model runs logged
                </p>
              </div>
            </section>

            {/* Native App Tap-List Action Rows */}
            <section className="bg-[#111827] border border-slate-800 rounded-2xl divide-y divide-slate-800/80 overflow-hidden">
              <button
                type="button"
                onClick={() => onNavigate('connections')}
                className="w-full min-h-[58px] px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-800/35 active:bg-slate-800/60 transition-colors text-left cursor-pointer"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-sky-500/12 border border-sky-500/25 flex items-center justify-center shrink-0">
                    <KeyRound className="w-4 h-4 text-sky-400" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-100">
                      API Connections
                    </span>
                    <span className="block text-xs text-slate-400 truncate">
                      {isPremium
                        ? 'Admin pool active · Optional personal key overrides'
                        : 'Connect BYOK provider keys & view guides'}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0 text-xs text-slate-400 tabular-nums">
                  <span>{connectedCount}/{PROVIDER_LIST.length}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('premium')}
                className="w-full min-h-[58px] px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-800/35 active:bg-slate-800/60 transition-colors text-left cursor-pointer"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-amber-500/12 border border-amber-500/25 flex items-center justify-center shrink-0">
                    <Crown className="w-4 h-4 text-amber-400" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-100">
                      {isPremium && !isAdmin ? 'Renew or Extend Premium' : 'Council Premium Plans'}
                    </span>
                    <span className="block text-xs text-slate-400 truncate">
                      T.U.T. Card Gateway, bKash &amp; Nagad checkout from 29৳
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0 text-xs font-medium text-amber-300 tabular-nums">
                  <span>{isPremium && activePlan ? activePlan.label : '29৳/mo'}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                </span>
              </button>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => onNavigate('admin')}
                  className="w-full min-h-[58px] px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-800/35 active:bg-slate-800/60 transition-colors text-left cursor-pointer"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-4 h-4 text-amber-300" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-amber-200">
                        Admin Portal
                      </span>
                      <span className="block text-xs text-slate-400 truncate">
                        Manage shared API pool, members &amp; payment approvals
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-amber-400/70 shrink-0" />
                </button>
              )}
            </section>

            {/* Payment History & Receipts */}
            <section className="space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-100">
                    Payment History &amp; Receipts
                  </h3>
                  <p className="text-xs text-slate-400">
                    Complete ledger of your T.U.T. Card Gateway, bKash, and Nagad transactions.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search TrxID or plan..."
                      className="w-full sm:w-52 min-h-[40px] pl-8 pr-3 py-1.5 text-xs bg-[#111827] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-xl self-start overflow-x-auto max-w-full">
                    {(
                      [
                        ['all', `All (${payments.length})`],
                        ['approved', 'Approved'],
                        ['pending', 'Pending'],
                        ['rejected', 'Rejected'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPaymentFilter(key)}
                        className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
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

              <div className="bg-[#111827] border border-slate-800 rounded-2xl overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-400">
                      <th className="text-left font-medium px-4 sm:px-5 py-3">Date</th>
                      <th className="text-left font-medium px-4 sm:px-5 py-3">Plan</th>
                      <th className="text-left font-medium px-4 sm:px-5 py-3">Method</th>
                      <th className="text-left font-medium px-4 sm:px-5 py-3">TrxID / Reference</th>
                      <th className="text-right font-medium px-4 sm:px-5 py-3">Amount</th>
                      <th className="text-left font-medium px-4 sm:px-5 py-3">Status</th>
                      <th className="text-right font-medium px-4 sm:px-5 py-3">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 tabular-nums">
                    {filteredPayments.map((p) => {
                      const planInfo = getPremiumPlan(p.cycle);
                      const MethodIcon =
                        p.method === 'mla' ? Landmark : p.method === 'bkash' ? Smartphone : Wallet;
                      return (
                        <tr key={p.id} className="hover:bg-slate-800/25">
                          <td className="px-4 sm:px-5 py-3.5 text-slate-400 whitespace-nowrap">
                            {formatDate(p.createdAt)}
                          </td>
                          <td className="px-4 sm:px-5 py-3.5 text-slate-100 font-medium whitespace-nowrap">
                            {planInfo.label}
                          </td>
                          <td className="px-4 sm:px-5 py-3.5 text-slate-300 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <MethodIcon className="w-3.5 h-3.5 text-slate-400" />
                              {formatMethodLabel(p.method)}
                            </span>
                          </td>
                          <td className="px-4 sm:px-5 py-3.5 font-mono text-xs text-slate-200 whitespace-nowrap">
                            {p.trxId}
                          </td>
                          <td className="px-4 sm:px-5 py-3.5 text-right font-semibold text-slate-100 whitespace-nowrap">
                            {p.amountBdt}৳
                          </td>
                          <td className="px-4 sm:px-5 py-3.5 whitespace-nowrap">
                            {p.status === 'approved' ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Approved
                              </span>
                            ) : p.status === 'rejected' ? (
                              <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                                <XCircle className="w-3.5 h-3.5" />
                                Rejected
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-300 font-medium">
                                <Clock className="w-3.5 h-3.5" />
                                Pending Review
                              </span>
                            )}
                          </td>
                          <td className="px-4 sm:px-5 py-3.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelectedReceipt(p)}
                              className="inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 rounded-xl bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 cursor-pointer"
                            >
                              <Receipt className="w-3.5 h-3.5 text-slate-400" />
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredPayments.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                          <p className="text-sm text-slate-300 font-medium">
                            {payments.length === 0
                              ? 'No payment history recorded yet.'
                              : 'No payments match the selected filter.'}
                          </p>
                          {payments.length === 0 && (
                            <button
                              type="button"
                              onClick={() => onNavigate('premium')}
                              className="mt-3 inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-pointer"
                            >
                              <Crown className="w-3.5 h-3.5" />
                              Explore Premium Plans (29৳)
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* Tab 2: Usage & Guardrails */}
        {currentTab === 'usage' && <PortalUsagePanel />}

        {/* Tab 3: Profile, Export & Account Settings */}
        {currentTab === 'settings' && <PortalSettingsPanel onNavigate={onNavigate} />}
      </div>

      {/* Itemized Payment Receipt Modal */}
      {selectedReceipt && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="receipt-modal-title"
        >
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setSelectedReceipt(null)}
          />
          <div className="relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-700 bg-[#0D1426] text-slate-100 p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs font-medium text-amber-400">Payment Receipt</p>
                <h2 id="receipt-modal-title" className="font-display text-lg font-bold mt-0.5 tabular-nums">
                  {getPremiumPlan(selectedReceipt.cycle).label} · {selectedReceipt.amountBdt}৳
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                aria-label="Close receipt"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs tabular-nums">
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Receipt ID</span>
                <span className="font-mono text-slate-200">{selectedReceipt.id}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Transaction Ref / TrxID</span>
                <span className="font-mono font-semibold text-white">{selectedReceipt.trxId}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Payment Method</span>
                <span className="text-slate-200">{formatMethodLabel(selectedReceipt.method)}</span>
              </div>
              {selectedReceipt.senderNumber && (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Sender Account</span>
                  <span className="font-mono text-slate-200">{selectedReceipt.senderNumber}</span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Account Email</span>
                <span className="text-slate-200 truncate">{selectedReceipt.userEmail}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Submitted At</span>
                <span className="text-slate-200">{formatDateTime(selectedReceipt.createdAt)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Status</span>
                <span
                  className={`font-semibold capitalize ${
                    selectedReceipt.status === 'approved'
                      ? 'text-emerald-400'
                      : selectedReceipt.status === 'rejected'
                        ? 'text-rose-400'
                        : 'text-amber-300'
                  }`}
                >
                  {selectedReceipt.status}
                </span>
              </div>
              {selectedReceipt.reviewNote && (
                <div className="pt-2 border-t border-slate-800 space-y-1">
                  <span className="text-slate-400 block">Verification Note</span>
                  <p className="text-slate-200 leading-relaxed">{selectedReceipt.reviewNote}</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => handleDownloadReceipt(selectedReceipt)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download Receipt
              </button>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
