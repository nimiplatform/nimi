import type { ModelPickerBadgeTone } from '../types.js';

export function modelPickerBadgeTone(tone: ModelPickerBadgeTone | undefined) {
  if (tone === 'accent') return 'info' as const;
  if (tone === 'success') return 'success' as const;
  if (tone === 'warning') return 'warning' as const;
  return 'neutral' as const;
}
