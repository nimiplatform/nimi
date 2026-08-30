/**
 * `@nimiplatform/kit/ui/motion`
 *
 * The admitted animation substrate for governed surfaces
 * (P-DESIGN-027 / nimi-ui-motion-contract.md §7):
 *
 * - `motion` / `AnimatePresence` are re-exported from the `motion`
 *   package so apps never adopt a parallel animation library.
 * - Spring presets + overlay grammar encode the spec motion vocabulary.
 * - Gesture helpers own velocity handoff and momentum projection math.
 * - `NimiMotionProvider` wires OS reduced-motion into the substrate.
 *
 * Components must depend on this module rather than hand-rolling
 * matchMedia subscriptions, hardcoded ms durations, or rAF loops.
 */
export {
  NIMI_MOTION_DURATIONS_MS,
  NIMI_MOTION_EASINGS,
  resolveMotionDurationMs,
} from './timing.js';
export type {
  NimiMotionDurationKey,
  NimiMotionEasingKey,
} from './timing.js';
export { usePrefersReducedMotion } from './use-prefers-reduced-motion.js';
export {
  NIMI_SPRING_DEFAULT,
  NIMI_SPRING_MOMENTUM,
  NIMI_PRESSED_SCALE,
  nimiSpring,
  nimiReducedFade,
} from './springs.js';
export type { NimiSpringPreset } from './springs.js';
export {
  nimiOverlayPanelMotion,
  nimiOverlayBackdropMotion,
} from './overlay.js';
export type {
  NimiOverlayMotionKind,
  NimiPopoverSide,
  NimiOverlayMotionProps,
} from './overlay.js';
export {
  projectMomentum,
  nearestSnapTarget,
  normalizeReleaseVelocity,
  shouldCommitGesture,
} from './gestures.js';
import { useContext } from 'react';
import { MotionConfigContext } from 'motion/react';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion.js';

/**
 * Reduced-motion resolution that works with or without
 * `NimiMotionProvider`: prefers the MotionConfig context (which may be
 * app-forced), while an OS reduce request always remains authoritative.
 */
// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-027e
export function useNimiReducedMotion(): boolean {
  const { reducedMotion } = useContext(MotionConfigContext);
  const fromMedia = usePrefersReducedMotion();
  return reducedMotion === 'always' || fromMedia;
}

export { NimiMotionProvider } from './provider.js';

// Admitted substrate re-exports (motion contract §7). Governed surfaces
// animate through these, never through a second animation library.
export { animate, motion, AnimatePresence, useReducedMotion } from 'motion/react';
