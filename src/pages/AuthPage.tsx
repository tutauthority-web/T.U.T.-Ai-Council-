import React, { useState } from 'react';
import { ArrowLeft, MailCheck, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { AppRoute } from '../components/AppShell';

export function AuthPage({
  onNavigate,
  onBack,
}: {
  onNavigate: (route: AppRoute) => void;
  onBack?: () => void;
}) {
  const {
    user,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    resendVerificationEmail,
    refreshAuthUser,
    logout,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleGoogle = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      onNavigate('dashboard');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        await registerWithEmail(email, password, displayName);
        setNotice(
          'Account created. Please check your inbox and verify your email address before entering the workspace.',
        );
      } else {
        await signInWithEmail(email, password);
        onNavigate('dashboard');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('operation-not-allowed')) {
        setError(
          'Email/Password sign-in is not yet enabled in the Firebase Console for this project. Use "Continue with Google" below, or enable Email/Password under Firebase Console → Authentication → Sign-in method.',
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  // Email verification gate for unverified email/password signups
  if (user && !user.emailVerified) {
    return (
      <div className="min-h-screen bg-[#090E1A] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#111827] border border-slate-800 rounded-xl p-7 space-y-5">
          <div className="flex items-center gap-3 text-blue-400">
            <MailCheck className="w-6 h-6 shrink-0" />
            <h1 className="font-display text-xl font-bold text-slate-100">
              Verify your email address
            </h1>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            Your account <span className="font-medium text-white">{user.email}</span> requires email verification to satisfy Firestore security policy before accessing your private workspace.
          </p>
          {notice && (
            <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-3">
              {notice}
            </div>
          )}
          {error && (
            <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded-lg p-3">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await refreshAuthUser();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              I have verified my email
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await resendVerificationEmail();
                  setNotice('Verification email sent. Check your inbox.');
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full px-4 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
            >
              Resend verification email
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
            >
              Sign out and use another account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090E1A] text-slate-100 flex flex-col justify-center items-center p-6">
      <div className="w-full max-w-md space-y-6">
        <button
          type="button"
          onClick={() => (onBack ? onBack() : onNavigate('dashboard'))}
          className="inline-flex items-center gap-2 min-h-[44px] px-2 -ml-2 rounded-xl text-sm text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-7 space-y-6">
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-bold text-slate-50">
              {mode === 'login' ? 'Sign in to T.U.T AI Council' : 'Create your Council account'}
            </h1>
            <p className="text-sm text-slate-400">
              Isolated private rooms, server-encrypted API keys, and full transcript history.
            </p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-semibold bg-white text-slate-900 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-60"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-800" />
            <span className="shrink mx-3 text-xs text-slate-500">or with email</span>
            <div className="flex-grow border-t border-slate-800" />
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 bg-[#090E1A] border border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'login' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'register' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded-lg p-3 leading-relaxed">
              {error}
            </div>
          )}
          {notice && (
            <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-3 leading-relaxed">
              {notice}
            </div>
          )}

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label htmlFor="auth-name" className="block text-xs font-medium text-slate-300">
                  Full Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alex Mercer"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-300">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full px-3.5 py-2.5 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="auth-password" className="block text-xs font-medium text-slate-300">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-3.5 py-2.5 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full px-4 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-60"
            >
              {busy
                ? 'Authenticating...'
                : mode === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
