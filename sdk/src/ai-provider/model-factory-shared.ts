import {
  asRecord,
  normalizeText,
} from './helpers.js';

export function assertNoLegacyLocalModelPrefix(modelId: string): void {
  const normalized = normalizeText(modelId);
  const prefix = normalized.includes('/') ? normalized.split('/', 1)[0] || '' : normalized;
  const lowered = prefix.toLowerCase();
  if (
    lowered === 'localai'
    || lowered === 'nexa'
    || lowered === 'nimi_media'
    || lowered === 'media.diffusers'
    || lowered === 'localsidecar'
  ) {
    throw new Error(
      `legacy local model prefix "${prefix}" is no longer supported. Use local/, llama/, media/, speech/, or sidecar/.`,
    );
  }
}

export function withOptionalHeadSubjectUserId<T extends { head: { subjectUserId: string } }>(
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
