import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AppLoadingScreen } from '../components/AppLoadingScreen';
import { AppShell, type AppRoute } from '../components/AppShell';
import { useWorldTheme } from '../contexts/WorldThemeContext';
import type { DiscussionMode } from '../shared/types';

const PlaygroundExperience = lazy(() =>
  import('../components/world/PlaygroundExperience').then((mod) => ({
    default: mod.PlaygroundExperience,
  })),
);

export function DashboardPage({
  onNavigate,
  onEnterNewCouncil,
}: {
  onNavigate: (route: AppRoute, councilId?: string) => void;
  onEnterNewCouncil?: (mode: DiscussionMode) => void;
}) {
  const { reducedMotion } = useWorldTheme();
  const [worldReady, setWorldReady] = useState(false);
  const [minElapsed, setMinElapsed] = useState(reducedMotion);
  const [showOverlay, setShowOverlay] = useState(true);
  const mountTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (reducedMotion) {
      setMinElapsed(true);
      return;
    }
    const remaining = Math.max(0, 750 - (Date.now() - mountTimeRef.current));
    const timer = window.setTimeout(() => setMinElapsed(true), remaining);
    const safetyTimer = window.setTimeout(() => {
      setWorldReady(true);
      setMinElapsed(true);
    }, 1800);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(safetyTimer);
    };
  }, [reducedMotion]);

  const isFadingOut = worldReady && minElapsed;

  useEffect(() => {
    if (!isFadingOut) return;
    const unmountTimer = window.setTimeout(
      () => setShowOverlay(false),
      reducedMotion ? 50 : 520,
    );
    return () => window.clearTimeout(unmountTimer);
  }, [isFadingOut, reducedMotion]);

  return (
    <AppShell
      currentRoute="dashboard"
      pageTitle="AI Playground"
      breadcrumb="Universe"
      onNavigate={onNavigate}
      fullBleed
      hideTopBar
    >
      <Suspense
        fallback={
          <AppLoadingScreen
            stage="Awakening T.U.T AI Nova & sanctuary..."
            progress={68}
          />
        }
      >
        <PlaygroundExperience
          onNavigate={onNavigate}
          onWorldReady={() => setWorldReady(true)}
          onEnterNewCouncil={(mode) => {
            if (onEnterNewCouncil) {
              onEnterNewCouncil(mode);
            } else {
              onNavigate('new-council');
            }
          }}
        />
      </Suspense>

      {showOverlay && (
        <AppLoadingScreen
          overlay
          exiting={isFadingOut}
          stage={isFadingOut ? 'Sanctuary ready' : 'Awakening T.U.T AI Nova & sanctuary...'}
          progress={isFadingOut ? 100 : worldReady ? 92 : 76}
        />
      )}
    </AppShell>
  );
}
