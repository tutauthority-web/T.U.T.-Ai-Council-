import React, { createContext, useContext, useState } from 'react';
import {
  Activity,
  Archive,
  Crown,
  Globe,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { PROVIDER_LIST } from '../shared/providers';

export type AppRoute =
  | 'landing'
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

interface AppShellProps {
  currentRoute: AppRoute;
  pageTitle: string;
  breadcrumb?: string;
  onNavigate: (route: AppRoute, councilId?: string) => void;
  primaryAction?: React.ReactNode;
  fullBleed?: boolean;
  hideTopBar?: boolean;
  children: React.ReactNode;
}

const AppShellMenuContext = createContext<(() => void) | null>(null);

export function AppShellMobileMenuButton({ className = '' }: { className?: string }) {
  const openMenu = useContext(AppShellMenuContext);
  if (!openMenu) return null;
  return (
    <button
      type="button"
      onClick={openMenu}
      className={`lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer ${className}`}
      aria-label="Open navigation"
    >
      <Menu className="w-5 h-5" />
    </button>
  );
}

type NavItem = {
  id: AppRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const WORKSPACE_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'AI Playground', icon: LayoutDashboard },
  { id: 'new-council', label: 'New Council Room', icon: MessageSquarePlus },
  { id: 'models', label: 'AI Model Land', icon: Layers },
  { id: 'history', label: 'Chat History', icon: MessageSquare },
];

const USER_PORTAL_NAV_ITEMS: NavItem[] = [
  { id: 'portal', label: 'User Portal', icon: UserRound },
  { id: 'premium', label: 'Council Premium', icon: Crown },
  { id: 'connections', label: 'API Connections', icon: KeyRound },
  { id: 'usage', label: 'Usage & Guardrails', icon: Activity },
  { id: 'settings', label: 'Profile & Settings', icon: Settings },
];

const ADMIN_PORTAL_NAV_ITEMS: NavItem[] = [
  { id: 'admin', label: 'Admin Portal', icon: ShieldCheck },
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
  { id: 'history', label: 'Chat History', icon: MessageSquare },
  { id: 'portal', label: 'Portal', icon: UserRound },
];

export function AppShell({
  currentRoute,
  pageTitle,
  breadcrumb,
  onNavigate,
  primaryAction,
  fullBleed = false,
  hideTopBar = false,
  children,
}: AppShellProps) {
  const { user, profile, connections, isPremium, isAdmin, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const connectedCount = connections.filter((c) => c.status === 'connected').length;

  const accountSubtitle = user?.emailVerified
    ? isAdmin
      ? `Admin · ${user.email}`
      : isPremium
        ? `Premium · ${user.email}`
        : `Free Tier · ${user.email}`
    : '';

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0C1222] border-r border-slate-800/80">
      <div className="px-5 py-5 border-b border-slate-800/80 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            onNavigate('dashboard');
            setMobileOpen(false);
          }}
          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded cursor-pointer"
        >
          <span className="font-display font-bold text-base tracking-tight text-slate-100 block whitespace-nowrap">
            T.U.T AI Council
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-100 rounded-lg cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {(
          [
            { heading: 'Workspace', items: WORKSPACE_NAV_ITEMS },
            { heading: 'User Portal', items: USER_PORTAL_NAV_ITEMS },
            ...(isAdmin
              ? [{ heading: 'Admin Portal', items: ADMIN_PORTAL_NAV_ITEMS }]
              : []),
          ] as Array<{ heading: string; items: NavItem[] }>
        ).map((group) => (
          <div key={group.heading} className="space-y-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {group.heading}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active =
                currentRoute === item.id ||
                (currentRoute === 'council-room' && item.id === 'history');
              const isGoldAccent = item.id === 'premium' || item.id === 'admin';
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onNavigate(item.id);
                    setMobileOpen(false);
                  }}
                  className={`w-full min-h-[42px] flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
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
                  {item.id === 'connections' && (
                    <span className="text-xs font-mono tabular-nums text-slate-400">
                      {connectedCount}/{PROVIDER_LIST.length}
                    </span>
                  )}
                  {item.id === 'premium' && isPremium && (
                    <span className="text-[11px] font-medium text-amber-300">Active</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-800/80 space-y-3">
        {user && user.emailVerified ? (
          <>
            <div className="flex items-center gap-3 min-w-0">
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
            </div>
            <button
              type="button"
              onClick={() => void logout().then(() => onNavigate('dashboard'))}
              className="w-full min-h-[38px] flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/70 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
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
              onClick={() => {
                onNavigate('auth');
                setMobileOpen(false);
              }}
              className="w-full min-h-[40px] flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <AppShellMenuContext.Provider value={() => setMobileOpen(true)}>
      <div className="min-h-screen bg-[#090E1A] text-slate-100 flex">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
          {sidebarContent}
        </aside>

        {/* Mobile Drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-black/65"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="relative w-72 max-w-[85vw] h-full z-10">
              {sidebarContent}
            </aside>
          </div>
        )}

        {/* Main Content Viewport */}
        <div
          className={`flex-1 flex flex-col min-w-0 ${
            fullBleed ? 'h-[100dvh] overflow-hidden' : 'min-h-screen'
          }`}
        >
          {!hideTopBar && (
            <header className="sticky top-0 z-30 h-16 px-4 sm:px-8 bg-[#090E1A]/90 backdrop-blur border-b border-slate-800/80 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="lg:hidden min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center text-slate-300 hover:text-white rounded-lg cursor-pointer"
                  aria-label="Open navigation"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div className="min-w-0 flex items-center gap-2 text-sm">
                  {breadcrumb && (
                    <>
                      <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
                        {breadcrumb}
                      </span>
                      <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
                        /
                      </span>
                    </>
                  )}
                  <h1 className="font-display font-semibold text-base sm:text-lg text-slate-100 truncate">
                    {pageTitle}
                  </h1>
                </div>
              </div>

              {primaryAction && <div className="shrink-0">{primaryAction}</div>}
            </header>
          )}

          <main
            className={
              fullBleed
                ? 'flex-1 w-full min-h-0 flex flex-col overflow-hidden relative'
                : 'flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-8 py-6 sm:py-8'
            }
          >
            {children}
          </main>

          {/* Native App Bottom Navigation Bar (hidden inside active chat room) */}
          {currentRoute !== 'council-room' && (
            <nav
              aria-label="App bottom navigation"
              className="sticky bottom-0 shrink-0 z-30 bg-[#0B1120]/95 backdrop-blur border-t border-slate-800/90 px-2 pt-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))]"
            >
              <div className="max-w-xl mx-auto grid grid-cols-5 items-center gap-1">
                {BOTTOM_BAR_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = currentRoute === item.id;
                  if (item.isPremium) {
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onNavigate(item.id)}
                        className={`min-h-[44px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-transform active:scale-95 cursor-pointer ${
                          active ? 'text-amber-300' : 'text-amber-200/90 hover:text-amber-200'
                        }`}
                      >
                        <span
                          className={`w-10 h-8 rounded-xl flex items-center justify-center shadow-md transition-colors ${
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
                      className={`relative min-h-[44px] flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-colors cursor-pointer ${
                        active
                          ? 'text-blue-400 bg-blue-500/10'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-[10px] font-medium mt-1 leading-none truncate">
                        {item.label}
                      </span>
                      {item.id === 'connections' && (
                        <span className="absolute top-1 right-2.5 text-[9px] font-mono tabular-nums text-slate-400">
                          {connectedCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </nav>
          )}
        </div>
      </div>
    </AppShellMenuContext.Provider>
  );
}
