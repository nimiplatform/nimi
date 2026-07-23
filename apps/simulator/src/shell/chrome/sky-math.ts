/** Continuous time-of-day model for the living-sky background. */

export type Phase = 'day' | 'dusk' | 'night' | 'dawn';

/** t ∈ [0, 1): 0 = 00:00 local, 0.5 = 12:00 local. */
export function dayTimeFromDate(now = new Date()): number {
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return seconds / 86_400;
}

/** Phase boundaries mirror the original autoPhase hour ranges. */
export function phaseFromDayTime(t: number): Phase {
  const h = t * 24;
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

/** Preset jump targets used by cyclePhase (◐). */
export const PHASE_PRESET_TIME: Record<Phase, number> = {
  dawn: 6.5 / 24,
  day: 12 / 24,
  dusk: 18.5 / 24,
  night: 23 / 24,
};

export function formatDayTime(t: number): string {
  const total = Math.floor(t * 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
