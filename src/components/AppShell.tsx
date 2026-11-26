import React from 'react';
import {
  ArrowLeft,
  Crown,
  Globe,
  KeyRound,
  LogIn,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { PROVIDER_LIST } from '../shared/providers';

export type AppRoute =
  | 'auth'
  | 'dashboard'
  | 'new-council'
  | 'council-room'
  | 'models'
  | 'connections'
  | 'history'
  | 'usage'
  | 'settings'
  | 'premium'
  | 'portal'
  | 'admin';

export const PRIMARY_ROOT_ROUTES: ReadonlySet<AppRoute> = new Set([
  'dashboard',
  'models',
  'premium',
  'history',
  'portal',
  'usage',
  'settings',
]);

interface AppShellProps {
  currentRoute: AppRoute;
  pageTitle: string;
  onNavigate: (route: AppRoute, councilId?: string) => void;
  onBack?: () => void;
  showBackButton?: boolean;
  primaryAction?: React.ReactNode;
  fullBleed?: boolean;
  hideTopBar?: boolean;
  children: React.ReactNode;
}

type RailItem = {
  id: AppRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const RAIL_PRIMARY_ITEMS: RailItem[] = [
  { id: 'dashboard', label: 'AI Playground', icon: Sparkles },
  { id: 'models', label: 'AI Model Land', icon: Globe },
  { id: 'history', label: 'Chat History', icon: MessageSquare },
  { id: 'premium', label: 'Council Premium', icon: Crown },
  { id: 'portal', label: 'Portal', icon: UserRound },
];

const RAIL_UTILITY_ITEMS: RailItem[] = [
  { id: 'connections', label: 'API Connections', icon: KeyRound },
];

const BOTTOM_BAR_ITEMS: Array<{
  id: AppRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isPremium?: boolean;
}> = [
  { id: 'dashboard', label: 'Playground', icon: Sparkles },
  { id: 'models', label: 'Model Land', icon: Globe },
  { id: 'premium', label: 'Premium', icon: Crown, isPremium: true },
  { id: 'history', label: 'Chats', icon: MessageSquare },
  { id: 'portal', label: 'Portal', icon: UserRound },
];

export function AppShell({
  currentRoute,
  pageTitle,
  onNavigate,
  onBack,
  showBackButton = false,
  primaryAction,
  fullBleed = false,
  hideTopBar = false,
  children,
}: AppShellProps) {
  const { user, profile, connections, isPremium, isAdmin, logout } = useAuth();

  const connectedCount = connections.filter((c) => c.status === 'connected').length;
  const isPortalRoute =
    currentRoute === 'portal' || currentRoute === 'usage' || currentRoute === 'settings';
  const showMobileBottomBar = PRIMARY_ROOT_ROUTES.has(currentRoute);

  const accountSubtitle = user?.emailVerified
    ? isAdmin
      ? `Admin · ${user.email}`
      : isPremium
        ? `Premium · ${user.email}`
        : `Free · ${user.email}`
    : '';

  const isNavItemActive = (itemId: AppRoute): boolean => {
    if (itemId === 'portal') return isPortalRoute;
    if (itemId === 'history') return currentRoute === 'history' || currentRoute === 'council-room';
    return currentRoute === itemId;
  };

  return (
    <div className="min-h-screen bg-[#090E1A] text-slate-100 flex">
      {/* Desktop App Navigation Rail */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 sticky top-0 h-screen bg-[#0C1222] border-r border-slate-800/80">
        <div className="px-4 pt-4 pb-3 space-y-3 border-b border-slate-800/80">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="w-full text-left px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded cursor-pointer"
          >
            <span className="font-display font-bold text-base tracking-tight text-slate-100 block whitespace-nowrap">
              T.U.T AI Council
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('new-council')}
            className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
          >
            <MessageSquarePlus className="w-4 h-4 shrink-0" />
            New Council
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto" aria-label="Primary navigation">
          <div className="space-y-1">
            {RAIL_PRIMARY_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isNavItemActive(item.id);
              const isGoldAccent = item.id === 'premium';
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`w-full min-h-[42px] flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? isGoldAccent
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'bg-blue-600/15 text-blue-300 border border-blue-500/30'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isGoldAccent && !active ? 'text-amber-400/90' : ''
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.id === 'premium' && isPremium && (
                    <span className="text-[11px] font-medium text-amber-300">Active</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-800/80 space-y-1">
            {RAIL_UTILITY_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = currentRoute === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`w-full min-h-[42px] flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-400">
                    {connectedCount}/{PROVIDER_LIST.length}
                  </span>
                </button>
              );
            })}

            {isAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className={`w-full min-h-[42px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  currentRoute === 'admin'
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent'
                }`}
              >
                <ShieldCheck
                  className={`w-4 h-4 shrink-0 ${
                    currentRoute === 'admin' ? '' : 'text-amber-400/90'
                  }`}
                />
                <span className="truncate">Admin Portal</span>
              </button>
            )}
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800/80 space-y-3">
          {user && user.emailVerified ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('portal')}
                className="w-full flex items-center gap-3 min-w-0 text-left rounded-xl p-1 -m-1 hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={profile?.displayName || 'User avatar'}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-lg object-cover border border-slate-700 shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-200 shrink-0">
                    {(profile?.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-100 truncate">
                    {profile?.displayName || user.displayName || 'Council Member'}
                  </p>
                  <p
                    className={`text-xs truncate ${
                      isPremium ? 'text-amber-300/90' : 'text-slate-400'
                    }`}
                  >
                    {accountSubtitle}
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => void logout().then(() => onNavigate('dashboard'))}
                className="w-full min-h-[38px] flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/70 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-sky-300 shrink-0">
                  G
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-100 truncate">Guest Explorer</p>
                  <p className="text-xs text-slate-400 truncate">Sign in to sync workspace</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('auth')}
                className="w-full min-h-[40px] flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${
          fullBleed ? 'h-[100dvh] overflow-hidden' : 'min-h-screen'
        }`}
      >
        {!hideTopBar && (
          <header className="sticky top-0 z-30 h-[52px] sm:h-14 px-3 sm:px-8 bg-[#090E1A]/92 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {showBackButton && onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="min-h-[44px] min-w-[44px] -ml-1.5 flex items-center justify-center text-slate-200 hover:text-white hover:bg-slate-800/70 rounded-xl transition-colors cursor-pointer shrink-0"
                  aria-label="Go back"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <h1 className="font-display font-semibold text-base sm:text-lg text-slate-100 truncate">
                {pageTitle}
              </h1>
            </div>

            {primaryAction && <div className="shrink-0">{primaryAction}</div>}
          </header>
        )}

        <main
          className={
            fullBleed
              ? 'flex-1 w-full min-h-0 flex flex-col overflow-hidden relative'
              : 'flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-8 py-5 sm:py-7'
          }
        >
          {children}
        </main>

        {/* Mobile Bottom Tab Bar (5 primary root tabs, strictly <= 15% sticky height) */}
        {showMobileBottomBar && (
          <nav
            aria-label="App bottom navigation"
            className="lg:hidden sticky bottom-0 shrink-0 z-30 bg-[#0B1120]/95 backdrop-blur-md border-t border-slate-800/90 px-2 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))]"
          >
            <div className="max-w-lg mx-auto grid grid-cols-5 items-center gap-1">
              {BOTTOM_BAR_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(item.id);
                if (item.isPremium) {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      className={`min-h-[44px] flex flex-col items-center justify-center py-0.5 px-1 rounded-xl transition-transform active:scale-95 cursor-pointer ${
                        active ? 'text-amber-300' : 'text-amber-200/90 hover:text-amber-200'
                      }`}
                    >
                      <span
                        className={`w-9 h-7 rounded-xl flex items-center justify-center shadow-md transition-colors ${
                          active
                            ? 'bg-gradient-to-r from-amber-300 to-amber-500 text-slate-950 ring-2 ring-amber-300/60'
                            : 'bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="text-[10px] font-semibold mt-0.5 leading-none truncate">
                        {isPremium ? 'Active' : item.label}
                      </span>
                    </button>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={`relative min-h-[44px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer ${
                      active
                        ? 'text-blue-400 bg-blue-500/10'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="text-[10px] font-medium mt-1 leading-none truncate">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
