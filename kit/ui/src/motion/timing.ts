/**
 * Motion timing primitive (P-DESIGN-027 / nimi-ui-motion-contract.md §2).
 *
 * TS mirror of the spec-owned `motion.*` token values
 * (`--nimi-motion-fast` etc.). One scale serves CSS transitions and
 * TypeScript animation code; the CSS variables emitted by the generated
 * token chain are the canonical render-time source, and this module
 * must never diverge from them (divergence is design drift).
 */

// @nimi-authority: definition.nimi.platform.ui-design-system.motion-system
// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-027a
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
