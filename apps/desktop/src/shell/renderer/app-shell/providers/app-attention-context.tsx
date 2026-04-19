import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  createIdleAppAttentionState,
  resolveAppAttentionStateFromViewport,
  shouldUpdateAppAttentionState,
  type AppAttentionState,
} from './app-attention-state';

const ENTRY_BOOTSTRAP_PRESENCE = 0.12;
const PRESENCE_EASE_IN = 0.32;
const PRESENCE_EASE_OUT = 0.18;
const PRESENCE_SETTLE_EPSILON = 0.001;

const AppAttentionContext = createContext<AppAttentionState>(
  createIdleAppAttentionState(),
);

function easePresence(current: number, target: number): number {
  const rate = target > current ? PRESENCE_EASE_IN : PRESENCE_EASE_OUT;
  const next = current + ((target - current) * rate);
  return Math.abs(target - next) < PRESENCE_SETTLE_EPSILON ? target : next;
}

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function AppAttentionProvider({ children }: PropsWithChildren) {
  const [attention, setAttention] = useState(() => createIdleAppAttentionState());
  const attentionRef = useRef(attention);
  const targetPresenceRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    attentionRef.current = attention;
  }, [attention]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const commitAttention = (next: AppAttentionState) => {
      setAttention((current) => (
        shouldUpdateAppAttentionState(current, next) ? next : current
      ));
    };

    const schedulePresenceFrame = () => {
      if (frameRef.current !== null) {
        return;
      }

      const tick = () => {
        frameRef.current = null;
        const current = attentionRef.current;
        const targetPresence = targetPresenceRef.current;
        const nextPresence = easePresence(current.presence, targetPresence);
        const next = {
          ...current,
          presence: nextPresence,
          active: nextPresence > PRESENCE_SETTLE_EPSILON,
        };
        attentionRef.current = next;
        commitAttention(next);
        if (nextPresence !== targetPresence) {
          frameRef.current = window.requestAnimationFrame(tick);
        }
      };

      frameRef.current = window.requestAnimationFrame(tick);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const current = attentionRef.current;
      const bootstrapPresence = current.presence > 0
        ? current.presence
        : ENTRY_BOOTSTRAP_PRESENCE;
      const next = resolveAppAttentionStateFromViewport({
        clientX: event.clientX,
        clientY: event.clientY,
        viewport: getViewportSize(),
        presence: bootstrapPresence,
      });
      targetPresenceRef.current = 1;
      attentionRef.current = next;
      commitAttention(next);
      schedulePresenceFrame();
    };

    const clearAttention = () => {
      targetPresenceRef.current = 0;
      const current = attentionRef.current;
      const next = {
        ...current,
        normalizedX: 0,
        normalizedY: 0,
      };
      attentionRef.current = next;
      commitAttention(next);
      schedulePresenceFrame();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearAttention();
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('blur', clearAttention);
    document.documentElement.addEventListener('mouseleave', clearAttention);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('blur', clearAttention);
      document.documentElement.removeEventListener('mouseleave', clearAttention);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return (
    <AppAttentionContext.Provider value={attention}>
      {children}
    </AppAttentionContext.Provider>
  );
}

export function useAppAttention(): AppAttentionState {
  return useContext(AppAttentionContext);
}
