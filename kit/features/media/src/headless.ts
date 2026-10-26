import { parseRealmMediaDelivery } from '@nimiplatform/kit/core/sdk-contract';
import type { MediaDeliveryDto, MediaImageSetDto } from '@nimiplatform/kit/core/sdk-contract';

export type MediaImagePurpose = MediaImageSetDto['purpose'];
export function readMediaDelivery(value: unknown): MediaDeliveryDto | null {
  if (value == null) return null;
  try { return parseRealmMediaDelivery(value); } catch { return null; }
}
export type ImageSourceSelection = {
  readonly sources: readonly { type: string; srcSet: string }[];
  readonly src: string;
  readonly srcSet: string;
  readonly width: number;
  readonly height: number;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.media-delivery
export function selectMediaImage(delivery: MediaDeliveryDto | null | undefined, purpose: MediaImagePurpose, maxPixelWidth = purpose === 'card' ? 640 : Infinity): ImageSourceSelection | null {
  const set = delivery?.images.find((candidate) => candidate.purpose === purpose);
  if (!set?.families.length) return null;
  const families = set.families.map((family) => {
    const candidates = family.sources.filter((source) => source.url && Number.isInteger(source.width) && source.width > 0 && Number.isInteger(source.height) && source.height > 0).sort((a, b) => a.width - b.width);
    const selected = candidates.filter((source) => source.width <= maxPixelWidth);
    return { type: family.mimeType, candidates: selected.length ? selected : candidates.slice(0, 1) };
  }).filter((family) => family.candidates.length);
  if (!families.length) return null;
  const fallback = families[families.length - 1];
  const srcSet = (family: typeof fallback) => family.candidates.map((source) => `${source.url} ${source.width}w`).join(', ');
  const initial = fallback.candidates[0];
  return { sources: families.slice(0, -1).map((family) => ({ type: family.type, srcSet: srcSet(family) })), src: initial.url, srcSet: srcSet(fallback), width: initial.width, height: initial.height };
}

export function mediaDeliveryKey(delivery: MediaDeliveryDto | null | undefined): string {
  return delivery ? `${delivery.resourceId}:${delivery.contentVersion}:${delivery.publicationGeneration}:${delivery.expiresAt ?? ''}` : '';
}
