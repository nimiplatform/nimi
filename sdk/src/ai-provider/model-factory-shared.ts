import {
  asRecord,
  normalizeText,
} from './helpers.js';

export function withOptionalHeadSubjectUserId<T extends { head: Record<string, unknown> }>(
  request: T,
  subjectUserId: string | undefined,
): T {
  const normalized = normalizeText(subjectUserId);
  if (!normalized) {
    return request;
  }
  return {
    ...request,
    head: {
      ...request.head,
      subjectUserId: normalized,
    },
  };
}

export function flattenImageProviderOptions(value: unknown): Record<string, unknown> {
  const topLevel = asRecord(value);
  const flattened: Record<string, unknown> = {};

  const applyLayer = (layer: Record<string, unknown>): void => {
    for (const [key, item] of Object.entries(layer)) {
      const normalizedKey = normalizeText(key);
      if (
        !normalizedKey
        || normalizedKey === 'nimi'
        || normalizedKey === 'llama'
        || normalizedKey === 'media'
        || normalizedKey === 'mediadiffusers'
        || normalizedKey === 'media_diffusers'
        || normalizedKey === 'sidecar'
        || normalizedKey === 'extra'
      ) {
        continue;
      }
      flattened[normalizedKey] = item;
    }
  };

  applyLayer(asRecord(topLevel.llama));
  applyLayer(asRecord(topLevel.media));
  applyLayer(asRecord(topLevel.mediaDiffusers));
  applyLayer(asRecord(topLevel.media_diffusers));
  applyLayer(asRecord(topLevel.sidecar));
  applyLayer(asRecord(topLevel.extra));
  applyLayer(asRecord(topLevel.nimi));
  applyLayer(topLevel);
  return flattened;
}

export function toVideoModeValue(
  value: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference',
): number {
  switch (value) {
    case 't2v':
      return 1;
    case 'i2v-first-frame':
      return 2;
    case 'i2v-first-last':
      return 3;
    case 'i2v-reference':
      return 4;
    default:
      return 0;
  }
}

export function toVideoRoleValue(
  value: 'prompt' | 'first_frame' | 'last_frame' | 'reference_image',
): number {
  switch (value) {
    case 'prompt':
      return 1;
    case 'first_frame':
      return 2;
    case 'last_frame':
      return 3;
    case 'reference_image':
      return 4;
    default:
      return 0;
  }
}
