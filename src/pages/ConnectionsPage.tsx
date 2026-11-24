import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import { ProviderAvatar } from '../components/ProviderBadge';
import { useAuth } from '../contexts/AuthContext';
import {
  connectProviderBYOK,
  connectWorkspaceGemini,
  disconnectProvider,
  testProviderConnection,
} from '../lib/apiClient';
import { formatStatusLabel, getStatusTextClass } from '../lib/statusLabels';
import {
  detectProviderFromApiKey,
  PROVIDER_LIST,
  PROVIDER_REGISTRY,
  RECOMMENDED_FREE_PROVIDER_IDS,
} from '../shared/providers';
import type {
  ProviderConnectionSummary,
  ProviderHealthState,
  ProviderId,
} from '../shared/types';

const STARTER_FREE_SET = new Set<ProviderId>(RECOMMENDED_FREE_PROVIDER_IDS);

function summarizeVerificationFeedback(res: {
  ok: boolean;
  healthState?: ProviderHealthState;
  modelsCount?: number;
  error: string | null;
}): { type: 'ok' | 'err'; text: string } {
  if (res.ok && res.healthState === 'inference_ready') {
    return {
      type: 'ok',
      text: 'API key verified and live inference test succeeded.',
    };
  }
  if (res.ok && (res.healthState === 'verified' || res.healthState === 'connected')) {
    const countLabel =
      typeof res.modelsCount === 'number' && res.modelsCount > 0
        ? `${res.modelsCount} live models discovered from /models`
        : 'live models discovered from /models';
    return {
      type: 'ok',
      text: `API key connected (${countLabel}). Individual models will be tested on first use in chat.`,
    };
  }
  if (res.healthState === 'insufficient_credits') {
    return {
      type: 'err',
      text: `API key authenticated, but provider credits are exhausted: ${res.error || 'Top up credits in provider console.'}`,
    };
  }
  if (res.healthState === 'rate_limited') {
    return {
      type: 'err',
      text: `Rate limited during connection check: ${res.error || 'Retry shortly.'}`,
    };
  }
  if (res.healthState === 'invalid_credentials') {
    return {
      type: 'err',
      text: res.error || 'Invalid credentials rejected by provider.',
    };
  }
  if (res.healthState === 'verified') {
    return {
      type: 'err',
      text: res.error || 'Authentication succeeded, but model discovery returned an error.',
    };
  }
  return {
    type: 'err',
    text: res.error || 'Provider verification failed.',
  };
}

export function ConnectionsPage({
  onNavigate,
}: {
  onNavigate: (route: AppRoute) => void;
}) {
  const { isPremium, isAdmin, connections, connectionsLoading, refreshProviderState } = useAuth();

  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [openGuides, setOpenGuides] = useState<Record<string, boolean>>({});
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'free' | 'connected'>('all');
  const [feedback, setFeedback] = useState<Record<string, { type: 'ok' | 'err'; text: string }>>({});

  // Smart Quick-Paste Key Detector state
  const [quickKey, setQuickKey] = useState('');
  const [showQuickKey, setShowQuickKey] = useState(false);
  const [quickProviderOverride, setQuickProviderOverride] = useState<ProviderId>('cohere');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickFeedback, setQuickFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const detectedQuickProvider = useMemo(() => detectProviderFromApiKey(quickKey), [quickKey]);
  const effectiveQuickProvider = detectedQuickProvider || quickProviderOverride;

  const filteredConnections = useMemo(() => {
    if (filterMode === 'free') {
      return connections.filter((c) => STARTER_FREE_SET.has(c.providerId));
    }
    if (filterMode === 'connected') {
      return connections.filter((c) => c.status === 'connected');
    }
    return connections;
  }, [connections, filterMode]);

  const freeCount = useMemo(
    () => connections.filter((c) => STARTER_FREE_SET.has(c.providerId)).length,
    [connections],
  );
  const connectedCount = useMemo(
    () => connections.filter((c) => c.status === 'connected').length,
    [connections],
  );

  const setProviderMessage = (pid: string, type: 'ok' | 'err', text: string) => {
    setFeedback((prev) => ({ ...prev, [pid]: { type, text } }));
  };

  const handleSaveKey = async (pid: ProviderId, explicitKey?: string) => {
    const key = (explicitKey !== undefined ? explicitKey : draftKeys[pid] || '').trim();
    if (!key) {
      setProviderMessage(pid, 'err', 'Enter an API key before connecting.');
      return false;
    }

    setBusyProvider(pid);
    setFeedback((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });

    try {
      const res = await connectProviderBYOK(pid, key);

      if (explicitKey === undefined) {
        setDraftKeys((prev) => ({ ...prev, [pid]: '' }));
      }
      await refreshProviderState(true);
      const summary = summarizeVerificationFeedback(res);
      setProviderMessage(pid, summary.type, summary.text);
      return summary.type === 'ok';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProviderMessage(pid, 'err', msg);
      return false;
    } finally {
      setBusyProvider(null);
    }
  };

  const handleQuickConnect = async () => {
    const trimmed = quickKey.trim();
    if (!trimmed) {
      setQuickFeedback({ type: 'err', text: 'Paste an API key to auto-detect and connect.' });
      return;
    }
    const targetPid = effectiveQuickProvider;
    setQuickBusy(true);
    setQuickFeedback(null);
    try {
      const res = await connectProviderBYOK(targetPid, trimmed);
      await refreshProviderState(true);
      const summary = summarizeVerificationFeedback(res);
      setQuickFeedback({
        type: summary.type,
        text: `${PROVIDER_REGISTRY[targetPid].name}: ${summary.text}`,
      });
      if (summary.type === 'ok') {
        setQuickKey('');
      }
    } catch (err) {
      setQuickFeedback({
        type: 'err',
        text: `${PROVIDER_REGISTRY[targetPid].name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setQuickBusy(false);
    }
  };

  const handleWorkspaceGemini = async () => {
    setBusyProvider('google');
    try {
      const res = await connectWorkspaceGemini();
      await refreshProviderState(true);
      const summary = summarizeVerificationFeedback(res);
      setProviderMessage('google', summary.type, summary.text);
    } catch (err) {
      setProviderMessage('google', 'err', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleTest = async (pid: ProviderId) => {
    setBusyProvider(pid);
    try {
      const res = await testProviderConnection(pid);
      await refreshProviderState(true);
      const summary = summarizeVerificationFeedback(res);
      setProviderMessage(pid, summary.type, summary.text);
    } catch (err) {
      setProviderMessage(pid, 'err', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleDisconnect = async (pid: ProviderId) => {
    setBusyProvider(pid);
    try {
      await disconnectProvider(pid);
      await refreshProviderState(true);
      setProviderMessage(pid, 'ok', 'Personal credential deleted from server vault.');
    } catch (err) {
      setProviderMessage(pid, 'err', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleRefreshAll = async () => {
    await refreshProviderState(true);
  };

  const renderProviderBlock = (conn: ProviderConnectionSummary) => {
    const isBusy = busyProvider === conn.providerId;
    const msg = feedback[conn.providerId];
    const isConnected = conn.status === 'connected';
    const isSharedInherited = conn.method === 'admin_shared' || Boolean(conn.isAdminManaged);
    const providerCfg = PROVIDER_REGISTRY[conn.providerId];
    const guideOpen = Boolean(openGuides[conn.providerId]);
    const keyVisible = Boolean(visibleKeys[conn.providerId]);

    const connectionSubtitle = isConnected
      ? isSharedInherited
        ? `Managed by Admin · Fingerprint ${conn.keyFingerprint} · ${conn.discoveredModelsCount} live models`
        : `${
            conn.method === 'workspace_env' ? 'Workspace Env Key' : 'BYOK'
          } · Fingerprint ${conn.keyFingerprint} · ${conn.discoveredModelsCount} live models${
            conn.availableModelsCount > 0 ? ` (${conn.availableModelsCount} chat-tested)` : ''
          }`
      : 'Not connected — paste an API key below or open console to create one';

    return (
      <section
        key={conn.providerId}
        className="bg-[#111827] border border-slate-800 rounded-xl p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-800/80">
          <div className="flex items-start gap-3 min-w-0">
            <ProviderAvatar provider={conn.providerId} size="sm" className="mt-0.5" />
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h2 className="font-display text-base sm:text-lg font-semibold text-slate-100">
                  {conn.providerName}
                </h2>
                {STARTER_FREE_SET.has(conn.providerId) && (
                  <span className="text-xs font-medium text-emerald-400">Starter Free</span>
                )}
                {isSharedInherited && (
                  <span className="text-xs font-medium text-amber-300">Premium Included</span>
                )}
                {providerCfg?.consoleLabel && (
                  <span className="font-mono text-[11px] text-slate-500 truncate">
                    {providerCfg.consoleLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{connectionSubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
            {isConnected &&
            (conn.healthState === 'inference_ready' ||
              conn.healthState === 'verified' ||
              conn.healthState === 'connected') ? (
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${getStatusTextClass(
                  conn.healthState,
                )}`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {formatStatusLabel(conn.healthState)}
              </span>
            ) : (
              (() => {
                const effState =
                  conn.status === 'disconnected' ? 'disconnected' : conn.healthState;
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs ${getStatusTextClass(
                      effState,
                    )}`}
                  >
                    {effState !== 'disconnected' && <ShieldAlert className="w-4 h-4 shrink-0" />}
                    {formatStatusLabel(effState)}
                  </span>
                );
              })()
            )}

            <a
              href={providerCfg.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <span>Get API Key</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          </div>
        </div>

        {isConnected &&
          conn.healthState !== 'inference_ready' &&
          conn.healthState !== 'verified' &&
          conn.healthState !== 'connected' &&
          conn.healthMessage &&
          !msg && (
            <div className="text-xs rounded-lg p-3 border bg-amber-950/35 border-amber-800/60 text-amber-200 leading-relaxed break-words">
              {conn.healthMessage}
              {' Temporary blocks expire automatically in 5 minutes or upon re-test.'}
            </div>
          )}

        {msg && (
          <div
            className={`text-xs rounded-lg p-3 border break-words ${
              msg.type === 'ok'
                ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}
          >
            {msg.text}
          </div>
        )}

        {conn.lastError && !msg && (
          <div className="text-xs rounded-lg p-3 border bg-rose-950/40 border-rose-800/60 text-rose-300 break-words">
            Last provider error: {conn.lastError}
          </div>
        )}

        {/* API Key Form */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <input
                type={keyVisible ? 'text' : 'password'}
                autoComplete="off"
                value={draftKeys[conn.providerId] || ''}
                onChange={(e) =>
                  setDraftKeys((prev) => ({ ...prev, [conn.providerId]: e.target.value }))
                }
                placeholder={
                  isSharedInherited
                    ? 'Optional: paste a personal key to override Admin key...'
                    : isConnected
                      ? 'Paste a new API key to replace existing credential...'
                      : providerCfg?.keyPlaceholder || 'API key...'
                }
                className="w-full min-h-[44px] pl-3.5 pr-11 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={() =>
                  setVisibleKeys((prev) => ({
                    ...prev,
                    [conn.providerId]: !prev[conn.providerId],
                  }))
                }
                aria-label={keyVisible ? 'Hide API key' : 'Show API key'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer"
              >
                {keyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleSaveKey(conn.providerId)}
              className="min-h-[44px] px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors whitespace-nowrap disabled:opacity-60 cursor-pointer"
            >
              {isBusy
                ? 'Verifying...'
                : isSharedInherited
                  ? 'Save Override'
                  : isConnected
                    ? 'Replace Key'
                    : 'Verify & Connect'}
            </button>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            {conn.providerId === 'google' && conn.workspaceKeyAvailable
              ? 'Paste your Google AI Studio key (AIza...) or verify the Workspace Gemini key below.'
              : providerCfg.keyHint}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {conn.providerId === 'google' && conn.workspaceKeyAvailable && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleWorkspaceGemini()}
                  className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Use Workspace Gemini Key
                </button>
              )}

              {isConnected && (
                <>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleTest(conn.providerId)}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                    Test Connection
                  </button>
                  {!isSharedInherited && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDisconnect(conn.providerId)}
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-950/50 border border-rose-900/50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  )}
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
              className="inline-flex items-center gap-1.5 min-h-[40px] px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>How to get key (3 steps)</span>
              {guideOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {guideOpen && (
            <div className="pt-3 border-t border-slate-800/80 space-y-2 text-xs text-slate-300">
              {providerCfg.setupSteps.map((step, i) => (
                <div key={step} className="flex items-start gap-2.5">
                  <span className="font-mono text-slate-500 tabular-nums">0{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
              <div className="pt-1">
                <a
                  href={providerCfg.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium underline underline-offset-2"
                >
                  <span>Open {providerCfg.consoleLabel}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <AppShell
      currentRoute="connections"
      pageTitle="API Connections"
      breadcrumb="User Portal"
      onNavigate={onNavigate}
      primaryAction={
        <button
          type="button"
          disabled={connectionsLoading}
          onClick={() => void handleRefreshAll()}
          className="inline-flex items-center gap-2 min-h-[40px] px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${connectionsLoading ? 'animate-spin' : ''}`}
          />
          Refresh Status
        </button>
      }
    >
      <div className="space-y-6">
        {/* Slim Admin Notice linking to dedicated Admin Shared Pool */}
        {isAdmin && (
          <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#121A2F] border border-amber-500/35 rounded-xl px-5 py-3.5 text-xs">
            <div className="flex items-center gap-2.5 text-amber-200">
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Keys saved here under Admin auto-sync to the Shared API Pool. Manage shared pool keys in Admin Portal.
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Open Admin Pool</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </section>
        )}

        {/* Premium Non-Admin Managed Notice */}
        {isPremium && !isAdmin && (
          <section className="bg-[#121A2F] border border-amber-500/40 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                <Crown className="w-4 h-4" />
                Premium Managed APIs Active
              </p>
              <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
                Admin-connected APIs are enabled automatically across your workspace — zero API key setup required. Optionally paste your own key below if you want to override any provider.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('new-council')}
              className="min-h-[44px] px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Launch Council
            </button>
          </section>
        )}

        {/* Smart Quick-Paste Key Detector Bar */}
        <section className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Smart Key Auto-Connect
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Paste any key (`AIza`, `gsk_`, `sk-or-v1-`, `sk-ant-`, `hf_`, `nvapi-`, `csk-`) or pick Cohere / Mistral
            </span>
          </div>

          <div className="flex flex-col md:flex-row gap-2.5">
            <div className="relative flex-1">
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showQuickKey ? 'text' : 'password'}
                autoComplete="off"
                value={quickKey}
                onChange={(e) => {
                  setQuickKey(e.target.value);
                  setQuickFeedback(null);
                }}
                placeholder="Paste any AI provider API key here..."
                className="w-full min-h-[44px] pl-10 pr-11 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 placeholder-slate-500 font-mono focus:outline-none"
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
              <div className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#090E1A] border border-blue-500/40 flex items-center gap-2 shrink-0">
                <ProviderAvatar provider={detectedQuickProvider} size="xs" />
                <span className="text-xs font-medium text-blue-300 whitespace-nowrap">
                  Detected: {PROVIDER_REGISTRY[detectedQuickProvider].name}
                </span>
              </div>
            ) : (
              <select
                aria-label="Select provider"
                value={quickProviderOverride}
                onChange={(e) => setQuickProviderOverride(e.target.value as ProviderId)}
                className="min-h-[44px] px-3 py-2 text-xs bg-[#090E1A] border border-slate-800 rounded-xl text-slate-200 focus:outline-none shrink-0"
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
              disabled={quickBusy}
              onClick={() => void handleQuickConnect()}
              className="min-h-[44px] px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors whitespace-nowrap disabled:opacity-60 cursor-pointer"
            >
              {quickBusy
                ? 'Connecting...'
                : `Connect ${PROVIDER_REGISTRY[effectiveQuickProvider].shortName}`}
            </button>
          </div>

          {quickFeedback && (
            <div
              className={`text-xs rounded-lg p-3 border ${
                quickFeedback.type === 'ok'
                  ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
              }`}
            >
              {quickFeedback.text}
            </div>
          )}
        </section>

        {/* Filter Bar & Encryption Note */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Every key is verified against the provider before saving, encrypted with AES-256-GCM on the server, and never exposed back to browser code.
          </p>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#111827] border border-slate-800 shrink-0 self-start">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              All ({connections.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('free')}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                filterMode === 'free'
                  ? 'bg-emerald-600 text-white'
                  : 'text-emerald-300/90 hover:text-emerald-200'
              }`}
            >
              Starter Free ({freeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('connected')}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                filterMode === 'connected'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              Connected ({connectedCount})
            </button>
          </div>
        </div>

        {/* Provider Cards List */}
        <div className="space-y-4">
          {filteredConnections.length === 0 ? (
            <div className="bg-[#111827] border border-slate-800 rounded-xl p-8 text-center text-sm text-slate-400">
              No providers match this filter yet. Switch to All or Starter Free to connect an API key.
            </div>
          ) : (
            filteredConnections.map(renderProviderBlock)
          )}
        </div>
      </div>
    </AppShell>
  );
}
