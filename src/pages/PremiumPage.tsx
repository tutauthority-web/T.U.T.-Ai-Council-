import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Crown,
  Landmark,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wallet,
  X,
} from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import {
  checkMlaMembershipApi,
  fetchTutGatewayConfigApi,
  initTutGatewayCheckoutApi,
  purchasePremiumWithMlaApi,
  submitManualWalletPaymentApi,
  submitPendingGatewayReceiptApi,
  verifyTutGatewayCheckoutApi,
  type TutGatewayPublicConfig,
} from '../lib/apiClient';
import {
  getCachedTutWalletToken,
  signInTutWalletWithGoogle,
} from '../lib/tutWalletFirebase';
import {
  getPremiumPlan,
  PAYMENT_ACCOUNTS,
  PREMIUM_PLANS,
  TUT_HOSTED_CHECKOUT_URL,
  type MlaMemberInfo,
  type PaymentMethod,
  type PremiumPlanDefinition,
  type SubscriptionCycle,
} from '../shared/types';

export const TUT_GATEWAY_PENDING_KEY = 'tut_gateway_pending_order';

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
  initialGatewayReturn?: Record<string, string> | null;
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

  // Hosted Checkout & MLA state
  const [gatewayLaunching, setGatewayLaunching] = useState(false);
  const [gatewayVerifying, setGatewayVerifying] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayProxyBlocked, setGatewayProxyBlocked] = useState<{
    orderId: string;
    receiptRef: string;
    error: string;
  } | null>(null);
  const [gatewayReceiptInput, setGatewayReceiptInput] = useState('');
  const [submittingFallbackReceipt, setSubmittingFallbackReceipt] = useState(false);
  const verifiedReturnOrderRef = useRef<string | null>(null);

  const [mlaDirectOpen, setMlaDirectOpen] = useState(false);
  const [mlaChecking, setMlaChecking] = useState(false);
  const [mlaConfigured, setMlaConfigured] = useState<boolean | null>(null);
  const [mlaFound, setMlaFound] = useState<boolean>(false);
  const [mlaMember, setMlaMember] = useState<MlaMemberInfo | null>(null);
  const [mlaError, setMlaError] = useState<string | null>(null);
  const [gatewayPublicConfig, setGatewayPublicConfig] = useState<TutGatewayPublicConfig | null>(null);
  const [tutWalletToken, setTutWalletToken] = useState<string | null>(null);
  const [tutWalletEmail, setTutWalletEmail] = useState<string | null>(null);
  const [needsWalletSignIn, setNeedsWalletSignIn] = useState(false);
  const [walletConnecting, setWalletConnecting] = useState(false);

  // bKash / Nagad state
  const [trxId, setTrxId] = useState('');
  const [senderNumber, setSenderNumber] = useState('');
  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.emailVerified) return;
    let cancelled = false;
    void fetchTutGatewayConfigApi()
      .then((cfg) => {
        if (!cancelled) setGatewayPublicConfig(cfg);
      })
      .catch(() => {
        // Non-fatal fallback
      });
    return () => {
      cancelled = true;
    };
  }, [user?.emailVerified]);

  const runGatewayReturnVerification = async (params: Record<string, string>) => {
    const orderId = (params.orderId || params.order_id || '').trim();
    if (!orderId) {
      setGatewayError('Returned from T.U.T. Hosted Checkout without an orderId.');
      return;
    }

    setGatewayVerifying(true);
    setGatewayError(null);
    setGatewayProxyBlocked(null);

    try {
      const res = await verifyTutGatewayCheckoutApi(orderId, params);
      if (res.verified) {
        try {
          window.sessionStorage.removeItem(TUT_GATEWAY_PENDING_KEY);
        } catch {
          // Ignore storage error
        }
        onClearGatewayReturn?.();
        await Promise.all([refreshSubscription(), refreshProviderState(true)]);
        const planLabel = res.order ? getPremiumPlan(res.order.cycle).label : 'Premium';
        const refLabel = res.payment?.trxId || orderId;
        setBannerSuccess(
          `Council Premium (${planLabel}) verified and activated via T.U.T. Hosted Checkout · Ref ${refLabel}.`,
        );
        return;
      }

      if (res.proxyBlocked) {
        let detectedRef =
          params.receipt ||
          params.receiptId ||
          params.trxId ||
          params.transactionId ||
          orderId;

        // Probe browser session against hosted verify-receipt (cannot self-activate without server verification)
        try {
          const verifyTarget =
            gatewayPublicConfig?.verifyReceiptUrl ||
            `${new URL(TUT_HOSTED_CHECKOUT_URL).origin}/api/gateway/verify-receipt`;
          const clientRes = await fetch(verifyTarget, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              orderId,
              amount: res.order?.amountBdt,
              merchant: res.order?.merchant,
              receipt: params.receipt || undefined,
              receiptId: params.receiptId || undefined,
              trxId: params.trxId || undefined,
              transactionId: params.transactionId || undefined,
              params,
            }),
          });
          if (clientRes.ok) {
            const clientJson = (await clientRes.json().catch(() => null)) as Record<
              string,
              unknown
            > | null;
            if (clientJson) {
              const maybeRef =
                clientJson.trxId ||
                clientJson.transactionId ||
                clientJson.receiptId ||
                clientJson.receipt;
              if (typeof maybeRef === 'string' && maybeRef.trim()) {
                detectedRef = maybeRef.trim();
              }
            }
          }
        } catch {
          // Cross-origin / proxy block expected in preview sandbox
        }

        setGatewayReceiptInput(detectedRef);
        setGatewayProxyBlocked({
          orderId,
          receiptRef: detectedRef,
          error:
            res.error ||
            'Server-to-server receipt verification was blocked by preview cookie authentication.',
        });
        return;
      }

      setGatewayError(res.error || 'T.U.T. receipt verification could not be confirmed.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('cancelled') || msg.toLowerCase().includes('canceled')) {
        try {
          window.sessionStorage.removeItem(TUT_GATEWAY_PENDING_KEY);
        } catch {
          // Ignore
        }
        onClearGatewayReturn?.();
      }
      setGatewayError(msg);
    } finally {
      setGatewayVerifying(false);
    }
  };

  useEffect(() => {
    if (!initialGatewayReturn || !user?.emailVerified) return;
    const key =
      (initialGatewayReturn.orderId || initialGatewayReturn.order_id || '').trim() ||
      JSON.stringify(initialGatewayReturn);
    if (verifiedReturnOrderRef.current === key) return;
    verifiedReturnOrderRef.current = key;
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
    setMlaError(null);
    setTrxId('');
    setSenderNumber('');
  };

  const handleCheckMla = async (explicitWalletToken?: string) => {
    setMlaChecking(true);
    setMlaError(null);
    setCheckoutError(null);
    try {
      let tokenToUse = explicitWalletToken || tutWalletToken || undefined;
      if (!tokenToUse && gatewayPublicConfig?.walletFirebaseConfig) {
        const cached = await getCachedTutWalletToken(gatewayPublicConfig.walletFirebaseConfig);
        if (cached?.idToken) {
          tokenToUse = cached.idToken;
          setTutWalletToken(cached.idToken);
          setTutWalletEmail(cached.email);
        }
      }
      const res = await checkMlaMembershipApi(tokenToUse);
      setMlaConfigured(res.configured);
      setMlaFound(res.found);
      setMlaMember(res.member);
      setNeedsWalletSignIn(Boolean(res.needsWalletSignIn));
      if (res.error) setMlaError(res.error);
    } catch (err) {
      setMlaError(err instanceof Error ? err.message : String(err));
    } finally {
      setMlaChecking(false);
    }
  };

  const handleConnectTutWallet = async () => {
    if (!gatewayPublicConfig?.walletFirebaseConfig) return;
    setWalletConnecting(true);
    setMlaError(null);
    try {
      const authRes = await signInTutWalletWithGoogle(gatewayPublicConfig.walletFirebaseConfig);
      setTutWalletToken(authRes.idToken);
      setTutWalletEmail(authRes.email);
      setNeedsWalletSignIn(false);
      await handleCheckMla(authRes.idToken);
    } catch (err) {
      setMlaError(err instanceof Error ? err.message : String(err));
    } finally {
      setWalletConnecting(false);
    }
  };

  const handleLaunchTutHostedCheckout = async () => {
    if (!checkoutPlan) return;
    setGatewayLaunching(true);
    setCheckoutError(null);
    try {
      const returnUrl = window.location.origin + window.location.pathname;
      const res = await initTutGatewayCheckoutApi(checkoutPlan.cycle, returnUrl);
      try {
        window.sessionStorage.setItem(
          TUT_GATEWAY_PENDING_KEY,
          JSON.stringify({
            orderId: res.order.orderId,
            cycle: checkoutPlan.cycle,
            amountBdt: checkoutPlan.priceBdt,
            startedAt: new Date().toISOString(),
          }),
        );
      } catch {
        // Ignore storage failure
      }
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : String(err));
      setGatewayLaunching(false);
    }
  };

  const handleSubmitFallbackGatewayReceipt = async () => {
    if (!gatewayProxyBlocked) return;
    setSubmittingFallbackReceipt(true);
    setGatewayError(null);
    try {
      const payment = await submitPendingGatewayReceiptApi({
        orderId: gatewayProxyBlocked.orderId,
        receiptRef: gatewayReceiptInput.trim() || gatewayProxyBlocked.orderId,
      });
      try {
        window.sessionStorage.removeItem(TUT_GATEWAY_PENDING_KEY);
      } catch {
        // Ignore
      }
      setGatewayProxyBlocked(null);
      onClearGatewayReturn?.();
      await refreshSubscription();
      setBannerSuccess(
        `T.U.T. Hosted Checkout receipt (${payment.trxId}) queued for Admin approval.`,
      );
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingFallbackReceipt(false);
    }
  };

  const handlePurchaseWithMla = async () => {
    if (!checkoutPlan) return;
    setSubmitting(true);
    setCheckoutError(null);
    try {
      const res = await purchasePremiumWithMlaApi(
        checkoutPlan.cycle,
        tutWalletToken || undefined,
      );
      await refreshSubscription();
      await refreshProviderState(true);
      setCheckoutPlan(null);
      setBannerSuccess(
        `Premium (${checkoutPlan.label}) activated immediately via T.U.T. MLA Account. Remaining balance: ${res.updatedBalanceBdt.toLocaleString()}৳.`,
      );
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
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

  const insufficientMlaBalance = Boolean(
    checkoutPlan && mlaFound && mlaMember && mlaMember.balanceBdt < checkoutPlan.priceBdt,
  );

  return (
    <AppShell
      currentRoute="premium"
      pageTitle="Council Premium"
      breadcrumb="Membership"
      onNavigate={onNavigate}
      primaryAction={
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Playground
        </button>
      }
    >
      <div className="space-y-8 pb-8">
        {/* Hero Header */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-slate-800/80 pb-6">
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

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {user?.emailVerified && (
              <button
                type="button"
                onClick={() => onNavigate('portal')}
                className="min-h-[44px] px-4 py-2 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
              >
                User Portal &amp; Validity
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('new-council')}
              className="min-h-[44px] px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              Launch Council
            </button>
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
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('portal')}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium whitespace-nowrap cursor-pointer"
              >
                Validity &amp; Receipts
              </button>
              <button
                type="button"
                onClick={() => onNavigate('new-council')}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                Start Auto Council
              </button>
            </div>
          </section>
        )}

        {/* Slim Admin Portal Redirect Strip (Admin Billing moved to dedicated Admin Portal) */}
        {isAdmin && (
          <section className="rounded-xl border border-amber-500/30 bg-[#0D1426] px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 text-amber-200">
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Admin billing approvals, subscriber validity controls, Shared API Pool, and T.U.T. PLA/MLA configuration now live in the dedicated Admin Portal.
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
                Returned from T.U.T. Hosted Checkout ({initialGatewayReturn.orderId || 'Order'}). Sign in to verify your receipt and activate Premium.
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
            <span>Verifying T.U.T. Hosted Checkout receipt with T.U.T. server...</span>
          </div>
        )}

        {gatewayError && (
          <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-200">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{gatewayError}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {initialGatewayReturn && (
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

        {gatewayProxyBlocked && (
          <section className="rounded-xl border border-amber-500/50 bg-[#121A2F] p-5 space-y-3 text-xs">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-200">
                  T.U.T. Receipt Needs Manual Confirmation ({gatewayProxyBlocked.orderId})
                </p>
                <p className="text-slate-300 leading-relaxed">
                  {gatewayProxyBlocked.error} Enter your T.U.T. receipt or TrxID below to queue it for Admin approval, or retry verification if preview access is open.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={gatewayReceiptInput}
                onChange={(e) => setGatewayReceiptInput(e.target.value)}
                placeholder="Receipt / TrxID / Order ID"
                className="flex-1 min-h-[40px] px-3 py-1.5 bg-[#090E1A] border border-slate-700 rounded-lg text-slate-100 font-mono uppercase"
              />
              {initialGatewayReturn && (
                <button
                  type="button"
                  disabled={gatewayVerifying}
                  onClick={() => void runGatewayReturnVerification(initialGatewayReturn)}
                  className="min-h-[40px] px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer whitespace-nowrap"
                >
                  Retry Auto Verify
                </button>
              )}
              <button
                type="button"
                disabled={submittingFallbackReceipt}
                onClick={() => void handleSubmitFallbackGatewayReceipt()}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {submittingFallbackReceipt
                  ? 'Queueing...'
                  : 'Submit Receipt for Admin Approval'}
              </button>
            </div>
          </section>
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
                Instant activation via T.U.T. Money Lending Authority Card/Account, or Send Money via bKash / Nagad.
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
              <Landmark className="w-4 h-4 text-sky-400 shrink-0" />
              <span>T.U.T. Money Lending Authority</span>
            </p>
            <p className="text-slate-400 leading-relaxed">
              Verified Gmail membership check &amp; live balance sync directly with MLA Firestore for instant activation.
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
                      <td className="px-5 py-3 text-slate-300 uppercase">{p.method}</td>
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
            onClick={() => !submitting && setCheckoutPlan(null)}
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
                disabled={submitting}
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
                    { id: 'mla', label: 'T.U.T. MLA' },
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

            {/* 1. T.U.T. MLA Hosted Checkout + Direct Sync Flow */}
            {paymentMethod === 'mla' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/35 bg-[#121A2F] p-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <Landmark className="w-4 h-4" />
                      T.U.T. Hosted Checkout Gateway
                    </span>
                    <span className="font-mono text-slate-300 tabular-nums">
                      {checkoutPlan.priceBdt}৳
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    Opens T.U.T. Money Lending Authority Pay safely in your current window (mobile &amp; iframe ready), verifies your receipt on return, and activates <strong className="text-white">{checkoutPlan.label}</strong> automatically.
                  </p>
                  <button
                    type="button"
                    disabled={gatewayLaunching || submitting}
                    onClick={() => void handleLaunchTutHostedCheckout()}
                    className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 disabled:opacity-50 text-slate-950 text-sm font-bold cursor-pointer"
                  >
                    <span>
                      {gatewayLaunching
                        ? 'Redirecting to T.U.T. Pay...'
                        : `Pay ${checkoutPlan.priceBdt}৳ with T.U.T. Hosted Checkout`}
                    </span>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Secondary collapsible Direct MLA Firestore Sync */}
                <div className="rounded-xl border border-slate-800 bg-[#090E1A] overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setMlaDirectOpen((v) => !v)}
                    className="w-full px-4 py-3 flex items-center justify-between text-slate-300 hover:text-white cursor-pointer"
                  >
                    <span className="font-medium">Direct MLA Gmail Balance Sync (Firestore)</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform ${
                        mlaDirectOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {mlaDirectOpen && (
                    <div className="px-4 pb-4 pt-2 border-t border-slate-800 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Verified Gmail</span>
                        <span className="font-medium text-slate-100 truncate">{user?.email}</span>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          disabled={mlaChecking || walletConnecting}
                          onClick={() => void handleCheckMla()}
                          className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold cursor-pointer disabled:opacity-60"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${mlaChecking ? 'animate-spin' : ''}`} />
                          {mlaChecking
                            ? 'Syncing T.U.T. Wallet Balance...'
                            : 'Check MLA Membership & Balance'}
                        </button>

                        {gatewayPublicConfig?.walletFirebaseConfig && (
                          <button
                            type="button"
                            disabled={walletConnecting || mlaChecking}
                            onClick={() => void handleConnectTutWallet()}
                            className={`min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-60 whitespace-nowrap ${
                              needsWalletSignIn
                                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                : 'bg-[#121A2F] hover:bg-slate-800 border border-slate-700 text-slate-200'
                            }`}
                          >
                            <Wallet className="w-3.5 h-3.5" />
                            {walletConnecting
                              ? 'Connecting...'
                              : tutWalletToken
                                ? `Wallet Linked (${tutWalletEmail || 'Google'})`
                                : 'Connect T.U.T. Wallet Account'}
                          </button>
                        )}
                      </div>

                      {mlaConfigured === false && (
                        <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 p-3 text-amber-200 leading-relaxed">
                          Direct MLA Firestore Project ID is not linked. Use T.U.T. Hosted Checkout above or pay via bKash / Nagad.
                        </div>
                      )}

                      {mlaConfigured && !mlaFound && !mlaError && (
                        <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-300 leading-relaxed">
                          No T.U.T. MLA member account found matching{' '}
                          <strong className="text-white">{user?.email}</strong>.
                        </div>
                      )}

                      {mlaError && (
                        <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 p-3 text-rose-300 leading-relaxed space-y-2">
                          <p>{mlaError}</p>
                          {needsWalletSignIn && gatewayPublicConfig?.walletFirebaseConfig && (
                            <button
                              type="button"
                              disabled={walletConnecting}
                              onClick={() => void handleConnectTutWallet()}
                              className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
                            >
                              <Wallet className="w-3.5 h-3.5" />
                              Authorize T.U.T. Wallet Google Account
                            </button>
                          )}
                        </div>
                      )}

                      {mlaFound && mlaMember && (
                        <div className="border-t border-slate-800 pt-3 space-y-2 tabular-nums">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Member Name</span>
                            <span className="font-medium text-slate-100">
                              {mlaMember.displayName}
                            </span>
                          </div>
                          {(mlaMember.cardLabel || mlaMember.accountNumber) && (
                            <div className="flex justify-between">
                              <span className="text-slate-400">Card / Account</span>
                              <span className="font-mono text-slate-200">
                                {mlaMember.cardLabel || mlaMember.accountNumber}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-slate-400">Available Balance</span>
                            <span
                              className={`font-bold ${
                                insufficientMlaBalance ? 'text-rose-400' : 'text-emerald-400'
                              }`}
                            >
                              {mlaMember.balanceBdt.toLocaleString()}৳
                            </span>
                          </div>
                          {insufficientMlaBalance && (
                            <p className="text-rose-300 pt-1">
                              Balance is {(checkoutPlan.priceBdt - mlaMember.balanceBdt).toFixed(0)}৳ short for {checkoutPlan.label}.
                            </p>
                          )}
                          <button
                            type="button"
                            disabled={submitting || !mlaFound || insufficientMlaBalance}
                            onClick={() => void handlePurchaseWithMla()}
                            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-45 text-white text-xs font-bold cursor-pointer mt-2"
                          >
                            {submitting
                              ? 'Deducting & Activating...'
                              : `Deduct ${checkoutPlan.priceBdt}৳ from MLA Balance`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
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
