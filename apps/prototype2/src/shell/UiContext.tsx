import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  dayTimeFromDate,
  phaseFromDayTime,
  PHASE_PRESET_TIME,
  type Phase,
} from './sky/skyMath';

export type { Phase } from './sky/skyMath';
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
  return phaseFromDayTime(dayTimeFromDate(now));
}

interface UiState {
  awake: boolean;
  enter: () => void;
  lensOpen: boolean;
  setLensOpen: (v: boolean) => void;
  phase: PhaseSetting;
  effectivePhase: Phase;
  cyclePhase: () => void;
  /** Continuous time of day, [0,1); drives the living-sky background. */
  dayTime: number;
  /** true while the background follows the local clock. */
  autoTime: boolean;
  /** Pin the background to a specific time (leaves auto mode). */
  setDayTime: (t: number) => void;
  /** Resume following the local clock. */
  setAutoTime: () => void;
  /** Light strength for the sky shader, ~[0,2]. */
  intensity: number;
  setIntensity: (v: number) => void;
  /** Animation amplitude for the sky shader, [0,1]. */
  motion: number;
  setMotion: (v: number) => void;
  tide: boolean;
  toggleTide: () => void;
}

const UiContext = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [awake, setAwake] = useState(false);
  const [lensOpen, setLensOpen] = useState(false);
  const [autoTime, setAutoTimeState] = useState(true);
  const [dayTime, setDayTimeState] = useState(() => dayTimeFromDate());
  const [intensity, setIntensity] = useState(1);
  const [motion, setMotion] = useState(1);
  const [tide, setTide] = useState(false);

  useEffect(() => {
    if (!autoTime) return;
    setDayTimeState(dayTimeFromDate());
    const t = window.setInterval(() => setDayTimeState(dayTimeFromDate()), 15_000);
    return () => window.clearInterval(t);
  }, [autoTime]);

  const value = useMemo<UiState>(() => {
    const effectivePhase = phaseFromDayTime(dayTime);
    return {
      awake,
      enter: () => setAwake(true),
      lensOpen,
      setLensOpen,
      phase: autoTime ? 'auto' : effectivePhase,
      effectivePhase,
      cyclePhase: () => {
        const current: PhaseSetting = autoTime ? 'auto' : effectivePhase;
        const next = PHASE_ORDER[(PHASE_ORDER.indexOf(current) + 1) % PHASE_ORDER.length];
        if (next === 'auto') {
          setAutoTimeState(true);
        } else {
          setAutoTimeState(false);
          setDayTimeState(PHASE_PRESET_TIME[next]);
        }
      },
      dayTime,
      autoTime,
      setDayTime: (t: number) => {
        setAutoTimeState(false);
        setDayTimeState(((t % 1) + 1) % 1);
      },
      setAutoTime: () => setAutoTimeState(true),
      intensity,
      setIntensity,
      motion,
      setMotion,
      tide,
      toggleTide: () => setTide((v) => !v),
    };
  }, [awake, lensOpen, autoTime, dayTime, intensity, motion, tide]);

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}
