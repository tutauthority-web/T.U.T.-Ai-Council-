import { lazy, Suspense, useState } from 'react';
import { ArrowRight, Check, Lock, Scale, ShieldCheck, Layers } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { AppRoute } from '../components/AppShell';
import { PROVIDER_LIST } from '../shared/providers';

const LandingNovaShowcase = lazy(() =>
  import('../components/world/LandingNovaShowcase').then((mod) => ({
    default: mod.LandingNovaShowcase,
  })),
);

export function LandingPage({ onNavigate }: { onNavigate: (route: AppRoute) => void }) {
  const { user } = useAuth();
  const [heroError, setHeroError] = useState(false);
  const [matrixError, setMatrixError] = useState(false);

  return (
    <div className="min-h-screen bg-[#090E1A] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#090E1A]/90 backdrop-blur border-b border-slate-800/80">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            T.U.T AI Council
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a href="#architecture" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Architecture
            </a>
            <a href="#modes" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Discussion Modes
            </a>
            <a href="#moderator" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Moderator
            </a>
            <a href="#security" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Security
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onNavigate(user ? 'dashboard' : 'auth')}
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {user ? 'Open Workspace' : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero Split */}
        <section className="max-w-[1280px] mx-auto px-6 pt-14 pb-20 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <p className="text-sm font-medium text-blue-400 tracking-wide">
                One Conversation · Multiple AI Minds
              </p>
              <h1
                className="font-display font-bold tracking-tight text-slate-50 leading-[1.08]"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
              >
                Multi-provider AI deliberation built for high-stakes decisions.
              </h1>
              <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-xl">
                Connect your own Google Gemini, OpenAI, Anthropic, Groq, Cohere, NVIDIA NIM, SambaNova, HuggingFace, and other provider credentials. Bring multiple models into a single structured room where each model answers independently, cross-examines peers, revises conclusions, and submits to an impartial Moderator verdict.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => onNavigate(user ? 'new-council' : 'auth')}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  {user ? 'Launch Council Room' : 'Get Started'}
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href="#modes"
                  className="inline-flex items-center px-4 py-3 text-sm font-medium text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  Inspect Collaboration Modes
                </a>
              </div>

              <div className="pt-4 border-t border-slate-800/80 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
                <span>{PROVIDER_LIST.length} AI Providers &amp; Free API Tiers</span>
                <span aria-hidden="true">·</span>
                <span>AES-256-GCM Server Vault</span>
                <span aria-hidden="true">·</span>
                <span>Strict Model Attribution</span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[340px] lg:min-h-[440px] rounded-xl overflow-hidden border border-slate-800 bg-[#0F172A]">
                <Suspense
                  fallback={
                    !heroError ? (
                      <img
                        src="/src/assets/images/hero_council_chamber_1795008973998.jpg"
                        alt="Minimalist dark slate deliberation chamber representing multi-model AI collaboration"
                        referrerPolicy="no-referrer"
                        onError={() => setHeroError(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#0F172A] to-[#090E1A]">
                        <Scale className="w-10 h-10 text-blue-400 mb-3" />
                        <p className="font-display font-semibold text-slate-200">T.U.T AI Council Chamber</p>
                        <p className="text-sm text-slate-400 mt-1">Parallel multi-provider deliberation environment</p>
                      </div>
                    )
                  }
                >
                  <LandingNovaShowcase />
                </Suspense>
              </div>
            </div>
          </div>
        </section>

        {/* Architecture & Modes */}
        <section id="modes" className="border-t border-slate-800/80 bg-[#0C1222]/60 py-20">
          <div className="max-w-[1280px] mx-auto px-6 space-y-12">
            <div className="max-w-2xl space-y-3">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-50">
                01. Two disciplined deliberation protocols
              </h2>
              <p className="text-slate-300 leading-relaxed">
                Replace single-model blind spots with transparent multi-round exchange. Every response stays explicitly labeled by provider and model ID.
              </p>
            </div>

            <div id="architecture" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-4">
                  <p className="text-xs font-medium text-blue-400">Mode A</p>
                  <h3 className="font-display text-xl font-semibold text-slate-100">
                    Free Discussion
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    Selected models answer your prompt in parallel, read each other&apos;s attributed perspectives across configurable rounds, challenge weak reasoning, and stop whenever you intervene.
                  </p>
                  <ul className="space-y-2 text-sm text-slate-400 pt-2">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                      <span>User-controlled maximum rounds (1–6)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                      <span>Instant stream abort via Stop Discussion</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                      <span>Anti-impersonation &amp; anti-loop guards</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-4">
                  <p className="text-xs font-medium text-blue-400">Mode B</p>
                  <h3 className="font-display text-xl font-semibold text-slate-100">
                    Structured Debate
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    A formal three-round adversarial review followed by a Moderator verdict, engineered to eliminate early groupthink before models inspect peer claims.
                  </p>
                  <ul className="space-y-2 text-sm text-slate-400 pt-2">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                      <span>Round 1: Independent responses in isolation</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                      <span>Round 2: Direct peer cross-review &amp; critique</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                      <span>Round 3: Revised conclusions &amp; Final Verdict</span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="lg:col-span-5">
                <div className="h-full min-h-[260px] rounded-xl overflow-hidden border border-slate-800 bg-[#0F172A]">
                  {!matrixError ? (
                    <img
                      src="/src/assets/images/deliberation_matrix_1795008974471.jpg"
                      alt="Intersecting dark glass architectural planes illustrating multi-model synthesis"
                      referrerPolicy="no-referrer"
                      onError={() => setMatrixError(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
                      <Layers className="w-10 h-10 text-blue-400 mb-3" />
                      <p className="font-display font-semibold text-slate-200">Cross-Provider Matrix</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Moderator & Security */}
        <section id="moderator" className="border-t border-slate-800/80 py-20">
          <div className="max-w-[1280px] mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div className="space-y-5">
              <h2 className="font-display text-2xl font-bold text-slate-50">
                02. Impartial 7-part Council Moderator
              </h2>
              <p className="text-slate-300 leading-relaxed">
                Designate any connected model as Council Moderator. The Moderator does not assume consensus equals truth—it isolates verified evidence from speculation and highlights unresolved risk.
              </p>
              <div className="border border-slate-800 rounded-xl divide-y divide-slate-800/80 bg-[#111827]/70">
                {[
                  '1. Executive summary',
                  '2. Points of agreement',
                  '3. Points of disagreement',
                  '4. Important reasoning and evidence',
                  '5. Unresolved questions',
                  '6. Final recommendation',
                  '7. Confidence and limitations',
                ].map((section) => (
                  <div key={section} className="px-4 py-2.5 text-sm text-slate-200">
                    {section}
                  </div>
                ))}
              </div>
            </div>

            <div id="security" className="space-y-5">
              <h2 className="font-display text-2xl font-bold text-slate-50">
                03. Server-side credentials &amp; data isolation
              </h2>
              <p className="text-slate-300 leading-relaxed">
                Every provider API key is verified on the server, encrypted at rest using AES-256-GCM, and never transmitted to browser storage.
              </p>
              <div className="space-y-4">
                <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex gap-4">
                  <Lock className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h3 className="font-display font-semibold text-slate-100 text-base">
                      Zero Browser Key Exposure
                    </h3>
                    <p className="text-sm text-slate-400">
                      Keys are never stored in localStorage or sessionStorage, and all completions stream through authenticated server-side provider adapters.
                    </p>
                  </div>
                </div>
                <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex gap-4">
                  <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h3 className="font-display font-semibold text-slate-100 text-base">
                      Strict Tenant Isolation &amp; Honest Usage
                    </h3>
                    <p className="text-sm text-slate-400">
                      Firestore security rules restrict every council room, transcript, and usage log strictly to your verified Firebase Auth identity. Token counts and cost estimates are recorded only from real provider metadata.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/80 py-8 bg-[#090E1A]">
        <div className="max-w-[1280px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-400">
          <div className="flex items-center gap-3">
            <span className="font-display font-semibold text-slate-200">T.U.T AI Council</span>
            <span aria-hidden="true">·</span>
            <span>One Conversation. Multiple AI Minds.</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate(user ? 'dashboard' : 'auth')}
            className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
          >
            {user ? 'Return to Dashboard' : 'Sign In to Workspace'}
          </button>
        </div>
      </footer>
    </div>
  );
}
