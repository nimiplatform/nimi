import type { CustomSectorRecord, SectorTag } from '@renderer/data/types.js';

export type PrimarySectorGroupId = string | 'custom';

export type SecondaryOfficialSectorItem = {
  sectorId: string;
  displayLabel: string;
  description?: string;
  displayedCount?: number;
};

export function getOfficialRootSectors(sectors: SectorTag[]): SectorTag[] {
  return sectors.filter((sector) => !sector.parentSlug);
}

export function buildSecondaryOfficialSectorItems(
  rootSlug: string,
  sectors: SectorTag[],
): SecondaryOfficialSectorItem[] {
  const root = sectors.find((sector) => sector.slug === rootSlug && !sector.parentSlug);
  if (!root) {
    return [];
  }

  const children = sectors.filter((sector) => sector.parentSlug === rootSlug);

  return [
    {
      sectorId: root.slug,
      displayLabel: `All ${root.label}`,
      description: root.description,
      displayedCount: root.displayedCount,
    },
    ...children.map((sector) => ({
      sectorId: sector.slug,
      displayLabel: sector.label,
      description: sector.description,
      displayedCount: sector.displayedCount,
    })),
  ];
}

export function resolvePrimarySectorGroupId(input: {
  preferredSectorId: string | null;
  officialSectors: SectorTag[];
  customSectors: Record<string, CustomSectorRecord>;
}): PrimarySectorGroupId | null {
  const { preferredSectorId, officialSectors, customSectors } = input;

  if (preferredSectorId) {
    if (customSectors[preferredSectorId]) {
      return 'custom';
    }

    const officialSector = officialSectors.find((sector) => sector.slug === preferredSectorId);
    if (officialSector) {
      return officialSector.parentSlug ?? officialSector.slug;
    }
  }

  const firstOfficialRoot = getOfficialRootSectors(officialSectors)[0];
  if (firstOfficialRoot) {
    return firstOfficialRoot.slug;
  }

  if (Object.keys(customSectors).length > 0) {
    return 'custom';
  }

  return null;
}
