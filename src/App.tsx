import { useEffect, useRef, useState } from 'react';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import type { AppRoute } from './components/AppShell';
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
import { LandingPage } from './pages/LandingPage';
import { ModelLibraryPage } from './pages/ModelLibraryPage';
import { NewCouncilPage } from './pages/NewCouncilPage';
import { PremiumPage, TUT_GATEWAY_PENDING_KEY } from './pages/PremiumPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsageBillingPage } from './pages/UsageBillingPage';
import { UserPortalPage } from './pages/UserPortalPage';
import type { DiscussionMode } from './shared/types';

function readGatewayReturnFromLocation(): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  const search = new URLSearchParams(window.location.search);
  let hasGatewaySignal =
    search.has('orderId') ||
    search.has('order_id') ||
    search.has('tut_status') ||
    search.has('receipt') ||
    search.has('receiptId') ||
    search.has('trxId') ||
    search.has('transactionId') ||
    search.has('proof') ||
    search.has('paid') ||
    search.has('cancelled') ||
    search.has('canceled');

  let pendingOrderId = '';
  try {
    const raw = window.sessionStorage.getItem(TUT_GATEWAY_PENDING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { orderId?: string };
      if (parsed?.orderId) pendingOrderId = parsed.orderId;
    }
  } catch {
    pendingOrderId = '';
  }

  if (
    !hasGatewaySignal &&
    pendingOrderId &&
    (search.has('status') || search.has('payment_status') || search.has('token'))
  ) {
    hasGatewaySignal = true;
  }

  if (!hasGatewaySignal) return null;

  const captured: Record<string, string> = {};
  search.forEach((value, key) => {
    captured[key] = value;
  });
  if (!captured.orderId && !captured.order_id && pendingOrderId) {
    captured.orderId = pendingOrderId;
  }
  return Object.keys(captured).length > 0 ? captured : null;
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

function AppRouter() {
  const { user, authReady, subscription, isPremium, isAdmin } = useAuth();
  const [gatewayReturnParams, setGatewayReturnParams] = useState<Record<string, string> | null>(
    () => readGatewayReturnFromLocation(),
  );
  const [route, setRoute] = useState<AppRoute>(() =>
    readGatewayReturnFromLocation() ? 'premium' : 'dashboard',
  );
  const [activeCouncilId, setActiveCouncilId] = useState<string>('');
  const [autoPrompt, setAutoPrompt] = useState<string | null>(null);
  const [draftModels, setDraftModels] = useState<string[]>([]);
  const [draftModerator, setDraftModerator] = useState<string | undefined>(undefined);
  const [draftMode, setDraftMode] = useState<DiscussionMode>('chat');
  const [promoOpen, setPromoOpen] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const dwellCompleteRef = useRef(false);

  useEffect(() => {
    if (gatewayReturnParams && typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
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

  const navigate = (nextRoute: AppRoute, councilId?: string) => {
    setRoute(nextRoute);
    if (councilId) {
      setActiveCouncilId(councilId);
    }
  };

  let pageContent: React.ReactNode;

  if (!authReady) {
    pageContent = (
      <AppLoadingScreen
        stage="Initializing workspace..."
        progress={32}
      />
    );
  } else if (route === 'landing') {
    pageContent = <LandingPage onNavigate={navigate} />;
  } else if (route === 'dashboard') {
    pageContent = (
      <DashboardPage
        onNavigate={navigate}
        onEnterNewCouncil={(mode) => {
          setDraftMode(mode);
          setRoute(user && user.emailVerified ? 'new-council' : 'auth');
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
          setRoute(user && user.emailVerified ? 'new-council' : 'auth');
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
            setRoute('new-council');
          }}
        />
      );
    } else {
      pageContent = <AuthPage onNavigate={navigate} />;
    }
  } else if (route === 'connections') {
    pageContent = <ConnectionsPage onNavigate={navigate} />;
  } else if (route === 'new-council') {
    pageContent = (
      <NewCouncilPage
        initialSelectedModels={draftModels}
        initialModeratorModel={draftModerator}
        initialMode={draftMode}
        onNavigate={navigate}
        onCreatedAndStart={(councilId, promptText) => {
          setDraftModels([]);
          setDraftModerator(undefined);
          setDraftMode('chat');
          setActiveCouncilId(councilId);
          setAutoPrompt(promptText.trim() ? promptText : null);
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
      />
    );
  } else if (route === 'history') {
    pageContent = <HistoryPage onNavigate={navigate} />;
  } else if (route === 'portal') {
    pageContent = <UserPortalPage onNavigate={navigate} />;
  } else if (route === 'admin') {
    pageContent = <AdminPortalPage onNavigate={navigate} />;
  } else if (route === 'usage') {
    pageContent = <UsageBillingPage onNavigate={navigate} />;
  } else {
    pageContent = <SettingsPage onNavigate={navigate} />;
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
