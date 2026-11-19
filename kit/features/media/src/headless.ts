import { parseRealmMediaDelivery } from '@nimiplatform/kit/core/sdk-contract';
import type { MediaDeliveryDto, MediaImageFamilyDto, MediaImageSetDto } from '@nimiplatform/kit/core/sdk-contract';

export type MediaImagePurpose = MediaImageSetDto['purpose'];
export function readMediaDelivery(value: unknown): MediaDeliveryDto | null {
  if (value == null) return null;
  try { return parseRealmMediaDelivery(value); } catch { return null; }
}
export type ImageSourceSelection = {
  readonly sources: readonly { type: string; srcSet: string }[];
  readonly boundedSource?: { type: string; srcSet: string; maxWidth: number };
  readonly src: string;
  readonly srcSet: string;
  readonly width: number;
  readonly height: number;
};

function selectFamily(family: MediaImageFamilyDto, maxPixelWidth: number) {
  const valid = family.sources.filter(source => source.url && Number.isInteger(source.width) && source.width > 0
    && Number.isInteger(source.height) && source.height > 0).sort((a, b) => a.width - b.width);
  const capped = valid.filter(source => source.width <= maxPixelWidth);
  const candidates = capped.length ? capped : valid.slice(0, 1);
  if (!candidates.length) return null;
  return {
    type: family.mimeType,
    srcSet: candidates.map(source => `${source.url} ${source.width}w`).join(', '),
    first: candidates[0]!,
    maxWidth: candidates[candidates.length - 1]!.width,
  };
}

// @nimi-authority: rule.nimi.platform.ui-design-system.media-delivery
export function selectMediaImage(delivery: MediaDeliveryDto | null | undefined, purpose: MediaImagePurpose, maxPixelWidth = purpose === 'card' ? 640 : Infinity): ImageSourceSelection | null {
  const set = delivery?.images.find((candidate) => candidate.purpose === purpose);
  if (!set?.families.length) return null;
  const families = set.families.map(family => selectFamily(family, maxPixelWidth)).filter(family => family !== null);
  if (!families.length) return null;
  const fallback = families[families.length - 1]!;
  const bounded = set.boundedFamily && selectFamily(set.boundedFamily, maxPixelWidth);
  return {
    sources: families.slice(0, -1).map(({ type, srcSet }) => ({ type, srcSet })),
    ...(bounded ? { boundedSource: { type: bounded.type, srcSet: bounded.srcSet, maxWidth: bounded.maxWidth } } : {}),
    src: fallback.first.url, srcSet: fallback.srcSet, width: fallback.first.width, height: fallback.first.height,
  };
}

export function mediaDeliveryKey(delivery: MediaDeliveryDto | null | undefined): string {
  return delivery ? `${delivery.resourceId}:${delivery.contentVersion}:${delivery.publicationGeneration}:${delivery.expiresAt ?? ''}` : '';
}
