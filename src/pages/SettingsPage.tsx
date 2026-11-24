import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Crown, Download, KeyRound, Trash2 } from 'lucide-react';
import { AppShell, type AppRoute } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteAllUserAccountData,
  updateUserProfileSettings,
} from '../lib/firestoreService';
import { getPremiumPlan } from '../shared/types';

export function SettingsPage({
  onNavigate,
}: {
  onNavigate: (route: AppRoute) => void;
}) {
  const { user, profile, subscription, isPremium, isAdmin, models, councils } = useAuth();
  const availableModels = models.filter((m) => m.available);

  const [displayName, setDisplayName] = useState(
    profile?.displayName || user?.displayName || '',
  );
  const [preferredModerator, setPreferredModerator] = useState(
    profile?.preferredModeratorModel || '',
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile && !user) return;
    setDisplayName(profile?.displayName || user?.displayName || '');
    setPreferredModerator(profile?.preferredModeratorModel || '');
  }, [profile, user]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setNotice(null);
    try {
      await updateUserProfileSettings(user.uid, {
        displayName: displayName.trim(),
        preferredModeratorModel: preferredModerator || undefined,
      });
      setNotice('Profile settings saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportAccountSummary = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      profile,
      subscription,
      councils,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tut-ai-council-account-export.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAccount = async () => {
    if (!user || deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAllUserAccountData(user);
      onNavigate('landing');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDeleteError(
        msg.includes('requires-recent-login')
          ? 'Firebase requires a recent sign-in before deleting your account. Sign out, sign back in, and retry deletion.'
          : msg,
      );
      setDeleting(false);
    }
  };

  const plan = subscription?.cycle ? getPremiumPlan(subscription.cycle) : null;
  const expiryLabel = subscription?.expiresAt
    ? new Date(subscription.expiresAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <AppShell
      currentRoute="settings"
      pageTitle="Profile & Settings"
      breadcrumb="Workspace"
      onNavigate={onNavigate}
    >
      <div className="max-w-2xl space-y-6">
        {/* Membership & Tier Card */}
        <section
          className={`rounded-xl border p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            isPremium
              ? 'bg-[#121A2F] border-amber-500/40'
              : 'bg-[#111827] border-slate-800'
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Crown className={`w-4 h-4 ${isPremium ? 'text-amber-300' : 'text-slate-400'}`} />
              <h2 className="font-display text-base font-semibold text-slate-100">
                {isAdmin
                  ? 'Administrator Workspace'
                  : isPremium
                    ? 'Council Premium Active'
                    : 'Free Tier (BYOK)'}
              </h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed tabular-nums">
              {isAdmin
                ? 'Full Admin access · Manage shared APIs, verify bKash/Nagad payments, and configure MLA link.'
                : isPremium
                  ? `${plan ? `${plan.label} (${plan.priceBdt}৳)` : 'Active Premium'}${
                      expiryLabel ? ` · Valid until ${expiryLabel}` : ''
                    } · Using Admin-connected APIs.`
                  : 'Using your personal API keys. Upgrade from 29৳/month for Admin-managed APIs and automatic seating.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('portal')}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 py-2 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>User Portal</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('connections')}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 py-2 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              API Keys
            </button>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <span>Admin Portal</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('premium')}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <span>{isPremium ? 'Extend Plan' : 'Go Premium'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </section>

        {/* Profile Form */}
        <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5">
          <h2 className="font-display text-base font-semibold text-slate-100">
            Account Profile
          </h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="profile-email" className="block text-xs font-medium text-slate-300">
                Verified Email
              </label>
              <input
                id="profile-email"
                type="text"
                disabled
                value={user?.email || ''}
                className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#090E1A]/60 border border-slate-800 rounded-lg text-slate-400"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="profile-name" className="block text-xs font-medium text-slate-300">
                Display Name
              </label>
              <input
                id="profile-name"
                type="text"
                required
                maxLength={120}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="profile-mod" className="block text-xs font-medium text-slate-300">
                Default Moderator Model
              </label>
              <select
                id="profile-mod"
                value={preferredModerator}
                onChange={(e) => setPreferredModerator(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-lg text-slate-100 focus:outline-none"
              >
                <option value="">Select automatically from Council models</option>
                {availableModels.map((m) => (
                  <option key={m.compositeId} value={m.compositeId}>
                    {m.provider} · {m.modelId}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-emerald-400">{notice || ''}</span>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        </section>

        {/* Data Export */}
        <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-slate-100">
              Export Account Data
            </h2>
            <p className="text-xs text-slate-400">
              Download your profile settings, subscription state, and Council Room index as JSON.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportAccountSummary}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download Export
          </button>
        </section>

        {/* Account Deletion Workflow */}
        <section className="bg-[#111827] border border-rose-900/50 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-rose-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h2 className="font-display text-base font-semibold">
              Delete Account &amp; All Data
            </h2>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Permanently deletes all of your Council Rooms, message transcripts, usage records, model presets, encrypted provider credentials, and Firebase Authentication profile. This action cannot be undone.
          </p>

          {deleteError && (
            <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded-lg p-3">
              {deleteError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder='Type "DELETE" to confirm'
              className="flex-1 min-h-[44px] px-3.5 py-2 text-xs bg-[#090E1A] border border-slate-800 focus:border-rose-500 rounded-lg text-slate-100 placeholder-slate-500 font-mono focus:outline-none"
            />
            <button
              type="button"
              disabled={deleting || deleteConfirmText !== 'DELETE'}
              onClick={() => void handleDeleteAccount()}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleting ? 'Deleting Data...' : 'Delete Account'}
            </button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
