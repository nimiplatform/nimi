import type { AvatarSurfacePhase } from './types.js';

export type AvatarPhaseLabels = Record<AvatarSurfacePhase, string>;

export type AvatarPhaseLabelOverrides = Partial<AvatarPhaseLabels>;

export const DEFAULT_AVATAR_PHASE_LABELS: AvatarPhaseLabels = {
  idle: 'Idle',
  thinking: 'Thinking',
  listening: 'Listening',
  speaking: 'Speaking',
  transitioning: 'Transitioning',
};

/**
 * Resolve the display label for an avatar phase. Domain resolvers return the
 * phase id only; UI layers map it to text through this helper so consumers
 * can inject a localized label map (defaults keep the English copy).
 */
export function resolveAvatarPhaseLabel(
  phase: AvatarSurfacePhase,
  labels?: AvatarPhaseLabelOverrides | null,
): string {
  return labels?.[phase]
    ?? DEFAULT_AVATAR_PHASE_LABELS[phase]
    ?? DEFAULT_AVATAR_PHASE_LABELS.idle;
}
