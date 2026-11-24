import { useCallback, useEffect, useRef, useState } from 'react';
import { animate, useMotionValue, type MotionValue } from 'motion/react';

export const SWIPE_REPLY_THRESHOLD = 56;
const SWIPE_MAX_OVERSHOOT = 22;
const LONG_PRESS_VISUAL_DELAY_MS = 110;
const LONG_PRESS_TRIGGER_MS = 370;
const LONG_PRESS_MOVE_SLOP_PX = 8;

const EXCLUDED_GESTURE_SELECTOR =
  'button, a, input, textarea, select, [role="dialog"], pre, table, [data-no-swipe="true"]';

export interface UseMessageGesturesResult {
  dragX: MotionValue<number>;
  isSwiping: boolean;
  isHolding: boolean;
  thresholdReached: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
}

export function useSwipeToReply({
  swipeEnabled,
  longPressEnabled = false,
  doubleTapEnabled = false,
  reducedMotion,
  threshold = SWIPE_REPLY_THRESHOLD,
  onSwipeReply,
  onLongPress,
  onDoubleTap,
}: {
  swipeEnabled: boolean;
  longPressEnabled?: boolean;
  doubleTapEnabled?: boolean;
  reducedMotion: boolean;
  threshold?: number;
  onSwipeReply: () => void;
  onLongPress?: () => void;
  onDoubleTap?: (clientX: number, clientY: number) => void;
}): UseMessageGesturesResult {
  const dragX = useMotionValue(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [thresholdReached, setThresholdReached] = useState(false);

  const onSwipeReplyRef = useRef(onSwipeReply);
  onSwipeReplyRef.current = onSwipeReply;

  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  const onDoubleTapRef = useRef(onDoubleTap);
  onDoubleTapRef.current = onDoubleTap;

  const didSuppressClickRef = useRef(false);
  const lastLongPressAtRef = useRef(0);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const clickResetTimerRef = useRef<number | null>(null);

  const springBack = useCallback(() => {
    if (reducedMotion) {
      dragX.set(0);
      return;
    }
    animate(dragX, 0, {
      type: 'spring',
      stiffness: 540,
      damping: 34,
      mass: 0.72,
    });
  }, [dragX, reducedMotion]);

  useEffect(() => {
    if (!swipeEnabled && !longPressEnabled && cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
      setIsSwiping(false);
      setIsHolding(false);
      setThresholdReached(false);
      dragX.set(0);
    }
  }, [swipeEnabled, longPressEnabled, dragX]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (clickResetTimerRef.current !== null) {
        window.clearTimeout(clickResetTimerRef.current);
      }
    };
  }, []);

  const scheduleClickReset = useCallback((delayMs = 90) => {
    if (clickResetTimerRef.current !== null) {
      window.clearTimeout(clickResetTimerRef.current);
    }
    clickResetTimerRef.current = window.setTimeout(() => {
      didSuppressClickRef.current = false;
      clickResetTimerRef.current = null;
    }, delayMs);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!swipeEnabled && !longPressEnabled && !doubleTapEnabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.nativeEvent.isPrimary === false) return;

      const target = e.target as HTMLElement | null;
      if (target?.closest(EXCLUDED_GESTURE_SELECTOR)) {
        return;
      }

      cleanupRef.current?.();
      cleanupRef.current = null;

      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      let mode: 'pending' | 'swiping' | 'long_pressed' | 'ignored' = 'pending';
      let crossed = false;
      let holdVisualTimer: number | null = null;
      let holdTriggerTimer: number | null = null;

      const clearHoldTimers = () => {
        if (holdVisualTimer !== null) {
          window.clearTimeout(holdVisualTimer);
          holdVisualTimer = null;
        }
        if (holdTriggerTimer !== null) {
          window.clearTimeout(holdTriggerTimer);
          holdTriggerTimer = null;
        }
        setIsHolding(false);
      };

      const detach = () => {
        clearHoldTimers();
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleCancel);
        if (cleanupRef.current === detach) {
          cleanupRef.current = null;
        }
      };

      if (longPressEnabled && onLongPressRef.current) {
        holdVisualTimer = window.setTimeout(() => {
          if (mode === 'pending') {
            setIsHolding(true);
          }
        }, LONG_PRESS_VISUAL_DELAY_MS);

        holdTriggerTimer = window.setTimeout(() => {
          if (mode !== 'pending') return;
          mode = 'long_pressed';
          didSuppressClickRef.current = true;
          lastTapRef.current = null;
          lastLongPressAtRef.current = Date.now();
          clearHoldTimers();

          try {
            window.getSelection?.()?.removeAllRanges();
          } catch {
            // Ignore selection clear errors
          }

          try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
              navigator.vibrate(14);
            }
          } catch {
            // Ignore unsupported vibration APIs
          }

          detach();
          scheduleClickReset(1200);
          onLongPressRef.current?.();
        }, LONG_PRESS_TRIGGER_MS);
      }

      const handleMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId || mode === 'ignored' || mode === 'long_pressed') return;

        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_SLOP_PX) {
          clearHoldTimers();
        }

        if (mode === 'pending') {
          if (!swipeEnabled) {
            if (Math.hypot(dx, dy) > 10) {
              mode = 'ignored';
              detach();
            }
            return;
          }
          if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx) * 0.9) {
            mode = 'ignored';
            detach();
            return;
          }
          if (dx < -10) {
            mode = 'ignored';
            detach();
            return;
          }
          if (dx > 10 && dx > Math.abs(dy) * 1.25) {
            mode = 'swiping';
            didSuppressClickRef.current = true;
            lastTapRef.current = null;
            clearHoldTimers();
            setIsSwiping(true);
            try {
              window.getSelection?.()?.removeAllRanges();
            } catch {
              // Ignore selection clear failures
            }
          } else {
            return;
          }
        }

        if (ev.cancelable) {
          ev.preventDefault();
        }

        const rawRight = Math.max(0, dx);
        const dampedX =
          rawRight <= threshold
            ? rawRight
            : threshold + Math.min(SWIPE_MAX_OVERSHOOT, (rawRight - threshold) * 0.32);

        dragX.set(dampedX);

        const nextCrossed = rawRight >= threshold;
        if (nextCrossed !== crossed) {
          crossed = nextCrossed;
          setThresholdReached(nextCrossed);
          if (nextCrossed) {
            try {
              if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate(10);
              }
            } catch {
              // Ignore unsupported vibration APIs
            }
          }
        }
      };

      const finish = (cancelled: boolean, ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        detach();

        if (mode === 'long_pressed') {
          scheduleClickReset(90);
          return;
        }

        if (mode === 'pending') {
          if (!cancelled && doubleTapEnabled && onDoubleTapRef.current) {
            const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
            const selectedText = window.getSelection?.()?.toString().trim() || '';
            if (moved <= LONG_PRESS_MOVE_SLOP_PX && !selectedText) {
              const now = Date.now();
              const prev = lastTapRef.current;
              if (
                prev &&
                now - prev.at <= 280 &&
                Math.hypot(ev.clientX - prev.x, ev.clientY - prev.y) <= 28
              ) {
                lastTapRef.current = null;
                didSuppressClickRef.current = true;
                scheduleClickReset(140);
                try {
                  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                    navigator.vibrate(10);
                  }
                } catch {
                  // Ignore unsupported vibration APIs
                }
                onDoubleTapRef.current(ev.clientX, ev.clientY);
                return;
              }
              lastTapRef.current = { at: now, x: ev.clientX, y: ev.clientY };
            } else {
              lastTapRef.current = null;
            }
          }
          return;
        }

        if (mode !== 'swiping') return;

        const shouldTrigger = !cancelled && crossed;
        setIsSwiping(false);
        setThresholdReached(false);
        springBack();

        if (shouldTrigger) {
          onSwipeReplyRef.current();
        }

        scheduleClickReset(90);
      };

      const handleUp = (ev: PointerEvent) => finish(false, ev);
      const handleCancel = (ev: PointerEvent) => finish(true, ev);

      window.addEventListener('pointermove', handleMove, { passive: false });
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleCancel);
      cleanupRef.current = detach;
    },
    [swipeEnabled, longPressEnabled, doubleTapEnabled, dragX, springBack, threshold, scheduleClickReset],
  );

  const onClickCapture = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!didSuppressClickRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    didSuppressClickRef.current = false;
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (Date.now() - lastLongPressAtRef.current < 1000 || didSuppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    dragX,
    isSwiping,
    isHolding,
    thresholdReached,
    onPointerDown,
    onClickCapture,
    onContextMenu,
  };
}
