import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Crown,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wallet,
  X,
} from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import {
  createTutGatewaySessionApi,
  submitManualWalletPaymentApi,
  verifyTutGatewayPaymentApi,
} from '../lib/apiClient';
import {
  getPremiumPlan,
  PAYMENT_ACCOUNTS,
  PREMIUM_PLANS,
  type PaymentMethod,
  type PremiumPlanDefinition,
  type SubscriptionCycle,
} from '../shared/types';

export interface TutGatewayReturnParams {
  tutToken?: string;
  tutStatus?: string;
  orderId?: string;
}

function formatDateLabel(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function PremiumPage({
  onNavigate,
  initialGatewayReturn = null,
  onClearGatewayReturn,
}: {
  onNavigate: (route: AppRoute) => void;
  initialGatewayReturn?: TutGatewayReturnParams | null;
  onClearGatewayReturn?: () => void;
}) {
  const {
    user,
    subscription,
    payments,
    isPremium,
    isAdmin,
    refreshSubscription,
    refreshProviderState,
  } = useAuth();

  const [selectedCycle, setSelectedCycle] = useState<SubscriptionCycle>('6m');
  const [checkoutPlan, setCheckoutPlan] = useState<PremiumPlanDefinition | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mla');

  // T.U.T. Card / Account Gateway state
  const [gatewayLaunching, setGatewayLaunching] = useState(false);
  const [gatewayVerifying, setGatewayVerifying] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const verifiedReturnKeyRef = useRef<string | null>(null);

  // bKash / Nagad state
  const [trxId, setTrxId] = useState('');
  const [senderNumber, setSenderNumber] = useState('');
  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  const runGatewayReturnVerification = async (params: TutGatewayReturnParams) => {
    setGatewayVerifying(true);
    setGatewayError(null);

    try {
      const res = await verifyTutGatewayPaymentApi({
        token: params.tutToken,
        orderId: params.orderId,
        tutStatus: params.tutStatus,
      });

      if (res.verified) {
        onClearGatewayReturn?.();
        await Promise.all([refreshSubscription(), refreshProviderState(true)]);
        const planLabel = res.order ? getPremiumPlan(res.order.cycle).label : 'Premium';
        const memoSuffix = res.memoId ? ` · Memo ${res.memoId}` : '';
        const orderSuffix = res.order?.orderId ? ` · ${res.order.orderId}` : '';
        setBannerSuccess(
          `Council Premium (${planLabel}) verified and activated via T.U.T. Card Gateway${orderSuffix}${memoSuffix}.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('cancel') || lower.includes('declined') || lower.includes('rejected')) {
        onClearGatewayReturn?.();
      }
      setGatewayError(msg);
    } finally {
      setGatewayVerifying(false);
    }
  };

  useEffect(() => {
    if (!initialGatewayReturn || !user?.emailVerified) return;
    const key = JSON.stringify(initialGatewayReturn);
    if (verifiedReturnKeyRef.current === key) return;
    verifiedReturnKeyRef.current = key;
    void runGatewayReturnVerification(initialGatewayReturn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGatewayReturn, user?.emailVerified]);

  const handleOpenCheckout = (plan: PremiumPlanDefinition) => {
    setBannerSuccess(null);
    setCheckoutError(null);
    if (!user || !user.emailVerified) {
      onNavigate('auth');
      return;
    }
    setSelectedCycle(plan.cycle);
    setCheckoutPlan(plan);
    setTrxId('');
    setSenderNumber('');
  };

  const handleLaunchTutCheckout = async () => {
    if (!checkoutPlan) return;
    setGatewayLaunching(true);
    setCheckoutError(null);
    try {
      const returnUrl = `${window.location.origin}/payment-callback`;
      const res = await createTutGatewaySessionApi(checkoutPlan.cycle, returnUrl);
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : String(err));
      setGatewayLaunching(false);
    }
  };

  const handleSubmitManualPayment = async () => {
    if (!checkoutPlan || (paymentMethod !== 'bkash' && paymentMethod !== 'nagad')) return;
    if (!trxId.trim()) {
      setCheckoutError('Enter the exact Transaction ID (TrxID) after sending money.');
      return;
    }
    setSubmitting(true);
    setCheckoutError(null);
    try {
      await submitManualWalletPaymentApi({
        method: paymentMethod,
        cycle: checkoutPlan.cycle,
        trxId: trxId.trim(),
        senderNumber: senderNumber.trim() || undefined,
      });
      await refreshSubscription();
      setCheckoutPlan(null);
      setBannerSuccess(
        `${PAYMENT_ACCOUNTS[paymentMethod].label} payment (${checkoutPlan.priceBdt}৳ · TrxID ${trxId
          .trim()
          .toUpperCase()}) submitted. Admin will verify and activate Premium shortly.`,
      );
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyNumber = (num: string) => {
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(num);
      setCopiedAccount(num);
      setTimeout(() => setCopiedAccount((curr) => (curr === num ? null : curr)), 1800);
    }
  };

  const activePlan = subscription?.cycle ? getPremiumPlan(subscription.cycle) : null;

  const activeWalletInfo =
    paymentMethod === 'bkash' || paymentMethod === 'nagad'
      ? PAYMENT_ACCOUNTS[paymentMethod]
      : null;

  return (
    <AppShell
      currentRoute="premium"
      pageTitle="Council Premium"
      onNavigate={onNavigate}
      primaryAction={
        <button
          type="button"
          onClick={() => onNavigate('new-council')}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors whitespace-nowrap cursor-pointer"
        >
          Launch Council
        </button>
      }
    >
      <div className="space-y-8 pb-8">
        {/* Hero Header */}
        <section className="border-b border-slate-800/80 pb-6">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
              <Crown className="w-4 h-4" />
              <span>T.U.T AI Council Membership</span>
            </p>
            <h2
              className="font-display text-2xl sm:text-3xl font-bold text-slate-50 leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Zero API key setup. Automatic multi-AI council seating.
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Free accounts run on your own API keys (BYOK). Premium accounts use Admin-connected APIs automatically and select Council models by intelligence level using cycling priority: Gemini, Groq, OpenRouter, Cohere.
            </p>
          </div>
        </section>

        {/* Active Membership Banner */}
        {user?.emailVerified && isPremium && (
          <section className="rounded-xl border border-amber-500/45 bg-[#121A2F] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-amber-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{isAdmin ? 'Admin Full Access Active' : 'Council Premium Active'}</span>
                {activePlan && !isAdmin && (
                  <>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-slate-200 tabular-nums">
                      {activePlan.label} ({activePlan.priceBdt}৳)
                    </span>
                  </>
                )}
                {subscription?.expiresAt && !isAdmin && (
                  <>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-slate-400 tabular-nums">
                      Expires {formatDateLabel(subscription.expiresAt)}
                    </span>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-300">
                Admin-managed APIs and automatic cycling priority selection are active across New Council and AI Model Land.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('portal')}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              Validity &amp; Receipts
            </button>
          </section>
        )}

        {/* Slim Admin Portal Redirect Strip */}
        {isAdmin && (
          <section className="rounded-xl border border-amber-500/30 bg-[#0D1426] px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 text-amber-200">
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Admin billing approvals, subscriber validity controls, Shared API Pool, and T.U.T. Gateway settings live in the dedicated Admin Portal.
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Open Admin Portal</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </section>
        )}

        {initialGatewayReturn && !user?.emailVerified && (
          <div className="rounded-xl border border-amber-500/50 bg-[#121A2F] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 text-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Returned from T.U.T. Card Checkout. Sign in to verify your payment token and activate Premium.
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('auth')}
              className="min-h-[38px] px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold whitespace-nowrap cursor-pointer"
            >
              Sign In to Verify
            </button>
          </div>
        )}

        {gatewayVerifying && (
          <div className="rounded-xl border border-blue-700/60 bg-blue-950/35 p-4 flex items-center gap-3 text-sm text-blue-200">
            <RefreshCw className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
            <span>Verifying payment token with T.U.T. Money Lending Authority Gateway...</span>
          </div>
        )}

        {gatewayError && (
          <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-200">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{gatewayError}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {initialGatewayReturn?.tutToken && (
                <button
                  type="button"
                  disabled={gatewayVerifying}
                  onClick={() => void runGatewayReturnVerification(initialGatewayReturn)}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-800/70 text-rose-100 font-semibold cursor-pointer"
                >
                  Retry Verification
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setGatewayError(null);
                  onClearGatewayReturn?.();
                }}
                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {bannerSuccess && (
          <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/35 p-4 flex items-center gap-3 text-sm text-emerald-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{bannerSuccess}</span>
          </div>
        )}

        {/* Two-Tier Comparison */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
          <article className="rounded-xl border border-slate-800 bg-[#111827] p-6 space-y-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-display text-lg font-bold text-slate-100">Free Tier</h3>
              <span className="font-display text-xl font-bold text-slate-300 tabular-nums">
                0৳ <span className="text-xs font-normal text-slate-500">/ forever</span>
              </span>
            </div>
            <p className="text-xs text-slate-400">
              For explorers connecting personal provider keys.
            </p>
            <div className="border-t border-slate-800/80 pt-4 space-y-2.5 text-xs text-slate-300">
              <div className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>Connect your own API keys across all 12 AI providers (BYOK)</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>Manual model picking or Smart Fill from your connected keys</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>Full 3D AI Playground &amp; AI Model Land access</span>
              </div>
            </div>
          </article>

          <article className="rounded-xl border border-amber-500/45 bg-[#121A2F] p-6 space-y-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-display text-lg font-bold text-amber-300">Council Premium</h3>
              <span className="font-display text-xl font-bold text-white tabular-nums">
                From 29৳ <span className="text-xs font-normal text-slate-400">/ month</span>
              </span>
            </div>
            <p className="text-xs text-slate-300">
              For instant councils without managing or paying individual provider API keys.
            </p>
            <div className="border-t border-slate-800/80 pt-4 space-y-2.5 text-xs text-slate-200">
              <div className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>Uses Admin-connected shared APIs automatically (zero API setup)</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>Automatic cycling seating: Gemini → Groq → OpenRouter → Cohere</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>Intelligence selector (Low default, Medium, High, Extreme)</span>
              </div>
            </div>
          </article>
        </section>

        {/* BDT Pricing Plan Selector */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-100">
                Choose Premium Duration
              </h3>
              <p className="text-xs text-slate-400">
                Instant activation via T.U.T. Card Checkout, or Send Money via bKash / Nagad.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
            {PREMIUM_PLANS.map((plan) => {
              const selected = selectedCycle === plan.cycle;
              return (
                <article
                  key={plan.cycle}
                  className={`flex flex-col justify-between rounded-xl border p-5 space-y-5 transition-colors ${
                    plan.popular || selected
                      ? 'bg-[#131C31] border-amber-400/60'
                      : 'bg-[#111827] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-base font-bold text-slate-100">
                        {plan.label}
                      </span>
                      {plan.savingsLabel && (
                        <span className="text-[11px] font-medium text-amber-300">
                          {plan.savingsLabel}
                        </span>
                      )}
                    </div>

                    <div className="flex items-baseline gap-1.5 tabular-nums">
                      <span className="font-display text-3xl font-bold text-white">
                        {plan.priceBdt}৳
                      </span>
                      <span className="text-xs text-slate-400">
                        · ~{plan.perMonthBdt}৳/mo
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 tabular-nums">
                      {plan.durationDays} days full Admin API access
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenCheckout(plan)}
                    className={`w-full min-h-[44px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      plan.popular
                        ? 'bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {!user || !user.emailVerified
                      ? `Sign In · ${plan.priceBdt}৳`
                      : isPremium
                        ? `Extend ${plan.label} (${plan.priceBdt}৳)`
                        : `Select ${plan.label} · ${plan.priceBdt}৳`}
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        {/* Accepted Payment Methods Info Strip */}
        <section className="rounded-xl border border-slate-800 bg-[#111827] p-5 grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
          <div className="space-y-1">
            <p className="font-semibold text-slate-100 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-amber-400 shrink-0" />
              <span>T.U.T. Card Checkout</span>
            </p>
            <p className="text-slate-400 leading-relaxed">
              Tamper-proof hosted session via T.U.T. Money Lending Authority Gateway with instant server-side token verification.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-slate-100 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-rose-400 shrink-0" />
              <span>bKash Personal · {PAYMENT_ACCOUNTS.bkash.number}</span>
            </p>
            <p className="text-slate-400 leading-relaxed">
              Send Money to {PAYMENT_ACCOUNTS.bkash.number} and enter your TrxID for fast Admin verification.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-slate-100 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-orange-400 shrink-0" />
              <span>Nagad Personal · {PAYMENT_ACCOUNTS.nagad.number}</span>
            </p>
            <p className="text-slate-400 leading-relaxed">
              Send Money to {PAYMENT_ACCOUNTS.nagad.number} and enter your TrxID for fast Admin verification.
            </p>
          </div>
        </section>

        {/* Recent User Payment Summary + Link to Full User Portal */}
        {user?.emailVerified && payments.length > 0 && (
          <section className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="font-display text-base font-semibold text-slate-100">
                Recent Payment Submissions
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('portal')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer self-start sm:self-auto"
              >
                <span>View Full Validity &amp; Receipts in User Portal</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-400">
                    <th className="text-left font-medium px-5 py-3">Date</th>
                    <th className="text-left font-medium px-5 py-3">Plan</th>
                    <th className="text-left font-medium px-5 py-3">Method</th>
                    <th className="text-left font-medium px-5 py-3">TrxID</th>
                    <th className="text-right font-medium px-5 py-3">Amount</th>
                    <th className="text-right font-medium px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 tabular-nums">
                  {payments.slice(0, 5).map((p) => (
                    <tr key={p.id}>
                      <td className="px-5 py-3 text-slate-400 whitespace-nowrap">
                        {formatDateLabel(p.createdAt)}
                      </td>
                      <td className="px-5 py-3 text-slate-200 whitespace-nowrap">
                        {getPremiumPlan(p.cycle).label}
                      </td>
                      <td className="px-5 py-3 text-slate-300 uppercase">
                        {p.method === 'mla' ? 'T.U.T. Gateway' : p.method}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-300">{p.trxId}</td>
                      <td className="px-5 py-3 text-right font-medium text-slate-100">
                        {p.amountBdt}৳
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <span
                          className={
                            p.status === 'approved'
                              ? 'text-emerald-400 font-medium'
                              : p.status === 'rejected'
                                ? 'text-rose-400 font-medium'
                                : 'text-amber-300 font-medium'
                          }
                        >
                          {p.status === 'approved'
                            ? 'Approved'
                            : p.status === 'rejected'
                              ? 'Rejected'
                              : 'Pending Review'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Interactive 3-Method BDT Checkout Modal */}
      {checkoutPlan && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-modal-title"
        >
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => !submitting && !gatewayLaunching && setCheckoutPlan(null)}
          />
          <div className="relative z-10 w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-slate-700 bg-[#0D1426] text-slate-100 p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs font-medium text-amber-400">Premium Checkout</p>
                <h2 id="checkout-modal-title" className="font-display text-xl font-bold mt-0.5 tabular-nums">
                  {checkoutPlan.label} · {checkoutPlan.priceBdt}৳
                </h2>
              </div>
              <button
                type="button"
                disabled={submitting || gatewayLaunching}
                onClick={() => setCheckoutPlan(null)}
                aria-label="Close checkout"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Payment Method Tabs */}
            <div className="space-y-2">
              <span className="block text-xs font-medium text-slate-300">Payment Method</span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'mla', label: 'T.U.T. Card' },
                    { id: 'bkash', label: 'bKash' },
                    { id: 'nagad', label: 'Nagad' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(m.id);
                      setCheckoutError(null);
                    }}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                      paymentMethod === m.id
                        ? 'bg-blue-600/20 border-blue-500 text-white'
                        : 'bg-[#090E1A] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 1. T.U.T. Money Lending Authority Card Checkout */}
            {paymentMethod === 'mla' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/35 bg-[#121A2F] p-5 space-y-3.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4" />
                      T.U.T. Money Lending Authority Checkout
                    </span>
                    <span className="font-mono text-slate-200 font-semibold tabular-nums">
                      {checkoutPlan.priceBdt}৳
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    Creates a tamper-proof checkout session on T.U.T. Money Lending Authority, redirects securely for Card / Account payment, verifies your paid token on return, and activates <strong className="text-white">{checkoutPlan.label}</strong> immediately.
                  </p>
                  <button
                    type="button"
                    disabled={gatewayLaunching || submitting}
                    onClick={() => void handleLaunchTutCheckout()}
                    className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 disabled:opacity-50 text-slate-950 text-sm font-bold cursor-pointer"
                  >
                    <span>
                      {gatewayLaunching
                        ? 'Creating Secure Session...'
                        : `Pay ${checkoutPlan.priceBdt}৳ with T.U.T. Gateway`}
                    </span>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                </div>

                {checkoutError && (
                  <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-300">
                    {checkoutError}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={submitting || gatewayLaunching}
                    onClick={() => setCheckoutPlan(null)}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* 2. bKash / Nagad Personal Send Money Flow */}
            {activeWalletInfo && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-[#090E1A] p-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-slate-400">
                        {activeWalletInfo.label} · {activeWalletInfo.accountType} ({activeWalletInfo.actionType})
                      </p>
                      <p className="font-mono text-lg font-bold text-white mt-0.5 tabular-nums">
                        {activeWalletInfo.number}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyNumber(activeWalletInfo.number)}
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium cursor-pointer whitespace-nowrap"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {copiedAccount === activeWalletInfo.number ? 'Copied' : 'Copy'}
                    </button>
                  </div>

                  <div className="border-t border-slate-800 pt-3 space-y-1.5 text-slate-300">
                    <p>
                      <span className="font-mono text-slate-500">01.</span> Open{' '}
                      {activeWalletInfo.label} and select <strong>Send Money</strong>.
                    </p>
                    <p>
                      <span className="font-mono text-slate-500">02.</span> Send exact{' '}
                      <strong className="text-amber-300 tabular-nums">
                        {checkoutPlan.priceBdt}৳
                      </strong>{' '}
                      to <strong className="font-mono">{activeWalletInfo.number}</strong>.
                    </p>
                    <p>
                      <span className="font-mono text-slate-500">03.</span> Enter your Transaction ID (TrxID) below for verification.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="trx-id" className="block text-xs font-medium text-slate-300">
                      Transaction ID (TrxID)
                    </label>
                    <input
                      id="trx-id"
                      type="text"
                      required
                      maxLength={40}
                      value={trxId}
                      onChange={(e) => setTrxId(e.target.value)}
                      placeholder="e.g. BL48X9P2QA"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 placeholder-slate-500 font-mono uppercase focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="sender-num" className="block text-xs font-medium text-slate-300">
                      Your {activeWalletInfo.label} Number (optional)
                    </label>
                    <input
                      id="sender-num"
                      type="tel"
                      maxLength={20}
                      value={senderNumber}
                      onChange={(e) => setSenderNumber(e.target.value)}
                      placeholder="01XXXXXXXXX"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 placeholder-slate-500 font-mono focus:outline-none"
                    />
                  </div>
                </div>

                {checkoutError && (
                  <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-300">
                    {checkoutError}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setCheckoutPlan(null)}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submitting || !trxId.trim()}
                    onClick={() => void handleSubmitManualPayment()}
                    className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-45 text-white text-sm font-semibold cursor-pointer"
                  >
                    {submitting
                      ? 'Submitting TrxID...'
                      : `Submit ${activeWalletInfo.label} TrxID (${checkoutPlan.priceBdt}৳)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
