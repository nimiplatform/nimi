import { formatNum, personaCount, sourceCount, worldCharacterCount } from './world-detail-template-model.js';
import type { WorldComputedTime } from './world-list-model.js';

const ISO_DATE_TIME_LABEL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function formatAuthoredWorldTimeLabel(
  value: string,
  formatDateTime: (value: unknown) => string,
): string {
  const label = value.trim();
  if (ISO_DATE_TIME_LABEL.test(label) && !Number.isNaN(new Date(label).getTime())) {
    return formatDateTime(label);
  }
  return value;
}

/**
 * Human-readable world time. A static world shows only its authored label (or nothing); a
 * wall-clock world formats its current world time instead of leaking an ISO string.
 */
export function worldTimeDisplay(
  time: WorldComputedTime,
  formatDateTime: (value: unknown) => string,
): string | null {
  if (time.mode === 'static') {
    return time.label;
  }
  return formatAuthoredWorldTimeLabel(time.currentLabel, formatDateTime);
}

export { formatNum, personaCount, sourceCount, worldCharacterCount };
