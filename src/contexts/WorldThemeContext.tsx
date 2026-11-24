import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type WorldTimeOfDay = 'day' | 'night';
export type RenderQualityTier = 'high' | 'balanced' | 'lite';

interface WorldThemeContextValue {
  timeOfDay: WorldTimeOfDay;
  isDay: boolean;
  isNight: boolean;
  setTimeOfDay: (mode: WorldTimeOfDay) => void;
  toggleTimeOfDay: () => void;
  qualityTier: RenderQualityTier;
  setQualityTier: (tier: RenderQualityTier) => void;
  reducedMotion: boolean;
  isMobileViewport: boolean;
  webglSupported: boolean;
}

const STORAGE_KEY_TIME = 'tut_world_time_of_day';
const STORAGE_KEY_QUALITY = 'tut_world_quality_tier';

const WorldThemeContext = createContext<WorldThemeContextValue | null>(null);

function detectWebGLSupport(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')),
    );
  } catch {
    return false;
  }
}

export function WorldThemeProvider({ children }: { children: React.ReactNode }) {
  const [timeOfDay, setTimeOfDayState] = useState<WorldTimeOfDay>(() => {
    if (typeof window === 'undefined') return 'night';
    const saved = window.localStorage.getItem(STORAGE_KEY_TIME);
    return saved === 'day' || saved === 'night' ? saved : 'night';
  });

  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  const [qualityTier, setQualityTierState] = useState<RenderQualityTier>(() => {
    if (typeof window === 'undefined') return 'high';
    const saved = window.localStorage.getItem(STORAGE_KEY_QUALITY);
    if (saved === 'high' || saved === 'balanced' || saved === 'lite') return saved;
    return window.innerWidth < 768 ? 'balanced' : 'high';
  });

  const [webglSupported] = useState<boolean>(() => detectWebGLSupport());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const setTimeOfDay = useCallback((mode: WorldTimeOfDay) => {
    setTimeOfDayState(mode);
    try {
      window.localStorage.setItem(STORAGE_KEY_TIME, mode);
    } catch {
      // ignore storage errors
    }
  }, []);

  const toggleTimeOfDay = useCallback(() => {
    setTimeOfDayState((prev) => {
      const next: WorldTimeOfDay = prev === 'day' ? 'night' : 'day';
      try {
        window.localStorage.setItem(STORAGE_KEY_TIME, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const setQualityTier = useCallback((tier: RenderQualityTier) => {
    setQualityTierState(tier);
    try {
      window.localStorage.setItem(STORAGE_KEY_QUALITY, tier);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<WorldThemeContextValue>(
    () => ({
      timeOfDay,
      isDay: timeOfDay === 'day',
      isNight: timeOfDay === 'night',
      setTimeOfDay,
      toggleTimeOfDay,
      qualityTier,
      setQualityTier,
      reducedMotion,
      isMobileViewport,
      webglSupported,
    }),
    [
      timeOfDay,
      setTimeOfDay,
      toggleTimeOfDay,
      qualityTier,
      setQualityTier,
      reducedMotion,
      isMobileViewport,
      webglSupported,
    ],
  );

  return <WorldThemeContext.Provider value={value}>{children}</WorldThemeContext.Provider>;
}

export function useWorldTheme(): WorldThemeContextValue {
  const ctx = useContext(WorldThemeContext);
  if (!ctx) {
    throw new Error('useWorldTheme must be used inside WorldThemeProvider');
  }
  return ctx;
}
