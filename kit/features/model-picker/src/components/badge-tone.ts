import type { ModelPickerBadge } from '../types.js';

export function modelPickerBadgeTone(tone: ModelPickerBadge['tone']) {
  if (tone === 'accent') return 'info' as const;
  if (tone === 'success') return 'success' as const;
  if (tone === 'warning') return 'warning' as const;
  return 'neutral' as const;
}
