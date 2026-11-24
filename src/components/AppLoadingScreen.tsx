import { useWorldTheme } from '../contexts/WorldThemeContext';

interface AppLoadingScreenProps {
  stage?: string;
  progress?: number;
  exiting?: boolean;
  overlay?: boolean;
}

/**
 * Fullscreen cinematic splash / loading screen displayed on startup while
 * authentication, the 3D Playground bundle, and WebGL shaders initialize.
 */
export function AppLoadingScreen({
  stage = 'Preparing your AI sanctuary...',
  progress = 42,
  exiting = false,
  overlay = false,
}: AppLoadingScreenProps) {
  const { isDay, reducedMotion } = useWorldTheme();
  const clampedProgress = Math.min(100, Math.max(8, Math.round(progress)));

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading T.U.T AI Council"
      className={`${overlay ? 'fixed inset-0 z-50' : 'min-h-screen w-full'} flex flex-col items-center justify-between px-6 py-10 overflow-hidden transition-opacity duration-500 ease-out ${
        exiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      } ${isDay ? 'bg-[#ECF4FD] text-slate-900' : 'bg-[#070B16] text-slate-100'}`}
    >
      {/* Subtle atmospheric radial depth */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDay
            ? 'radial-gradient(circle at 50% 42%, rgba(56, 189, 248, 0.22) 0%, rgba(129, 140, 248, 0.08) 42%, transparent 72%)'
            : 'radial-gradient(circle at 50% 42%, rgba(56, 189, 248, 0.16) 0%, rgba(124, 58, 237, 0.12) 38%, transparent 72%)',
        }}
      />

      {/* Top spacer for vertical optical centering */}
      <div className="h-4 shrink-0" />

      {/* Center Nova Orbital Emblem & Typography */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-sm w-full">
        <div className="relative w-28 h-28 flex items-center justify-center mb-7">
          {/* Outer rotating orbital ring */}
          <svg
            viewBox="0 0 120 120"
            className={`absolute inset-0 w-full h-full ${
              reducedMotion ? '' : 'animate-[spin_14s_linear_infinite]'
            }`}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="tutOrbitGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.95" />
                <stop offset="55%" stopColor="#818CF8" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="url(#tutOrbitGrad)"
              strokeWidth="1.75"
              strokeDasharray="190 150"
              strokeLinecap="round"
            />
            <circle cx="60" cy="6" r="3" fill="#38BDF8" />
          </svg>

          {/* Counter-rotating hexagonal council ring */}
          <svg
            viewBox="0 0 120 120"
            className={`absolute inset-2 w-[calc(100%-1rem)] h-[calc(100%-1rem)] ${
              reducedMotion ? '' : 'animate-[spin_18s_linear_infinite_reverse]'
            }`}
            aria-hidden="true"
          >
            <polygon
              points="60,12 102,36 102,84 60,108 18,84 18,36"
              fill="none"
              stroke={isDay ? 'rgba(37, 99, 235, 0.28)' : 'rgba(148, 163, 184, 0.25)'}
              strokeWidth="1.25"
            />
          </svg>

          {/* Central Nova Core Visor Emblem */}
          <div
            className={`relative w-14 h-14 rounded-2xl flex items-center justify-center border shadow-lg ${
              isDay
                ? 'bg-white border-sky-200 shadow-sky-200/60'
                : 'bg-[#0E162B] border-sky-400/35 shadow-sky-950/60'
            }`}
          >
            <svg viewBox="0 0 40 40" className="w-8 h-8" aria-hidden="true">
              <defs>
                <linearGradient id="tutCoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="#8B5CF6" />
                </linearGradient>
              </defs>
              <rect
                x="6"
                y="9"
                width="28"
                height="20"
                rx="7"
                fill={isDay ? '#0F172A' : '#060A15'}
                stroke="url(#tutCoreGrad)"
                strokeWidth="1.8"
              />
              <circle cx="15" cy="19" r="2.7" fill="#38BDF8" />
              <circle cx="25" cy="19" r="2.7" fill="#38BDF8" />
              <path
                d="M16.5 24.2H23.5"
                stroke="#818CF8"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <circle cx="20" cy="5.5" r="2" fill="#8B5CF6" />
            </svg>
          </div>
        </div>

        <h1
          className="font-display text-2xl sm:text-3xl font-bold tracking-tight"
          style={{ textWrap: 'balance' }}
        >
          T.U.T AI Council
        </h1>
        <p
          className={`mt-2 text-sm leading-relaxed ${
            isDay ? 'text-slate-600' : 'text-slate-400'
          }`}
        >
          {stage}
        </p>

        {/* Clean Determinate Progress Track */}
        <div className="mt-7 w-full max-w-[260px] space-y-2">
          <div
            className={`h-1.5 w-full rounded-full overflow-hidden ${
              isDay ? 'bg-slate-200' : 'bg-slate-800/90'
            }`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 via-blue-500 to-violet-500 transition-[width] duration-300 ease-out"
              style={{ width: `${clampedProgress}%` }}
            />
          </div>
          <div
            className={`flex items-center justify-between text-[11px] font-mono tabular-nums ${
              isDay ? 'text-slate-500' : 'text-slate-400'
            }`}
          >
            <span>Sanctuary Engine</span>
            <span>{clampedProgress}%</span>
          </div>
        </div>
      </div>

      {/* Quiet Bottom Tagline */}
      <p
        className={`relative z-10 text-xs tracking-wide ${
          isDay ? 'text-slate-500' : 'text-slate-500'
        }`}
      >
        One Conversation · Multiple AI Minds
      </p>
    </div>
  );
}
