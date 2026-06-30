import type { WorldCharacter, WorldDetailData, WorldHistoryBundle, WorldPublicAssetsData, WorldSceneItem, WorldSemanticData } from './world-detail-types.js';
import { formatLocaleDateTime } from '@renderer/i18n';
import { currentWorldTime, formatNum, personaCount, sourceCount, worldCharacterCount } from './world-detail-template-model';

/**
 * Paper / ink themed palette for the redesigned world detail surface.
 * Warm rice-paper backgrounds, classical serif headings, single green accent.
 * The hero banner is intentionally excluded — it keeps its existing styling.
 */
export const PAPER = {
  pageGradient:
    'radial-gradient(60% 50% at 0% 0%,rgba(205,196,170,.5),transparent 60%),'
    + 'radial-gradient(55% 50% at 100% 0%,rgba(198,205,184,.42),transparent 60%),'
    + 'radial-gradient(60% 60% at 100% 100%,rgba(214,200,182,.38),transparent 60%),'
    + 'radial-gradient(55% 55% at 0% 100%,rgba(200,210,192,.34),transparent 60%),'
    + 'linear-gradient(135deg,#f3eee3 0%,#ece5d6 100%)',
  card: '#fbf8f1',
  cardSoft: '#fefcf7',
  border: '#e7dfce',
  borderSoft: '#e9e1d0',
  borderInner: '#efe7d6',
  divider: '#ece4d3',
  green: '#1d5f43',
  greenInk: '#247053',
  greenSoftBg: 'rgba(29,95,67,.1)',
  inkStrong: '#262017',
  ink: '#3b3527',
  body: '#4a4336',
  bodySoft: '#6f6657',
  muted: '#7a7060',
  faint: '#9b9180',
  cardShadow: '0 6px 18px rgba(60,50,30,.06)',
  cardShadowStrong: '0 8px 22px rgba(60,50,30,.08)',
  avatarBorder: '#e3d6ba',
  avatarGradient: 'radial-gradient(circle at 50% 30%,#e7ddc6,#b3a585)',
} as const;

export const PAPER_SERIF =
  '"Noto Serif SC","Songti SC","STSong","SimSun",ui-serif,Georgia,serif';

export const PAPER_RADIUS = {
  md: 'var(--nimi-radius-md)',
  lg: 'var(--nimi-radius-lg)',
  xl: 'var(--nimi-radius-xl)',
} as const;

export type PaperMaterialKey = 'people' | 'scenes' | 'events' | 'resources' | 'lore';

export type PaperMaterial = {
  readonly key: PaperMaterialKey;
  readonly count: number;
};

/**
 * Browseable record collections derived from real world aggregates. Each entry
 * points at a sub-surface that already exists (people / scenes / timeline /
 * resources / lore) and only surfaces when it has at least one real record.
 */
export function derivedMaterials(
  characters: readonly WorldCharacter[],
  scenes: readonly WorldSceneItem[],
  history: WorldHistoryBundle,
  publicAssets: WorldPublicAssetsData,
  semantic: WorldSemanticData,
): PaperMaterial[] {
  const eventCount = history.summary?.totalCount ?? history.items.length;
  const resourceCount = publicAssets.resourceRefs.length + publicAssets.externalRefs.length;
  const loreCount = semantic.operationRules.length
    + semantic.powerSystems.length
    + semantic.taboos.length
    + semantic.languages.length;
  const candidates: PaperMaterial[] = [
    { key: 'people', count: characters.length },
    { key: 'scenes', count: scenes.length },
    { key: 'events', count: eventCount },
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
    { key: 'lead', leadName: lead?.name },
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
  return [
    { key: 'people', value: formatNum(characters.length) },
    { key: 'materials', value: formatNum(materialsTotal(materials)) },
    { key: 'scenes', value: formatNum(scenes.length) },
    { key: 'events', value: formatNum(eventCount) },
  ];
}

const ISO_DATE_TIME_LABEL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function formatAuthoredWorldTimeLabel(value: string): string {
  const label = value.trim();
  if (ISO_DATE_TIME_LABEL.test(label) && !Number.isNaN(new Date(label).getTime())) {
    return formatLocaleDateTime(label);
  }
  return value;
}

/**
 * Human-readable world time. Prefers an authored label; otherwise formats a
 * raw timestamp into the active locale's short date-time instead of leaking an
 * ISO string. Falls back to the era label when no time is set.
 */
export function worldTimeDisplay(world: WorldDetailData): string {
  if (world.currentTimeLabel) {
    return formatAuthoredWorldTimeLabel(world.currentTimeLabel);
  }
  if (world.currentWorldTime) {
    return formatLocaleDateTime(world.currentWorldTime);
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
