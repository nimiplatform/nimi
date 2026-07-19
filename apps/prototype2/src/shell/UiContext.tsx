import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Phase = 'day' | 'dusk' | 'night' | 'dawn';
export type PhaseSetting = Phase | 'auto';

const PHASE_ORDER: PhaseSetting[] = ['auto', 'day', 'dusk', 'night', 'dawn'];

export const PHASE_LABEL: Record<PhaseSetting, string> = {
  auto: '自动 · Auto',
  day: '昼 · Day',
  dusk: '暮 · Dusk',
  night: '夜 · Night',
  dawn: '晨 · Dawn',
};

/** Time-of-day driven phase for the Auto atmosphere mode. */
export function autoPhase(now = new Date()): Phase {
  const h = now.getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

interface UiState {
  awake: boolean;
  enter: () => void;
  lensOpen: boolean;
  setLensOpen: (v: boolean) => void;
  phase: PhaseSetting;
  effectivePhase: Phase;
  cyclePhase: () => void;
  tide: boolean;
  toggleTide: () => void;
}

const UiContext = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [awake, setAwake] = useState(false);
  const [lensOpen, setLensOpen] = useState(false);
  const [phase, setPhase] = useState<PhaseSetting>('auto');
  const [tide, setTide] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (phase !== 'auto') return;
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [phase]);

  const value = useMemo<UiState>(() => {
    void tick;
    return {
      awake,
      enter: () => setAwake(true),
      lensOpen,
      setLensOpen,
      phase,
      effectivePhase: phase === 'auto' ? autoPhase() : phase,
      cyclePhase: () =>
        setPhase((p) => PHASE_ORDER[(PHASE_ORDER.indexOf(p) + 1) % PHASE_ORDER.length]),
      tide,
      toggleTide: () => setTide((t) => !t),
    };
  }, [awake, lensOpen, phase, tide, tick]);

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}
