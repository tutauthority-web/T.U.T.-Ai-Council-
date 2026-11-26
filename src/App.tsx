import { useCallback, useEffect, useRef, useState } from 'react';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import { PRIMARY_ROOT_ROUTES, type AppRoute } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PremiumPromoModal } from './components/PremiumPromoModal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { WorldThemeProvider } from './contexts/WorldThemeContext';
import { AdminPortalPage } from './pages/AdminPortalPage';
import { AuthPage } from './pages/AuthPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { CouncilRoomPage } from './pages/CouncilRoomPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { ModelLibraryPage } from './pages/ModelLibraryPage';
import { NewCouncilPage } from './pages/NewCouncilPage';
import { PremiumPage, type TutGatewayReturnParams } from './pages/PremiumPage';
import { UserPortalPage, type PortalTab } from './pages/UserPortalPage';
import type { DiscussionMode } from './shared/types';

function readGatewayReturnFromLocation(): TutGatewayReturnParams | null {
  if (typeof window === 'undefined') return null;
  const search = new URLSearchParams(window.location.search);
  const isCallbackPath = window.location.pathname === '/payment-callback';
  const hasGatewaySignal =
    isCallbackPath || search.has('tut_token') || search.has('tut_status');

  if (!hasGatewaySignal) return null;

  const tutToken = (search.get('tut_token') || search.get('token') || '').trim() || undefined;
  const tutStatus = (search.get('tut_status') || search.get('status') || '').trim() || undefined;
  const orderId = (search.get('orderId') || search.get('order_id') || '').trim() || undefined;

  return { tutToken, tutStatus, orderId };
}

const PROMO_SESSION_KEY = 'tut_premium_promo_seen';
const PROMO_ELIGIBLE_ROUTES: ReadonlySet<AppRoute> = new Set([
  'dashboard',
  'models',
  'connections',
  'history',
  'portal',
  'usage',
  'settings',
]);

function readPromoSeen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.sessionStorage.getItem(PROMO_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markPromoSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PROMO_SESSION_KEY, '1');
  } catch {
    // Ignore storage errors
  }
}

function resolvePortalTabFromRoute(route: AppRoute): PortalTab {
  if (route === 'usage') return 'usage';
  if (route === 'settings') return 'settings';
  return 'account';
}

function AppRouter() {
  const { user, authReady, subscription, isPremium, isAdmin } = useAuth();
  const [gatewayReturnParams, setGatewayReturnParams] = useState<TutGatewayReturnParams | null>(
    () => readGatewayReturnFromLocation(),
  );
  const [route, setRoute] = useState<AppRoute>(() =>
    readGatewayReturnFromLocation() ? 'premium' : 'dashboard',
  );
  const [historyStack, setHistoryStack] = useState<AppRoute[]>([]);
  const [portalTab, setPortalTab] = useState<PortalTab>('account');
  const [activeCouncilId, setActiveCouncilId] = useState<string>('');
  const [autoPrompt, setAutoPrompt] = useState<string | null>(null);
  const [draftModels, setDraftModels] = useState<string[]>([]);
  const [draftModerator, setDraftModerator] = useState<string | undefined>(undefined);
  const [draftMode, setDraftMode] = useState<DiscussionMode>('chat');
  const [promoOpen, setPromoOpen] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const dwellCompleteRef = useRef(false);

  useEffect(() => {
    if (
      gatewayReturnParams &&
      typeof window !== 'undefined' &&
      (window.location.pathname === '/payment-callback' || window.location.search)
    ) {
      window.history.replaceState({}, document.title, '/');
    }
  }, [gatewayReturnParams]);

  useEffect(() => {
    if (hasInteracted || typeof window === 'undefined') return;
    const onInteract = () => setHasInteracted(true);
    window.addEventListener('pointerdown', onInteract, { passive: true, once: true });
    window.addEventListener('keydown', onInteract, { passive: true, once: true });
    window.addEventListener('scroll', onInteract, { passive: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
      window.removeEventListener('scroll', onInteract);
    };
  }, [hasInteracted]);

  const promoEligible =
    authReady &&
    subscription !== null &&
    Boolean(user && user.emailVerified) &&
    !isPremium &&
    !isAdmin &&
    !gatewayReturnParams &&
    PROMO_ELIGIBLE_ROUTES.has(route) &&
    !readPromoSeen();

  useEffect(() => {
    if (!promoEligible) {
      dwellCompleteRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      dwellCompleteRef.current = true;
      if (hasInteracted && !readPromoSeen()) {
        markPromoSeen();
        setPromoOpen(true);
      }
    }, 10500);
    return () => window.clearTimeout(timer);
  }, [promoEligible, hasInteracted]);

  useEffect(() => {
    if (promoEligible && hasInteracted && dwellCompleteRef.current && !readPromoSeen()) {
      markPromoSeen();
      setPromoOpen(true);
    }
  }, [promoEligible, hasInteracted]);

  const navigate = useCallback(
    (nextRoute: AppRoute, councilId?: string) => {
      if (nextRoute === 'usage' || nextRoute === 'settings') {
        setPortalTab(resolvePortalTabFromRoute(nextRoute));
        nextRoute = 'portal';
      } else if (nextRoute === 'portal') {
        setPortalTab('account');
      }

      setRoute((prev) => {
        if (prev !== nextRoute) {
          if (PRIMARY_ROOT_ROUTES.has(nextRoute)) {
            setHistoryStack([]);
          } else {
            setHistoryStack((stack) => [...stack.slice(-6), prev]);
          }
        }
        return nextRoute;
      });

      if (councilId) {
        setActiveCouncilId(councilId);
      }
    },
    [],
  );

  const goBack = useCallback(() => {
    if (historyStack.length > 0) {
      const target = historyStack[historyStack.length - 1];
      setHistoryStack((stack) => stack.slice(0, -1));
      setRoute(target);
      return;
    }
    if (route === 'council-room') {
      setRoute('history');
    } else if (route === 'admin') {
      setRoute('portal');
    } else {
      setRoute('dashboard');
    }
  }, [historyStack, route]);

  let pageContent: React.ReactNode;

  if (!authReady) {
    pageContent = (
      <AppLoadingScreen
        stage="Initializing workspace..."
        progress={32}
      />
    );
  } else if (route === 'dashboard') {
    pageContent = (
      <DashboardPage
        onNavigate={navigate}
        onEnterNewCouncil={(mode) => {
          setDraftMode(mode);
          navigate(user && user.emailVerified ? 'new-council' : 'auth');
        }}
      />
    );
  } else if (route === 'models') {
    pageContent = (
      <ModelLibraryPage
        onNavigate={navigate}
        onStartCouncilWithSelection={(models, mod) => {
          setDraftModels(models);
          setDraftModerator(mod);
          navigate(user && user.emailVerified ? 'new-council' : 'auth');
        }}
      />
    );
  } else if (route === 'premium') {
    pageContent = (
      <PremiumPage
        onNavigate={navigate}
        initialGatewayReturn={gatewayReturnParams}
        onClearGatewayReturn={() => setGatewayReturnParams(null)}
      />
    );
  } else if (!user || !user.emailVerified || route === 'auth') {
    if (user && user.emailVerified && route === 'auth') {
      pageContent = (
        <DashboardPage
          onNavigate={navigate}
          onEnterNewCouncil={(mode) => {
            setDraftMode(mode);
            navigate('new-council');
          }}
        />
      );
    } else {
      pageContent = <AuthPage onNavigate={navigate} onBack={goBack} />;
    }
  } else if (route === 'connections') {
    pageContent = <ConnectionsPage onNavigate={navigate} onBack={goBack} />;
  } else if (route === 'new-council') {
    pageContent = (
      <NewCouncilPage
        initialSelectedModels={draftModels}
        initialModeratorModel={draftModerator}
        initialMode={draftMode}
        onNavigate={navigate}
        onBack={goBack}
        onCreatedAndStart={(councilId, promptText) => {
          setDraftModels([]);
          setDraftModerator(undefined);
          setDraftMode('chat');
          setActiveCouncilId(councilId);
          setAutoPrompt(promptText.trim() ? promptText : null);
          setHistoryStack(['history']);
          setRoute('council-room');
        }}
      />
    );
  } else if (route === 'council-room') {
    pageContent = (
      <CouncilRoomPage
        councilId={activeCouncilId}
        initialAutoPrompt={autoPrompt}
        onClearInitialPrompt={() => setAutoPrompt(null)}
        onNavigate={navigate}
        onBack={goBack}
      />
    );
  } else if (route === 'history') {
    pageContent = <HistoryPage onNavigate={navigate} />;
  } else if (route === 'admin') {
    pageContent = <AdminPortalPage onNavigate={navigate} onBack={goBack} />;
  } else {
    // Unified Portal (Account & Receipts | Usage & Guardrails | Settings)
    pageContent = (
      <UserPortalPage
        onNavigate={navigate}
        activeTab={portalTab}
        onChangeTab={setPortalTab}
      />
    );
  }

  return (
    <>
      {pageContent}
      <PremiumPromoModal
        open={promoOpen}
        onUpgrade={() => {
          markPromoSeen();
          setPromoOpen(false);
          navigate('premium');
        }}
        onDismiss={() => {
          markPromoSeen();
          setPromoOpen(false);
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WorldThemeProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </WorldThemeProvider>
    </ErrorBoundary>
  );
}
