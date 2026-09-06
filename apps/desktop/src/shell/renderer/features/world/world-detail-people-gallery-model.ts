import type { WorldCharacter } from './world-detail-types.js';

/**
 * "People you can meet" gallery model.
 *
 * The full-roster surface is not a flat list — characters are clustered along a
 * switchable logical axis so a 50-person world reads as a structured social
 * network rather than an undifferentiated grid. Characters already added
 * locally pin to a leading "connected" group above every axis. All
 * grouping/sorting is pure and derived from real character fields; nothing is
 * fabricated.
 */

export type PeopleGroupBy = 'faction' | 'tier' | 'status';

export type PeopleRelationState = 'connectable' | 'connected' | 'unavailable';

export type PeopleGroup = {
  readonly id: string;
  readonly kind: PeopleGroupBy;
  /** i18n key suffix when the group label is a fixed enum (tier/status/ungrouped). */
  readonly labelKey?: string;
  /** Literal label when the group is an authored faction string. */
  readonly label?: string;
  readonly characters: readonly WorldCharacter[];
};

const TIER_RANK: Record<WorldCharacter['importance'], number> = {
  PRIMARY: 0,
  SECONDARY: 1,
  BACKGROUND: 2,
};

const TIER_ORDER: readonly WorldCharacter['importance'][] = ['PRIMARY', 'SECONDARY', 'BACKGROUND'];
const STATUS_ORDER: readonly PeopleRelationState[] = ['connectable', 'connected', 'unavailable'];

const UNGROUPED_FACTION_ID = 'ungrouped';

function relationState(character: WorldCharacter): PeopleRelationState {
  return character.relation?.state ?? 'connectable';
}

/**
 * Within a group, surface the most prominent / most alive characters first:
 * importance tier, then vitality, then engagement, then name as a stable tail.
 */
function sortWithinGroup(a: WorldCharacter, b: WorldCharacter): number {
  const tier = TIER_RANK[a.importance] - TIER_RANK[b.importance];
  if (tier !== 0) return tier;
  const vitality = (b.stats?.vitalityScore ?? 0) - (a.stats?.vitalityScore ?? 0);
  if (vitality !== 0) return vitality;
  const engagement = (b.stats?.engagementCount ?? 0) - (a.stats?.engagementCount ?? 0);
  if (engagement !== 0) return engagement;
  return a.name.localeCompare(b.name);
}

/** Distinct non-empty factions present in the roster. */
export function distinctFactions(characters: readonly WorldCharacter[]): string[] {
  const seen = new Set<string>();
  for (const character of characters) {
    const faction = character.faction?.trim();
    if (faction) seen.add(faction);
  }
  return [...seen];
}

/**
 * Default axis: faction clustering is the most expressive lens for a social
 * world, but it only earns the default when at least two real factions exist.
 * Otherwise fall back to importance tiers, which every character carries.
 */
export function defaultPeopleGroupBy(characters: readonly WorldCharacter[]): PeopleGroupBy {
  return distinctFactions(characters).length >= 2 ? 'faction' : 'tier';
}

/** Grouping dimensions worth offering for this roster (faction only when present). */
export function availableGroupBys(characters: readonly WorldCharacter[]): PeopleGroupBy[] {
  const axes: PeopleGroupBy[] = [];
  if (distinctFactions(characters).length >= 1) axes.push('faction');
  axes.push('tier', 'status');
  return axes;
}

export function filterPeople(characters: readonly WorldCharacter[], query: string): WorldCharacter[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...characters];
  return characters.filter((character) => (
    character.name.toLowerCase().includes(q)
    || (character.role ?? '').toLowerCase().includes(q)
    || (character.faction ?? '').toLowerCase().includes(q)
    || (character.rank ?? '').toLowerCase().includes(q)
    || (character.handle ?? '').toLowerCase().includes(q)
    || (character.sceneName ?? '').toLowerCase().includes(q)
    || (character.location ?? '').toLowerCase().includes(q)
  ));
}

export function connectableCount(characters: readonly WorldCharacter[]): number {
  return characters.reduce((sum, character) => sum + (relationState(character) === 'connectable' ? 1 : 0), 0);
}

function groupByFaction(characters: readonly WorldCharacter[]): PeopleGroup[] {
  const buckets = new Map<string, WorldCharacter[]>();
  for (const character of characters) {
    const key = character.faction?.trim() || UNGROUPED_FACTION_ID;
    const bucket = buckets.get(key) ?? buckets.set(key, []).get(key)!;
    bucket.push(character);
  }
  const groups: PeopleGroup[] = [...buckets.entries()].map(([key, bucket]) => ({
    id: key,
    kind: 'faction',
    labelKey: key === UNGROUPED_FACTION_ID ? 'ungrouped' : undefined,
    label: key === UNGROUPED_FACTION_ID ? undefined : key,
    characters: [...bucket].sort(sortWithinGroup),
  }));
  // Largest circles read first; the catch-all "free" group always sinks last.
  groups.sort((a, b) => {
    const aUngrouped = a.labelKey === 'ungrouped' ? 1 : 0;
    const bUngrouped = b.labelKey === 'ungrouped' ? 1 : 0;
    if (aUngrouped !== bUngrouped) return aUngrouped - bUngrouped;
    if (b.characters.length !== a.characters.length) return b.characters.length - a.characters.length;
    return (a.label ?? '').localeCompare(b.label ?? '');
  });
  return groups;
}

function groupByFixedAxis(
  characters: readonly WorldCharacter[],
  kind: 'tier' | 'status',
  order: readonly string[],
  classify: (character: WorldCharacter) => string,
): PeopleGroup[] {
  return order
    .map((value) => ({
      id: value,
      kind,
      labelKey: value,
      characters: characters.filter((character) => classify(character) === value).sort(sortWithinGroup),
    }))
    .filter((group) => group.characters.length > 0);
}

export function buildPeopleGroups(
  characters: readonly WorldCharacter[],
  groupBy: PeopleGroupBy,
): PeopleGroup[] {
  // Locally added characters pin to a leading group above every axis so their
  // chat entry is always at the top.
  const connected = characters.filter((character) => relationState(character) === 'connected').sort(sortWithinGroup);
  const rest = characters.filter((character) => relationState(character) !== 'connected');
  const axisGroups = groupBy === 'faction'
    ? groupByFaction(rest)
    : groupBy === 'tier'
      ? groupByFixedAxis(rest, 'tier', TIER_ORDER, (character) => character.importance)
      : groupByFixedAxis(rest, 'status', STATUS_ORDER, relationState);
  if (connected.length === 0) {
    return axisGroups;
  }
  return [
    { id: 'connected', kind: 'status', labelKey: 'connected', characters: connected },
    ...axisGroups,
  ];
}
