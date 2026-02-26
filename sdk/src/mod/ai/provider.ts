import type { RuntimeRouteHint, RuntimeModality } from '../types';

export function modalityFromRouteHint(routeHint: RuntimeRouteHint): RuntimeModality {
  const normalized = String(routeHint || 'chat/default').trim().toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('tts/')) return 'tts';
  if (normalized.startsWith('stt/')) return 'stt';
  if (normalized.startsWith('embedding/')) return 'embedding';
  return 'chat';
}
