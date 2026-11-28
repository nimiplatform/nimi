import {
  NIMI_MOTION_DURATIONS_MS,
  nimiReducedFade,
  nimiSpring,
  usePrefersReducedMotion,
} from '@nimiplatform/kit/ui/motion';
import {
  useDesktopAppReducedMotionPreference,
} from './desktop-motion-context.js';

export {
  DesktopMotionProvider,
  useSetDesktopAppReducedMotionPreference,
} from './desktop-motion-context.js';
import type { TargetAndTransition, Transition, Variants } from 'motion/react';

const EASE_STANDARD = [0.2, 0, 0, 1] as const;

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
  const osReducedMotion = usePrefersReducedMotion();
  const appReducedMotion = useDesktopAppReducedMotionPreference();
  return osReducedMotion || appReducedMotion;
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
    whileHover: reduced ? undefined : { y: -2 },
    whileTap: reduced ? undefined : { y: 0, scale: 0.995 },
    transition: reduced ? nimiReducedFade() : nimiSpring('default'),
  };
}

export function useDesktopPanelCustom(): boolean {
  return useDesktopReducedMotion();
}

export const DESKTOP_PANEL_VARIANTS: Variants = {
  initial: (reduced: boolean) => ({
    opacity: 0,
    y: reduced ? 0 : 8,
  }),
  animate: (reduced: boolean) => ({
    opacity: 1,
    y: 0,
    transition: reduced ? nimiReducedFade() : nimiSpring('default'),
  }),
  exit: (reduced: boolean) => ({
    opacity: 0,
    y: reduced ? 0 : 8,
    // Overlay the container beneath the active panel and disable pointer
    // events so an exiting panel never splits height or ghosts above an
    // already-visible panel (e.g. the keep-alive runtime tab).
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
    transition: {
      ...(reduced ? nimiReducedFade() : nimiSpring('default')),
      zIndex: { duration: 0 },
    },
  }),
};

export const DESKTOP_MENU_VARIANTS: Variants = {
  initial: (reduced: boolean) => ({
    opacity: 0,
    y: reduced ? 0 : 8,
    scale: reduced ? 1 : 0.96,
  }),
  animate: (reduced: boolean) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: reduced ? nimiReducedFade() : nimiSpring('default'),
  }),
  exit: (reduced: boolean) => ({
    opacity: 0,
    y: reduced ? 0 : 8,
    scale: reduced ? 1 : 0.96,
    transition: reduced ? nimiReducedFade() : nimiSpring('default'),
  }),
};

export function desktopActiveIndicatorTransition(reduced: boolean): Transition {
  return reduced ? nimiReducedFade() : nimiSpring('default');
}
