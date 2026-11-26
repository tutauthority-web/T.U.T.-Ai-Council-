import React, { useEffect, useState } from 'react';
import { AlertTriangle, Crown, Download, LogOut, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  deleteAllUserAccountData,
  updateUserProfileSettings,
} from '../../lib/firestoreService';
import { formatParticipantDisplayLabel, isValidProviderId } from '../../shared/providers';
import type { AppRoute } from '../AppShell';

export function PortalSettingsPanel({
  onNavigate,
}: {
  onNavigate: (route: AppRoute) => void;
}) {
  const { user, profile, subscription, isPremium, isAdmin, models, councils, logout } = useAuth();
  const hideModelDetails = isPremium && !isAdmin;
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
        ...(hideModelDetails
          ? {}
          : { preferredModeratorModel: preferredModerator || undefined }),
      });
      setNotice('Profile settings saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportAccountSummary = () => {
    const safeCouncils = hideModelDetails
      ? councils.map((c) => ({
          ...c,
          selectedModels: c.selectedModels.map((cid, idx) => {
            const sep = cid.indexOf(':');
            const rawProv = sep === -1 ? 'google' : cid.slice(0, sep);
            const rawModel = sep === -1 ? cid : cid.slice(sep + 1);
            return formatParticipantDisplayLabel({
              provider: isValidProviderId(rawProv) ? rawProv : 'google',
              modelId: rawModel,
              hideModelDetails: true,
              seatLabel: `Seat ${idx + 1}`,
            });
          }),
          moderatorModel:
            c.moderatorModel === 'none' ? 'none' : 'Managed Council Moderator',
        }))
      : councils;

    const safeProfile = hideModelDetails && profile
      ? {
          ...profile,
          preferredModeratorModel: undefined,
        }
      : profile;

    const payload = {
      exportedAt: new Date().toISOString(),
      profile: safeProfile,
      subscription,
      councils: safeCouncils,
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
      onNavigate('dashboard');
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

  return (
    <div className="max-w-2xl space-y-5 animate-panel-enter">
      {/* Profile Form */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
        <h3 className="font-display text-sm sm:text-base font-semibold text-slate-100">
          Account Profile
        </h3>
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
              className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#090E1A]/60 border border-slate-800 rounded-xl text-slate-400"
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
              className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 focus:outline-none"
            />
          </div>

          {hideModelDetails ? (
            <div className="rounded-xl border border-amber-500/30 bg-[#121A2F] px-3.5 py-3 flex items-center gap-2.5 text-xs text-amber-200">
              <Crown className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Council moderator and model orchestration are selected automatically for your Premium Cloud sessions.
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="profile-mod" className="block text-xs font-medium text-slate-300">
                Default Moderator Model
              </label>
              <select
                id="profile-mod"
                value={preferredModerator}
                onChange={(e) => setPreferredModerator(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#090E1A] border border-slate-800 focus:border-blue-500 rounded-xl text-slate-100 focus:outline-none"
              >
                <option value="">Select automatically from Council models</option>
                {availableModels.map((m) => (
                  <option key={m.compositeId} value={m.compositeId}>
                    {m.provider} · {m.modelId}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-emerald-400">{notice || ''}</span>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </section>

      {/* Data Export */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-display text-sm sm:text-base font-semibold text-slate-100">
            Export Account Data
          </h3>
          <p className="text-xs text-slate-400">
            Download your profile settings, subscription state, and Council Room index as JSON.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportAccountSummary}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          Download Export
        </button>
      </section>

      {/* Session Sign Out (accessible cleanly on mobile without hamburger menu) */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-display text-sm sm:text-base font-semibold text-slate-100">
            Active Session
          </h3>
          <p className="text-xs text-slate-400">
            Signed in as {user?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logout().then(() => onNavigate('dashboard'))}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-xs font-medium bg-[#090E1A] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </section>

      {/* Account Deletion Workflow */}
      <section className="bg-[#111827] border border-rose-900/50 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2.5 text-rose-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <h3 className="font-display text-sm sm:text-base font-semibold">
            Delete Account &amp; All Data
          </h3>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          Permanently deletes all of your Council Rooms, message transcripts, usage records, model presets, encrypted provider credentials, and Firebase Authentication profile. This action cannot be undone.
        </p>

        {deleteError && (
          <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded-xl p-3">
            {deleteError}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder='Type "DELETE" to confirm'
            className="flex-1 min-h-[44px] px-3.5 py-2 text-xs bg-[#090E1A] border border-slate-800 focus:border-rose-500 rounded-xl text-slate-100 placeholder-slate-500 font-mono focus:outline-none"
          />
          <button
            type="button"
            disabled={deleting || deleteConfirmText !== 'DELETE'}
            onClick={() => void handleDeleteAccount()}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-xl transition-colors whitespace-nowrap cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {deleting ? 'Deleting Data...' : 'Delete Account'}
          </button>
        </div>
      </section>
    </div>
  );
}
