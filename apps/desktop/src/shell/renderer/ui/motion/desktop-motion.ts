import {
  NIMI_MOTION_DURATIONS_MS,
  usePrefersReducedMotion,
} from '@nimiplatform/kit/ui/motion';
import type { TargetAndTransition, Transition, Variants } from 'motion/react';

const EASE_STANDARD = [0.2, 0, 0, 1] as const;
const EASE_EMPHASIZED = [0.05, 0.7, 0.1, 1] as const;

function durationSeconds(durationMs: number, reduced: boolean): number {
  if (reduced) return 0;
  return durationMs / 1000;
}

function timedTransition(
  durationMs: number,
  reduced: boolean,
  ease: readonly [number, number, number, number] = EASE_STANDARD,
): Transition {
  return {
    duration: durationSeconds(durationMs, reduced),
    ease,
  };
}

export function useDesktopReducedMotion(): boolean {
  return usePrefersReducedMotion();
}

export function useDesktopInteractiveMotion(): {
  whileHover?: TargetAndTransition;
  whileTap?: TargetAndTransition;
  transition: Transition;
} {
  const reduced = useDesktopReducedMotion();
  return {
    whileHover: reduced ? undefined : { y: -1, scale: 1.025 },
    whileTap: reduced ? undefined : { y: 0, scale: 0.97 },
    transition: timedTransition(NIMI_MOTION_DURATIONS_MS.fast, reduced),
  };
}

export function useDesktopCardMotion(): {
  whileHover?: TargetAndTransition;
  whileTap?: TargetAndTransition;
  transition: Transition;
} {
  const reduced = useDesktopReducedMotion();
  return {
    whileHover: reduced ? undefined : {
      y: -2,
      boxShadow: '0 16px 36px rgba(15, 23, 42, 0.08)',
    },
    whileTap: reduced ? undefined : { y: 0, scale: 0.995 },
    transition: timedTransition(NIMI_MOTION_DURATIONS_MS.fast, reduced),
  };
}

export function useDesktopPanelCustom(): boolean {
  return useDesktopReducedMotion();
}

export const DESKTOP_PANEL_VARIANTS: Variants = {
  initial: (reduced: boolean) => ({
    opacity: reduced ? 1 : 0,
    y: reduced ? 0 : 8,
    filter: reduced ? 'none' : 'blur(6px)',
  }),
  animate: (reduced: boolean) => ({
    opacity: 1,
    y: 0,
    filter: 'none',
    transition: timedTransition(NIMI_MOTION_DURATIONS_MS.base, reduced, EASE_EMPHASIZED),
  }),
  exit: (reduced: boolean) => ({
    opacity: reduced ? 1 : 0,
    y: reduced ? 0 : -6,
    filter: reduced ? 'none' : 'blur(4px)',
    transition: timedTransition(NIMI_MOTION_DURATIONS_MS.fast, reduced),
  }),
};

export const DESKTOP_MENU_VARIANTS: Variants = {
  initial: (reduced: boolean) => ({
    opacity: reduced ? 1 : 0,
    y: reduced ? 0 : -8,
    scale: reduced ? 1 : 0.98,
  }),
  animate: (reduced: boolean) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: timedTransition(NIMI_MOTION_DURATIONS_MS.base, reduced, EASE_EMPHASIZED),
  }),
  exit: (reduced: boolean) => ({
    opacity: reduced ? 1 : 0,
    y: reduced ? 0 : -6,
    scale: reduced ? 1 : 0.985,
    transition: timedTransition(NIMI_MOTION_DURATIONS_MS.fast, reduced),
  }),
};

export function desktopActiveIndicatorTransition(reduced: boolean): Transition {
  return timedTransition(NIMI_MOTION_DURATIONS_MS.base, reduced, EASE_EMPHASIZED);
}
