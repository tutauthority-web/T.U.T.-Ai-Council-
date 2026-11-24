import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Crown, KeyRound } from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { updateUserProfileSettings } from '../lib/firestoreService';
import { isValidProviderId, PROVIDER_LIST, PROVIDER_REGISTRY } from '../shared/providers';
import { getPremiumPlan } from '../shared/types';

export function UsageBillingPage({
  onNavigate,
}: {
  onNavigate: (route: AppRoute) => void;
}) {
  const { user, profile, subscription, isPremium, isAdmin, usageRecords, sessionUsage } = useAuth();

  const [maxRoundsLimit, setMaxRoundsLimit] = useState(profile?.maxRoundsLimit ?? 6);
  const [dailyRequestLimit, setDailyRequestLimit] = useState(profile?.dailyRequestLimit ?? 250);
  const [monthlySpendLimitUsd, setMonthlySpendLimitUsd] = useState(
    profile?.monthlySpendLimitUsd ?? 50,
  );
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setMaxRoundsLimit(profile.maxRoundsLimit ?? 6);
    setDailyRequestLimit(profile.dailyRequestLimit ?? 250);
    setMonthlySpendLimitUsd(profile.monthlySpendLimitUsd ?? 50);
  }, [profile]);

  const byProvider = useMemo(() => {
    const map = new Map<
      string,
      {
        provider: string;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
        hasKnownPricing: boolean;
      }
    >();
    for (const r of usageRecords) {
      const cur = map.get(r.provider) || {
        provider: r.provider,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        hasKnownPricing: false,
      };
      cur.requests += 1;
      cur.inputTokens += r.inputTokens || 0;
      cur.outputTokens += r.outputTokens || 0;
      if (r.pricingKnown) {
        cur.estimatedCostUsd += r.estimatedCostUsd || 0;
        cur.hasKnownPricing = true;
      }
      map.set(r.provider, cur);
    }
    return Array.from(map.values());
  }, [usageRecords]);

  const byModel = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        provider: string;
        modelId: string;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
        hasKnownPricing: boolean;
      }
    >();
    for (const r of usageRecords) {
      const key = `${r.provider}:${r.modelId}`;
      const cur = map.get(key) || {
        key,
        provider: r.provider,
        modelId: r.modelId,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        hasKnownPricing: false,
      };
      cur.requests += 1;
      cur.inputTokens += r.inputTokens || 0;
      cur.outputTokens += r.outputTokens || 0;
      if (r.pricingKnown) {
        cur.estimatedCostUsd += r.estimatedCostUsd || 0;
        cur.hasKnownPricing = true;
      }
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.requests - a.requests);
  }, [usageRecords]);

  const handleSaveLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSavedNotice(null);
    try {
      await updateUserProfileSettings(user.uid, {
        maxRoundsLimit,
        dailyRequestLimit,
        monthlySpendLimitUsd,
      });
      setSavedNotice('Usage guardrails updated.');
    } finally {
      setSaving(false);
    }
  };

  const totalRecordedKnownCost = byProvider.reduce(
    (s, p) => s + (p.hasKnownPricing ? p.estimatedCostUsd : 0),
    0,
  );

  const activePlanInfo = subscription?.cycle ? getPremiumPlan(subscription.cycle) : null;
  const expiryLabel = subscription?.expiresAt
    ? new Date(subscription.expiresAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <AppShell
      currentRoute="usage"
      pageTitle="Usage & Billing"
      breadcrumb="Workspace"
      onNavigate={onNavigate}
      primaryAction={
        <button
          type="button"
          onClick={() => onNavigate('premium')}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <Crown className="w-3.5 h-3.5" />
          {isPremium ? 'Membership' : 'Upgrade'}
        </button>
      }
    >
      <div className="space-y-8">
        {/* Two-Tier Membership & Billing Overview */}
        <section
          className={`rounded-xl border p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5 ${
            isPremium
              ? 'bg-[#121A2F] border-amber-500/40'
              : 'bg-[#111827] border-slate-800'
          }`}
        >
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className={isPremium ? 'text-amber-300' : 'text-sky-400'}>
                {isAdmin
                  ? 'Admin Account · Managed Pool Active'
                  : isPremium
                    ? 'Premium Tier · Admin-Managed APIs'
                    : 'Free Tier · Bring Your Own Key (BYOK)'}
              </span>
              {activePlanInfo && isPremium && !isAdmin && (
                <>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-slate-300 tabular-nums">
                    {activePlanInfo.label} ({activePlanInfo.priceBdt}৳)
                  </span>
                </>
              )}
              {expiryLabel && isPremium && !isAdmin && (
                <>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-slate-400 tabular-nums">Renews {expiryLabel}</span>
                </>
              )}
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              {isPremium
                ? 'Your workspace runs automatically on Admin-connected provider APIs with cycling priority selection (Gemini, Groq, OpenRouter, Cohere) based on your chosen intelligence level. Known model rates are tracked below.'
                : `Free workspaces use your own connected API keys across ${PROVIDER_LIST.map((p) => p.shortName).join(', ')}. Upgrade to Premium from 29৳ to use Admin-connected APIs with zero key setup.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('portal')}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>User Portal</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('connections')}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Connections
            </button>
            <button
              type="button"
              onClick={() => onNavigate('premium')}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>{isPremium ? 'Renew / Extend' : 'Explore Premium (29৳)'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>

        {/* Session Usage Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <p className="text-xs text-slate-400">Session Requests</p>
            <p className="mt-2 font-display text-2xl font-bold text-slate-100 tabular-nums">
              {sessionUsage.requests}
            </p>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <p className="text-xs text-slate-400">Session Tokens</p>
            <p className="mt-2 font-display text-2xl font-bold text-slate-100 tabular-nums">
              {(sessionUsage.inputTokens + sessionUsage.outputTokens).toLocaleString()}
            </p>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <p className="text-xs text-slate-400">All-Time Requests</p>
            <p className="mt-2 font-display text-2xl font-bold text-slate-100 tabular-nums">
              {usageRecords.length}
            </p>
          </div>
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <p className="text-xs text-slate-400">Known Estimated Spend</p>
            <p className="mt-2 font-display text-2xl font-bold text-slate-100 tabular-nums">
              ${totalRecordedKnownCost.toFixed(4)}
            </p>
          </div>
        </section>

        {/* Requests by Provider */}
        <section className="space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-100">
            Usage by Provider
          </h2>
          <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="text-left font-medium px-5 py-3">Provider</th>
                  <th className="text-right font-medium px-5 py-3">Requests</th>
                  <th className="text-right font-medium px-5 py-3">Input Tokens</th>
                  <th className="text-right font-medium px-5 py-3">Output Tokens</th>
                  <th className="text-right font-medium px-5 py-3">Estimated Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 tabular-nums">
                {byProvider.map((row) => (
                  <tr key={row.provider} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3 font-medium text-slate-100">
                      {isValidProviderId(row.provider)
                        ? PROVIDER_REGISTRY[row.provider].name
                        : row.provider}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-300">{row.requests}</td>
                    <td className="px-5 py-3 text-right text-slate-300">
                      {row.inputTokens.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-300">
                      {row.outputTokens.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-300">
                      {row.hasKnownPricing
                        ? `$${row.estimatedCostUsd.toFixed(4)}`
                        : 'Rate unverified'}
                    </td>
                  </tr>
                ))}
                {byProvider.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                      No provider usage recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Usage by Model */}
        <section className="space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-100">
            Usage by Model
          </h2>
          <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="text-left font-medium px-5 py-3">Model</th>
                  <th className="text-left font-medium px-5 py-3">Provider</th>
                  <th className="text-right font-medium px-5 py-3">Requests</th>
                  <th className="text-right font-medium px-5 py-3">Total Tokens</th>
                  <th className="text-right font-medium px-5 py-3">Estimated Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 tabular-nums">
                {byModel.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3 font-mono text-xs text-slate-100">{row.modelId}</td>
                    <td className="px-5 py-3 text-slate-300">
                      {isValidProviderId(row.provider)
                        ? PROVIDER_REGISTRY[row.provider].name
                        : row.provider}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-300">{row.requests}</td>
                    <td className="px-5 py-3 text-right text-slate-300">
                      {(row.inputTokens + row.outputTokens).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-300">
                      {row.hasKnownPricing
                        ? `$${row.estimatedCostUsd.toFixed(4)}`
                        : 'Rate unverified'}
                    </td>
                  </tr>
                ))}
                {byModel.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                      Run a Council session to populate per-model metadata.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Spending & Round Guardrails */}
        <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 max-w-2xl space-y-5">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-slate-100">
              Request, Round &amp; Spending Guardrails
            </h2>
            <p className="text-xs text-slate-400">
              User-configured safety thresholds stored on your profile.
            </p>
          </div>

          <form onSubmit={handleSaveLimits} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="limit-rounds" className="block text-xs font-medium text-slate-300">
                Max Rounds per Run
              </label>
              <input
                id="limit-rounds"
                type="number"
                min={1}
                max={6}
                value={maxRoundsLimit}
                onChange={(e) => setMaxRoundsLimit(Number(e.target.value))}
                className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 tabular-nums focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="limit-daily" className="block text-xs font-medium text-slate-300">
                Daily Request Cap
              </label>
              <input
                id="limit-daily"
                type="number"
                min={1}
                max={5000}
                value={dailyRequestLimit}
                onChange={(e) => setDailyRequestLimit(Number(e.target.value))}
                className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 tabular-nums focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="limit-spend" className="block text-xs font-medium text-slate-300">
                Monthly Alert Budget (USD)
              </label>
              <input
                id="limit-spend"
                type="number"
                min={0}
                max={10000}
                step="1"
                value={monthlySpendLimitUsd}
                onChange={(e) => setMonthlySpendLimitUsd(Number(e.target.value))}
                className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 tabular-nums focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3 flex items-center justify-between pt-2">
              <span className="text-xs text-emerald-400">{savedNotice || ''}</span>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                {saving ? 'Saving...' : 'Save Guardrails'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
