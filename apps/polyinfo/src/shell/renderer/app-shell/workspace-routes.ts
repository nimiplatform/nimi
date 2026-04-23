import type { CustomSectorRecord, SectorTag } from '@renderer/data/types.js';

export function buildSectorPath(sectorId: string): string {
  return `/sectors/${encodeURIComponent(sectorId)}`;
}

export function resolveInitialSectorPath(input: {
  lastActiveSectorId: string | null;
  officialSectors: SectorTag[];
  customSectors: Record<string, CustomSectorRecord>;
}): string | null {
  const { lastActiveSectorId, officialSectors, customSectors } = input;
  if (lastActiveSectorId) {
    const hasCustomSector = Boolean(customSectors[lastActiveSectorId]);
    const hasOfficialSector = officialSectors.some((sector) => sector.slug === lastActiveSectorId);
    if (hasCustomSector || hasOfficialSector) {
      return buildSectorPath(lastActiveSectorId);
    }
  }

  const firstOfficialSector = officialSectors[0];
  if (firstOfficialSector) {
    return buildSectorPath(firstOfficialSector.slug);
  }

  const firstCustomSector = Object.values(customSectors).sort((left, right) => left.createdAt - right.createdAt)[0];
  if (firstCustomSector) {
    return buildSectorPath(firstCustomSector.id);
  }

  return null;
}
