import type { WorldCharacter, WorldDetailData, WorldHistoryBundle, WorldPublicAssetsData, WorldSceneItem, WorldSemanticData } from './world-detail-types.js';
import { currentWorldTime, formatNum, personaCount, sourceCount, worldCharacterCount } from './world-detail-template-model';

export type PaperMaterialKey = 'people' | 'scenes' | 'events' | 'resources' | 'lore';

export type PaperMaterial = {
  readonly key: PaperMaterialKey;
  readonly count: number;
};

/**
 * Browseable record collections derived from real world aggregates. Each entry
 * points at a sub-surface that already exists (people / scenes / resources /
 * lore) and only surfaces when it has at least one real record.
 */
export function derivedMaterials(
  characters: readonly WorldCharacter[],
  scenes: readonly WorldSceneItem[],
  publicAssets: WorldPublicAssetsData,
  semantic: WorldSemanticData,
): PaperMaterial[] {
  const resourceCount = publicAssets.resourceRefs.length + publicAssets.externalRefs.length + publicAssets.intents.length;
  const loreCount = semantic.operationRules.length
    + semantic.powerSystems.length
    + semantic.taboos.length
    + semantic.languages.length;
  const candidates: PaperMaterial[] = [
    { key: 'people', count: characters.length },
    { key: 'scenes', count: scenes.length },
    { key: 'resources', count: resourceCount },
    { key: 'lore', count: loreCount },
  ];
  return candidates.filter((material) => material.count > 0).slice(0, 4);
}

export function materialsTotal(materials: readonly PaperMaterial[]): number {
  return materials.reduce((sum, material) => sum + material.count, 0);
}

export type PaperPathKey = 'lead' | 'relations' | 'scenes';

export type PaperPath = {
  readonly key: PaperPathKey;
  readonly leadId?: string;
  readonly leadName?: string;
};

/**
 * Onboarding navigation paths composed over real world state. The first path
 * anchors on the most prominent real character; later paths route to the
 * characters / scenes sub-surfaces. No fabricated path records.
 */
export function derivedPaths(
  characters: readonly WorldCharacter[],
  scenes: readonly WorldSceneItem[],
): PaperPath[] {
  if (characters.length === 0) {
    return [];
  }
  const lead = characters.find((character) => character.importance === 'PRIMARY') ?? characters[0];
  const paths: PaperPath[] = [
    { key: 'lead', leadId: lead?.id, leadName: lead?.name },
    { key: 'relations' },
  ];
  if (scenes.length > 0) {
    paths.push({ key: 'scenes' });
  }
  return paths;
}

export type PaperMetricKey = 'people' | 'materials' | 'scenes' | 'events';

export type PaperMetric = {
  readonly key: PaperMetricKey;
  readonly value: string;
};

export function derivedMetrics(
  characters: readonly WorldCharacter[],
  scenes: readonly WorldSceneItem[],
  history: WorldHistoryBundle,
  materials: readonly PaperMaterial[],
): PaperMetric[] {
  const eventCount = history.summary?.totalCount ?? history.items.length;
  const metrics: PaperMetric[] = [
    { key: 'people', value: formatNum(characters.length) },
    { key: 'materials', value: formatNum(materialsTotal(materials)) },
    { key: 'scenes', value: formatNum(scenes.length) },
  ];
  if (eventCount > 0) {
    metrics.push({ key: 'events', value: formatNum(eventCount) });
  }
  return metrics;
}

const ISO_DATE_TIME_LABEL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function formatAuthoredWorldTimeLabel(
  value: string,
  formatDateTime: (value: unknown) => string,
): string {
  const label = value.trim();
  if (ISO_DATE_TIME_LABEL.test(label) && !Number.isNaN(new Date(label).getTime())) {
    return formatDateTime(label);
  }
  return value;
}

/**
 * Human-readable world time. Prefers an authored label; otherwise formats a
 * raw timestamp into the active locale's short date-time instead of leaking an
 * ISO string. Falls back to the era label when no time is set.
 */
export function worldTimeDisplay(
  world: WorldDetailData,
  formatDateTime: (value: unknown) => string,
): string {
  if (world.currentTimeLabel) {
    return formatAuthoredWorldTimeLabel(world.currentTimeLabel, formatDateTime);
  }
  if (world.currentWorldTime) {
    return formatDateTime(world.currentWorldTime);
  }
  return currentWorldTime(world);
}

/** Connectable characters first, used by the recommended-friends rail. */
export function recommendedFriends(characters: readonly WorldCharacter[]): WorldCharacter[] {
  const connectable = characters.filter((character) => character.relation?.state === 'connectable');
  const rest = characters.filter((character) => character.relation?.state !== 'connectable');
  return [...connectable, ...rest].slice(0, 3);
}

export { formatNum, personaCount, sourceCount, worldCharacterCount };
