import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { updateUserProfileSettings } from '../../lib/firestoreService';
import { isValidProviderId, PROVIDER_REGISTRY } from '../../shared/providers';

export function PortalUsagePanel() {
  const { user, profile, isPremium, isAdmin, usageRecords, sessionUsage } = useAuth();
  const hideModelDetails = isPremium && !isAdmin;

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
    return Array.from(map.values()).sort((a, b) => b.requests - a.requests);
  }, [usageRecords]);

  const byModel = useMemo(() => {
    if (hideModelDetails) return [];
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
  }, [usageRecords, hideModelDetails]);

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
      setSavedNotice('Usage guardrails saved.');
    } finally {
      setSaving(false);
    }
  };

  const totalRecordedKnownCost = byProvider.reduce(
    (s, p) => s + (p.hasKnownPricing ? p.estimatedCostUsd : 0),
    0,
  );

  return (
    <div className="space-y-6 animate-panel-enter">
      {/* Session & Cumulative Metrics */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 tabular-nums">
        <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5">
          <p className="text-xs text-slate-400">Session Requests</p>
          <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-slate-100">
            {sessionUsage.requests}
          </p>
        </div>
        <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5">
          <p className="text-xs text-slate-400">Session Tokens</p>
          <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-slate-100">
            {(sessionUsage.inputTokens + sessionUsage.outputTokens).toLocaleString()}
          </p>
        </div>
        <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5">
          <p className="text-xs text-slate-400">All-Time Requests</p>
          <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-slate-100">
            {usageRecords.length}
          </p>
        </div>
        <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5">
          <p className="text-xs text-slate-400">
            {hideModelDetails ? 'Cloud Pool' : 'Estimated Spend'}
          </p>
          <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-slate-100">
            {hideModelDetails ? 'Included' : `$${totalRecordedKnownCost.toFixed(4)}`}
          </p>
        </div>
      </section>

      {/* Requests by Provider */}
      <section className="space-y-2.5">
        <h3 className="font-display text-sm sm:text-base font-semibold text-slate-100">
          Usage by Provider
        </h3>
        <div className="bg-[#111827] border border-slate-800 rounded-2xl overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-400">
                <th className="text-left font-medium px-4 sm:px-5 py-3">Provider</th>
                <th className="text-right font-medium px-4 sm:px-5 py-3">Requests</th>
                <th className="text-right font-medium px-4 sm:px-5 py-3">Input Tokens</th>
                <th className="text-right font-medium px-4 sm:px-5 py-3">Output Tokens</th>
                {!hideModelDetails && (
                  <th className="text-right font-medium px-4 sm:px-5 py-3">Estimated Cost</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 tabular-nums">
              {byProvider.map((row) => (
                <tr key={row.provider} className="hover:bg-slate-800/30">
                  <td className="px-4 sm:px-5 py-3 font-medium text-slate-100 whitespace-nowrap">
                    {row.provider === 'openai'
                      ? 'ChatGPT'
                      : isValidProviderId(row.provider)
                        ? PROVIDER_REGISTRY[row.provider].name
                        : row.provider}
                  </td>
                  <td className="px-4 sm:px-5 py-3 text-right text-slate-300">{row.requests}</td>
                  <td className="px-4 sm:px-5 py-3 text-right text-slate-300">
                    {row.inputTokens.toLocaleString()}
                  </td>
                  <td className="px-4 sm:px-5 py-3 text-right text-slate-300">
                    {row.outputTokens.toLocaleString()}
                  </td>
                  {!hideModelDetails && (
                    <td className="px-4 sm:px-5 py-3 text-right text-slate-300 whitespace-nowrap">
                      {row.hasKnownPricing
                        ? `$${row.estimatedCostUsd.toFixed(4)}`
                        : 'Rate unverified'}
                    </td>
                  )}
                </tr>
              ))}
              {byProvider.length === 0 && (
                <tr>
                  <td
                    colSpan={hideModelDetails ? 4 : 5}
                    className="px-5 py-8 text-center text-slate-400"
                  >
                    No provider usage recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Usage by Model (shown strictly for BYOK Free users and Admin) */}
      {!hideModelDetails && (
        <section className="space-y-2.5">
          <h3 className="font-display text-sm sm:text-base font-semibold text-slate-100">
            Usage by Model
          </h3>
          <div className="bg-[#111827] border border-slate-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="text-left font-medium px-4 sm:px-5 py-3">Model</th>
                  <th className="text-left font-medium px-4 sm:px-5 py-3">Provider</th>
                  <th className="text-right font-medium px-4 sm:px-5 py-3">Requests</th>
                  <th className="text-right font-medium px-4 sm:px-5 py-3">Total Tokens</th>
                  <th className="text-right font-medium px-4 sm:px-5 py-3">Estimated Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 tabular-nums">
                {byModel.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-800/30">
                    <td className="px-4 sm:px-5 py-3 font-mono text-xs text-slate-100">
                      {row.modelId}
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-slate-300 whitespace-nowrap">
                      {isValidProviderId(row.provider)
                        ? PROVIDER_REGISTRY[row.provider].name
                        : row.provider}
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-right text-slate-300">{row.requests}</td>
                    <td className="px-4 sm:px-5 py-3 text-right text-slate-300">
                      {(row.inputTokens + row.outputTokens).toLocaleString()}
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-right text-slate-300 whitespace-nowrap">
                      {row.hasKnownPricing
                        ? `$${row.estimatedCostUsd.toFixed(4)}`
                        : 'Rate unverified'}
                    </td>
                  </tr>
                ))}
                {byModel.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                      Run a Council session to populate per-model usage.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Safety Guardrails */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-5 sm:p-6 max-w-2xl space-y-5">
        <div className="space-y-1">
          <h3 className="font-display text-sm sm:text-base font-semibold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Request, Round &amp; Budget Guardrails
          </h3>
          <p className="text-xs text-slate-400">
            Configure personal round caps and alert budgets stored on your account.
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
              className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 tabular-nums focus:outline-none"
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
              className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 tabular-nums focus:outline-none"
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
              className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 tabular-nums focus:outline-none"
            />
          </div>

          <div className="sm:col-span-3 flex items-center justify-between pt-2">
            <span className="text-xs text-emerald-400">{savedNotice || ''}</span>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              {saving ? 'Saving...' : 'Save Guardrails'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
