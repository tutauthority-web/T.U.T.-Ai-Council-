import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Crown,
  Globe,
  KeyRound,
  Layers,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { PREMIUM_PLANS, type ProviderId } from '../shared/types';
import { ProviderAvatar, ProviderLogoMark } from './ProviderBadge';

const DEMO_PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: 'google', label: 'Google Gemini' },
  { id: 'openai', label: 'ChatGPT' },
  { id: 'groq', label: 'Groq' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'cohere', label: 'Cohere' },
];

export function PremiumPromoModal({
  open,
  onUpgrade,
  onDismiss,
}: {
  open: boolean;
  onUpgrade: () => void;
  onDismiss: () => void;
}) {
  const [demoSeats, setDemoSeats] = useState<number>(3);
  const [demoProviders, setDemoProviders] = useState<ProviderId[]>([
    'google',
    'openai',
    'groq',
  ]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onDismiss]);

  const toggleDemoProvider = (pid: ProviderId) => {
    setDemoProviders((prev) => {
      if (prev.includes(pid)) {
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== pid);
      }
      return [...prev, pid];
    });
  };

  const assignedSeats = useMemo(() => {
    const pool = demoProviders.length > 0 ? demoProviders : (['google'] as ProviderId[]);
    return Array.from({ length: demoSeats }, (_, idx) => {
      const pid = pool[idx % pool.length];
      const meta = DEMO_PROVIDERS.find((p) => p.id === pid);
      return {
        seatNumber: idx + 1,
        providerId: pid,
        label: meta?.label || pid,
      };
    });
  }, [demoSeats, demoProviders]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="premium-promo-title"
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-[#0D1426] border border-amber-400/25 shadow-[0_28px_80px_rgba(0,0,0,0.75)] overflow-hidden animate-panel-enter"
      >
        {/* Top Ambient Gold Highlight Strip */}
        <div
          className="h-1 w-full bg-gradient-to-r from-amber-300 via-blue-400 to-amber-400"
          aria-hidden="true"
        />

        <div className="p-5 sm:p-6 space-y-5">
          {/* Modal Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950 flex items-center justify-center shadow-lg shrink-0 animate-promo-float">
                <Crown className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-amber-300">
                  Council Premium · Admin Cloud Access
                </p>
                <h2
                  id="premium-promo-title"
                  className="font-display text-lg sm:text-xl font-bold text-white tracking-tight mt-0.5 text-balance"
                >
                  Unlock Admin Cloud AI with Zero API Keys
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={onDismiss}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer shrink-0"
              aria-label="Close premium offer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Interactive Mechanism Demo: Seats + Real-Logo Providers */}
          <div className="rounded-xl bg-[#090E1B] border border-slate-800/90 p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display text-xs font-semibold text-slate-100">
                  Try the Streamlined Premium Launcher
                </p>
                <p className="text-[11.5px] text-slate-400">
                  Pick seats and providers — Admin Cloud assigns every engine automatically.
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg">
                {[2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDemoSeats(n)}
                    className={`min-h-[30px] min-w-[30px] px-2 rounded-md text-xs font-semibold tabular-nums transition-colors cursor-pointer ${
                      demoSeats === n
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Real-Logo Provider Selector */}
            <div className="flex flex-wrap items-center gap-2">
              {DEMO_PROVIDERS.map((p) => {
                const selected = demoProviders.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleDemoProvider(p.id)}
                    className={`inline-flex items-center gap-2 min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                      selected
                        ? 'bg-blue-600/20 border-blue-500/50 text-white'
                        : 'bg-[#111827] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <ProviderLogoMark provider={p.id} className="w-3.5 h-3.5 shrink-0" />
                    <span>{p.label}</span>
                    {selected && <Check className="w-3 h-3 text-blue-300 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Live Assigned Seats Preview */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              {assignedSeats.map((seat) => (
                <div
                  key={`${seat.seatNumber}-${seat.providerId}`}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[#111827] border border-slate-800/90 text-xs"
                >
                  <ProviderAvatar provider={seat.providerId} size="micro" />
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-400 block tabular-nums">
                      Seat {seat.seatNumber}
                    </span>
                    <span className="font-medium text-slate-100 truncate block">
                      {seat.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Core Premium Perks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-300">
            <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#111827]/70 border border-slate-800/80">
              <KeyRound className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-100">Pre-Connected Admin Keys</p>
                <p className="text-slate-400 mt-0.5">
                  Start Councils immediately without setting up developer API keys.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#111827]/70 border border-slate-800/80">
              <Globe className="w-4 h-4 text-sky-300 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-100">All 12 Model Land Cities Lit</p>
                <p className="text-slate-400 mt-0.5">
                  Explore every AI provider district connected in golden Premium aura.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#111827]/70 border border-slate-800/80">
              <Sparkles className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-100">ChatGPT + Gemini Smart Routing</p>
                <p className="text-slate-400 mt-0.5">
                  Auto-balanced multi-seat priority across top providers.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#111827]/70 border border-slate-800/80">
              <Layers className="w-4 h-4 text-indigo-300 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-100">Instant Local Payments</p>
                <p className="text-slate-400 mt-0.5">
                  Pay smoothly via T.U.T. Wallet, bKash, or Nagad.
                </p>
              </div>
            </div>
          </div>

          {/* Transparent BDT Pricing Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PREMIUM_PLANS.map((plan) => (
              <div
                key={plan.cycle}
                className={`px-3 py-2 rounded-xl border text-center tabular-nums ${
                  plan.popular
                    ? 'bg-amber-500/12 border-amber-400/40 text-amber-100'
                    : 'bg-[#111827] border-slate-800 text-slate-200'
                }`}
              >
                <p className="text-[11px] text-slate-400">{plan.shortLabel}</p>
                <p className="font-display text-base font-bold text-white mt-0.5">
                  {plan.priceBdt}৳
                </p>
                <p className="text-[10.5px] text-slate-400">{plan.label}</p>
              </div>
            ))}
          </div>

          {/* Footer Actions */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Verify anytime via T.U.T. Wallet, bKash, or Nagad</span>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onDismiss}
                className="min-h-[42px] px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
              >
                Maybe Later
              </button>
              <button
                type="button"
                onClick={onUpgrade}
                className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-5 py-2 text-xs font-semibold bg-gradient-to-r from-amber-300 to-amber-500 hover:from-amber-200 hover:to-amber-400 text-slate-950 rounded-xl shadow-lg transition-all whitespace-nowrap cursor-pointer"
              >
                <Crown className="w-3.5 h-3.5" />
                Unlock Premium (29৳)
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
