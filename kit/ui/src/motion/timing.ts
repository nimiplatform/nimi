/**
 * Motion timing primitive (wave-b fork F1 lift-the-bar).
 *
 * Centralizes timing curves + duration tokens consumed by kit
 * components. Mirrors the CSS-variable tokens emitted by the
 * generated token chain (`--nimi-motion-fast` etc.) so headless
 * code (transition controllers, choreography orchestrators) can
 * reference the same source without re-reading `getComputedStyle`.
 *
 * The CSS variables are the canonical render-time source; this
 * TypeScript surface is a logical mirror keyed for prefers-reduced-
 * motion downgrade decisions.
 */

export const NIMI_MOTION_DURATIONS_MS = {
  instant: 0,
  fast: 120,
  base: 200,
  slow: 320,
  ambient: 600,
} as const;

export type NimiMotionDurationKey = keyof typeof NIMI_MOTION_DURATIONS_MS;

export const NIMI_MOTION_EASINGS = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  decelerated: 'cubic-bezier(0, 0, 0, 1)',
  accelerated: 'cubic-bezier(0.3, 0, 1, 1)',
} as const;

export type NimiMotionEasingKey = keyof typeof NIMI_MOTION_EASINGS;

/**
 * Resolve the runtime motion duration in milliseconds under a
 * prefers-reduced-motion preference. Returns 0 when motion is
 * reduced (per WCAG SC 2.3.3 Animation from Interactions opt-out).
 */
export function resolveMotionDurationMs(
  key: NimiMotionDurationKey,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) return 0;
  return NIMI_MOTION_DURATIONS_MS[key];
}
