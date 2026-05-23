/**
 * `@nimiplatform/nimi-kit/ui/motion`
 *
 * Motion timing primitives + prefers-reduced-motion hook (wave-b
 * fork F1 lift-the-bar).
 *
 * Components must depend on this module rather than hand-rolling
 * matchMedia subscriptions or hardcoded ms durations.
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
