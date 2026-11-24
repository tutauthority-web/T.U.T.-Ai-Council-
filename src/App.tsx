import { useEffect, useState } from 'react';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import type { AppRoute } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
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

function AppRouter() {
  const { user, authReady } = useAuth();
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

  useEffect(() => {
    if (gatewayReturnParams && typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [gatewayReturnParams]);

  const navigate = (nextRoute: AppRoute, councilId?: string) => {
    setRoute(nextRoute);
    if (councilId) {
      setActiveCouncilId(councilId);
    }
  };

  if (!authReady) {
    return (
      <AppLoadingScreen
        stage="Initializing workspace..."
        progress={32}
      />
    );
  }

  // Publicly accessible universe & membership screens (no hard gate on initial entry)
  if (route === 'landing') {
    return <LandingPage onNavigate={navigate} />;
  }

  if (route === 'dashboard') {
    return (
      <DashboardPage
        onNavigate={navigate}
        onEnterNewCouncil={(mode) => {
          setDraftMode(mode);
          setRoute(user && user.emailVerified ? 'new-council' : 'auth');
        }}
      />
    );
  }

  if (route === 'models') {
    return (
      <ModelLibraryPage
        onNavigate={navigate}
        onStartCouncilWithSelection={(models, mod) => {
          setDraftModels(models);
          setDraftModerator(mod);
          setRoute(user && user.emailVerified ? 'new-council' : 'auth');
        }}
      />
    );
  }

  if (route === 'premium') {
    return (
      <PremiumPage
        onNavigate={navigate}
        initialGatewayReturn={gatewayReturnParams}
        onClearGatewayReturn={() => setGatewayReturnParams(null)}
      />
    );
  }

  // Require authenticated + verified user for private workspace pages
  if (!user || !user.emailVerified || route === 'auth') {
    if (user && user.emailVerified && route === 'auth') {
      return (
        <DashboardPage
          onNavigate={navigate}
          onEnterNewCouncil={(mode) => {
            setDraftMode(mode);
            setRoute('new-council');
          }}
        />
      );
    }
    return <AuthPage onNavigate={navigate} />;
  }

  if (route === 'connections') {
    return <ConnectionsPage onNavigate={navigate} />;
  }

  if (route === 'new-council') {
    return (
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
  }

  if (route === 'council-room') {
    return (
      <CouncilRoomPage
        councilId={activeCouncilId}
        initialAutoPrompt={autoPrompt}
        onClearInitialPrompt={() => setAutoPrompt(null)}
        onNavigate={navigate}
      />
    );
  }

  if (route === 'history') {
    return <HistoryPage onNavigate={navigate} />;
  }

  if (route === 'portal') {
    return <UserPortalPage onNavigate={navigate} />;
  }

  if (route === 'admin') {
    return <AdminPortalPage onNavigate={navigate} />;
  }

  if (route === 'usage') {
    return <UsageBillingPage onNavigate={navigate} />;
  }

  return <SettingsPage onNavigate={navigate} />;
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
