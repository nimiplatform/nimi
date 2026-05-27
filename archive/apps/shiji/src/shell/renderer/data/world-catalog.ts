/**
 * world-catalog.ts — ShiJi world catalog (runtime representation of spec/kernel/tables/world-catalog.yaml)
 *
 * Authoritative whitelist for all worlds that may appear in ShiJi.
 * contentType + truthMode must match an allowed pair in content-classification.yaml.
 * Display metadata (name, tagline, description, bannerUrl) comes from Realm API.
 * This catalog provides eligibility gating, sortOrder, and classification overlay only.
 */

export type WorldContentType = 'history' | 'literature' | 'mythology';
export type WorldTruthMode = 'factual' | 'dramatized' | 'legendary';
export type WorldCatalogStatus = 'ACTIVE' | 'PLANNED' | 'RETIRED';

export type WorldCatalogEntry = {
  worldId: string;
  displayName: string;
  sortOrder: number;
  startYear: number;
  endYear: number;
  eraLabel: string;
  contentType: WorldContentType;
  truthMode: WorldTruthMode;
  status: WorldCatalogStatus;
  timelineMountMode: 'PRIMARY';
  mapAvailability: boolean;
  primaryAgentIds: string[];
  relatedWorldIds: string[];
};

/** Populated by nimi operations team. Empty in v1 spec phase. */
export const WORLD_CATALOG: WorldCatalogEntry[] = [];

export function getCatalogEntry(worldId: string): WorldCatalogEntry | undefined {
  return WORLD_CATALOG.find((e) => e.worldId === worldId);
}

/** Returns only ACTIVE catalog entries sorted by sortOrder. */
export function getActiveCatalogEntries(): WorldCatalogEntry[] {
  return WORLD_CATALOG
    .filter((e) => e.status === 'ACTIVE')
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
