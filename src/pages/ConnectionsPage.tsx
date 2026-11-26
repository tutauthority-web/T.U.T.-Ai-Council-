import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
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
  Wrench,
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
        ? `${res.modelsCount} live models discovered`
        : 'live models discovered';
    return {
      type: 'ok',
      text: `API key connected (${countLabel}).`,
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

function isBrokenHealth(conn: ProviderConnectionSummary): boolean {
  return (
    conn.status === 'connected' &&
    conn.healthState !== 'inference_ready' &&
    conn.healthState !== 'verified' &&
    conn.healthState !== 'connected'
  );
}

export function ConnectionsPage({
  onNavigate,
  onBack,
}: {
  onNavigate: (route: AppRoute) => void;
  onBack?: () => void;
}) {
  const { isPremium, isAdmin, connections, connectionsLoading, refreshProviderState } = useAuth();
  const hideModelDetails = isPremium && !isAdmin;

  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null);
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
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

  const selectedConn = useMemo(
    () => connections.find((c) => c.providerId === selectedProviderId) || null,
    [connections, selectedProviderId],
  );

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

  // Dedicated Provider Detail Sub-Page
  if (selectedConn) {
    const conn = selectedConn;
    const isBusy = busyProvider === conn.providerId;
    const msg = feedback[conn.providerId];
    const isConnected = conn.status === 'connected';
    const isSharedInherited = conn.method === 'admin_shared' || Boolean(conn.isAdminManaged);
    const broken = isBrokenHealth(conn);
    const providerCfg = PROVIDER_REGISTRY[conn.providerId];
    const keyVisible = Boolean(visibleKeys[conn.providerId]);
    const displayProviderName =
      conn.providerId === 'openai' ? 'ChatGPT / OpenAI' : conn.providerName;

    const effectiveHealth = conn.status === 'disconnected' ? 'disconnected' : conn.healthState;

    return (
      <AppShell
        currentRoute="connections"
        pageTitle={displayProviderName}
        onNavigate={onNavigate}
        showBackButton
        onBack={() => setSelectedProviderId(null)}
      >
        <div className="max-w-3xl space-y-5 animate-panel-enter">
          {/* Hero Provider Status Card */}
          <section className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <ProviderAvatar provider={conn.providerId} size="md" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-lg sm:text-xl font-bold text-slate-100">
                      {displayProviderName}
                    </h2>
                    {STARTER_FREE_SET.has(conn.providerId) && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-medium text-emerald-400">
                        Starter Free
                      </span>
                    )}
                    {isSharedInherited && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[11px] font-medium text-amber-300">
                        Premium Cloud
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {isConnected
                      ? isSharedInherited
                        ? 'Active automatically via T.U.T Premium Cloud Pool.'
                        : `${
                            conn.method === 'workspace_env' ? 'Workspace Key' : 'BYOK Vault'
                          } · Fingerprint ${conn.keyFingerprint}${
                            !hideModelDetails && conn.discoveredModelsCount > 0
                              ? ` · ${conn.discoveredModelsCount} models ready`
                              : ''
                          }`
                      : 'Not connected yet — paste your API key below or follow the 3-step guide.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold ${getStatusTextClass(
                    effectiveHealth,
                  )}`}
                >
                  {isConnected && !broken ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : broken ? (
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                  ) : null}
                  {formatStatusLabel(effectiveHealth)}
                </span>

                <a
                  href={providerCfg.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-2 text-xs font-semibold bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-100 rounded-xl transition-colors whitespace-nowrap"
                >
                  <span>Get API Key</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                </a>
              </div>
            </div>

            {broken && conn.healthMessage && !msg && (
              <div className="text-xs rounded-xl p-3.5 border bg-amber-950/35 border-amber-800/60 text-amber-200 leading-relaxed break-words">
                {conn.healthMessage}
              </div>
            )}

            {msg && (
              <div
                className={`text-xs rounded-xl p-3.5 border break-words ${
                  msg.type === 'ok'
                    ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                }`}
              >
                {msg.text}
              </div>
            )}

            {conn.lastError && !msg && (
              <div className="text-xs rounded-xl p-3.5 border bg-rose-950/40 border-rose-800/60 text-rose-300 break-words">
                Last error: {conn.lastError}
              </div>
            )}
          </section>

          {/* Key Entry & Actions Card */}
          <section className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="space-y-1">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                {isSharedInherited
                  ? 'Personal Override Key (Optional)'
                  : isConnected
                    ? 'Update or Manage Credential'
                    : 'Connect API Key'}
              </h3>
              <p className="text-xs text-slate-400">
                {conn.providerId === 'google' && conn.workspaceKeyAvailable
                  ? 'Paste your Google AI Studio key (AIza...) or activate the Workspace Gemini key below.'
                  : providerCfg.keyHint}
              </p>
            </div>

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
                      ? 'Optional: paste personal key to override Admin Pool...'
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

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {conn.providerId === 'google' && conn.workspaceKeyAvailable && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleWorkspaceGemini()}
                  className="min-h-[40px] px-3.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
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
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                    Test Connection
                  </button>
                  {!isSharedInherited && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDisconnect(conn.providerId)}
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-950/50 border border-rose-900/50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Disconnect Key
                    </button>
                  )}
                </>
              )}
            </div>
          </section>

          {/* 3-Step Visual Setup Guide */}
          <section className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                How to get your {displayProviderName} API key
              </h3>
              <a
                href={providerCfg.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300"
              >
                <span>Open {providerCfg.consoleLabel}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="space-y-3">
              {providerCfg.setupSteps.map((step, i) => (
                <div
                  key={step}
                  className="flex items-start gap-3 p-3 rounded-xl bg-[#090E1A] border border-slate-800/80 text-xs text-slate-300 leading-relaxed"
                >
                  <span className="w-6 h-6 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-300 font-mono text-[11px] font-semibold flex items-center justify-center shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      currentRoute="connections"
      pageTitle="API Connections"
      onNavigate={onNavigate}
      showBackButton
      onBack={onBack || (() => onNavigate('portal'))}
      primaryAction={
        <button
          type="button"
          disabled={connectionsLoading}
          onClick={() => void refreshProviderState(true)}
          className="inline-flex items-center gap-2 min-h-[40px] px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${connectionsLoading ? 'animate-spin' : ''}`}
          />
          Refresh Status
        </button>
      }
    >
      <div className="space-y-6">
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

        {isPremium && !isAdmin && (
          <section className="bg-[#121A2F] border border-amber-500/40 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                <Crown className="w-4 h-4" />
                Premium Managed APIs Active
              </p>
              <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
                Admin-connected APIs work automatically across your workspace — no API key setup needed. Open any provider below only if you want to inspect status or add an optional personal override key.
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

        {/* Smart Quick-Paste Key Auto-Connect */}
        <section className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Smart Key Auto-Connect
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Paste any key to auto-detect provider and verify instantly
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
            Click <strong className="text-slate-200">Connect</strong>, <strong className="text-slate-200">Fix</strong>, or <strong className="text-slate-200">Manage</strong> on any provider to open its setup guide and AES-256-GCM vault settings.
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

        {/* Clean Minimal Provider Roster: Real Logo + Name + Status + Action Button */}
        {filteredConnections.length === 0 ? (
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-8 text-center text-sm text-slate-400">
            No providers match this filter yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredConnections.map((conn) => {
              const isConnected = conn.status === 'connected';
              const broken = isBrokenHealth(conn);
              const isSharedInherited =
                conn.method === 'admin_shared' || Boolean(conn.isAdminManaged);
              const effState =
                conn.status === 'disconnected' ? 'disconnected' : conn.healthState;
              const displayName =
                conn.providerId === 'openai' ? 'ChatGPT / OpenAI' : conn.providerName;

              return (
                <div
                  key={conn.providerId}
                  className={`bg-[#111827] border rounded-xl px-4 py-3.5 flex items-center justify-between gap-3 transition-colors ${
                    broken
                      ? 'border-amber-500/45 hover:border-amber-400/60'
                      : isConnected
                        ? 'border-slate-800 hover:border-slate-700'
                        : 'border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ProviderAvatar provider={conn.providerId} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-display text-sm font-semibold text-slate-100 truncate">
                          {displayName}
                        </h3>
                        {STARTER_FREE_SET.has(conn.providerId) && (
                          <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-emerald-500/12 text-[10px] font-medium text-emerald-400 shrink-0">
                            Free
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs mt-0.5 truncate">
                        <span className={`font-medium ${getStatusTextClass(effState)}`}>
                          {isConnected && !broken
                            ? isSharedInherited
                              ? 'Connected · Premium Cloud'
                              : hideModelDetails
                                ? 'Connected'
                                : conn.discoveredModelsCount > 0
                                  ? `Connected · ${conn.discoveredModelsCount} models`
                                  : formatStatusLabel(effState)
                            : formatStatusLabel(effState)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedProviderId(conn.providerId)}
                    className={`inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      broken
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                        : isConnected
                          ? 'bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {broken ? (
                      <>
                        <Wrench className="w-3.5 h-3.5" />
                        Fix
                      </>
                    ) : isConnected ? (
                      'Manage'
                    ) : (
                      'Connect'
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
