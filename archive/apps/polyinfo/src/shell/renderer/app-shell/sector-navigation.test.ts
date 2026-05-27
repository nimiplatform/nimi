import { describe, expect, it } from 'vitest';
import {
  buildSecondaryOfficialSectorItems,
  getOfficialRootSectors,
  resolvePrimarySectorGroupId,
} from './sector-navigation.js';

const sectors = [
  { id: 'politics', label: 'Politics', slug: 'politics' },
  { id: 'iran', label: 'Iran', slug: 'iran', parentSlug: 'politics', displayedCount: 12 },
  { id: 'elections', label: 'Elections', slug: 'elections', parentSlug: 'politics', displayedCount: 8 },
  { id: 'crypto', label: 'Crypto', slug: 'crypto' },
];

describe('sector navigation helpers', () => {
  it('returns only official root sectors for the top bar', () => {
    expect(getOfficialRootSectors(sectors).map((sector) => sector.slug)).toEqual(['politics', 'crypto']);
  });

  it('builds second-level sector items for the selected root without reordering the upstream list', () => {
    expect(buildSecondaryOfficialSectorItems('politics', sectors)).toEqual([
      {
        sectorId: 'politics',
        displayLabel: 'All Politics',
        description: undefined,
        displayedCount: undefined,
      },
      {
        sectorId: 'iran',
        displayLabel: 'Iran',
        description: undefined,
        displayedCount: 12,
      },
      {
        sectorId: 'elections',
        displayLabel: 'Elections',
        description: undefined,
        displayedCount: 8,
      },
    ]);
  });

  it('maps an official sector back to its top-level group', () => {
    expect(resolvePrimarySectorGroupId({
      preferredSectorId: 'iran',
      officialRootSectors: [
        { id: 'politics', label: 'Politics', slug: 'politics' },
        { id: 'crypto', label: 'Crypto', slug: 'crypto' },
      ],
      visibleSubsectors: [
        { id: 'iran', label: 'Iran', slug: 'iran', parentSlug: 'politics', displayedCount: 12 },
        { id: 'elections', label: 'Elections', slug: 'elections', parentSlug: 'politics', displayedCount: 8 },
      ],
      customSectors: {},
    })).toBe('politics');
  });

  it('maps a custom sector to the custom top-level group', () => {
    expect(resolvePrimarySectorGroupId({
      preferredSectorId: 'custom-1',
      officialRootSectors: [
        { id: 'politics', label: 'Politics', slug: 'politics' },
        { id: 'crypto', label: 'Crypto', slug: 'crypto' },
      ],
      visibleSubsectors: [],
      customSectors: {
        'custom-1': {
          id: 'custom-1',
          title: 'Desk',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })).toBe('custom');
  });
});
