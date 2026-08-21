import { formatNum } from './world-list-atoms';
import { isMainWorld, type WorldListItem } from './world-list-model';

export type SortId = 'active' | 'recent' | 'alpha' | 'sources';
export type ViewMode = 'grid' | 'list';

const WORLD_MEDIA_PLACEHOLDER = 'var(--nimi-surface-hero)';

export function worldHeroBackground(imageUrl: string | null): string {
  if (imageUrl) {
    return `url(${imageUrl}) center/cover no-repeat`;
  }
  return WORLD_MEDIA_PLACEHOLDER;
}

export function worldThumbBackground(imageUrl: string | null): string {
  return imageUrl ? `url(${imageUrl}) center/cover no-repeat` : WORLD_MEDIA_PLACEHOLDER;
}

export function sortWorlds(list: WorldListItem[], sort: SortId): WorldListItem[] {
  const arr = [...list];
  if (sort === 'active') {
    arr.sort((a, b) => (b.scoreEwma ?? 0) - (a.scoreEwma ?? 0));
  } else if (sort === 'recent') {
    arr.sort((a, b) => {
      const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return tb - ta;
    });
  } else if (sort === 'alpha') {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    arr.sort((a, b) => sourceCount(b) - sourceCount(a));
  }
  return arr;
}

// Followed worlds pin to the top of the rail (WeChat-style sticky); the
// active sort still applies within the pinned and unpinned groups.
export function pinFollowedFirst(list: WorldListItem[], isFollowed: (worldId: string) => boolean): WorldListItem[] {
  const pinned = list.filter((world) => isFollowed(world.id));
  const rest = list.filter((world) => !isFollowed(world.id));
  return [...pinned, ...rest];
}

export function sourceCount(world: WorldListItem): number {
  return world.characterCount + world.personaCount;
}

export function matchesQuery(world: WorldListItem, q: string): boolean {
  if (!q) return true;
  const haystack = [
    world.name,
    world.description ?? '',
    world.tagline ?? '',
    world.genre ?? '',
    world.era ?? '',
    ...world.themes,
    ...world.entityKinds,
    ...world.relationshipTypes,
    ...(world.characters?.map((character) => character.name) ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function normalizeWorldDisplayTag(value: string | null | undefined): string | null {
  const tag = value?.trim().replace(/\s+/g, ' ');
  if (!tag) {
    return null;
  }
  if (isTechnicalWorldTag(tag)) {
    return null;
  }
  return tag;
}

function normalizeComputedEraTag(value: string | null | undefined): string | null {
  const tag = normalizeWorldDisplayTag(value);
  if (!tag) {
    return null;
  }
  if (/^\d{4}(?:[-年/]|$)/.test(tag)) {
    return null;
  }
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|day|time)\b/i.test(tag)) {
    return null;
  }
  return /(?:朝|代|时期|纪元|dynasty|era|period|tang|song|yuan|ming|qing|han|qin|sui|jin|liao)/i.test(tag)
    ? tag
    : null;
}

function normalizeComparableTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeEraPreviewTag(value: string | null | undefined, worldName: string): string | null {
  const tag = normalizeComputedEraTag(value);
  if (!tag) {
    return null;
  }
  const normalizedWorldName = normalizeComparableTag(worldName);
  return normalizedWorldName && normalizeComparableTag(tag).includes(normalizedWorldName)
    ? null
    : tag;
}

function isTechnicalWorldTag(tag: string): boolean {
  const lower = tag.toLocaleLowerCase();
  if (['discoverable', 'public', 'system', 'no tag', '暂无标签'].includes(lower)) {
    return true;
  }
  if (/^\d+(?:\.\d+)?\s*(?:source|sources|character|characters|persona|personas)\b/i.test(tag)) {
    return true;
  }
  if (/(?:time\s*flow|timeflow|时间流速|\d+(?:\.\d+)?x\b)/i.test(tag)) {
    return true;
  }
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i.test(tag)) {
    return true;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(tag)) {
    return true;
  }
  if (/^(?:world|source|realm|runtime|local-agent|cloud)[\s:/_-]/i.test(tag)) {
    return true;
  }
  return /^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/i.test(tag) && tag.length > 20;
}

export function displayTags(world: WorldListItem, limit = 4, _language?: string): string[] {
  const values: string[] = [];
  const pushTag = (value: string | null | undefined, normalize = normalizeWorldDisplayTag) => {
    const tag = normalize(value);
    if (!tag) {
      return;
    }
    const key = tag.toLocaleLowerCase();
    if (values.some((existing) => existing.toLocaleLowerCase() === key)) {
      return;
    }
    values.push(tag);
  };
  pushTag(world.era, (value) => normalizeEraPreviewTag(value, world.name));
  if (values.length === 0) {
    pushTag(world.computed.time.eraLabel, (value) => normalizeEraPreviewTag(value, world.name));
  }
  return values.slice(0, Math.max(0, limit));
}

export function isWorldVisibleInAtlas(world: Pick<WorldListItem, 'id' | 'name'>): boolean {
  const identity = `${world.id} ${world.name}`.toLocaleLowerCase();
  return !/(?:北京|beijing|北宋)士大夫世界/.test(identity);
}

export function worldSummary(world: WorldListItem): string {
  return world.tagline || world.description || world.overview || 'Public setting background for source discovery.';
}

export function statusLabel(world: WorldListItem): string {
  if (world.freezeReason || world.status === 'FROZEN') {
    return 'Locked';
  }
  if (world.status === 'SYSTEM') {
    return 'System';
  }
  return 'Public';
}

export function dayLabel(world: WorldListItem): string {
  if (world.computed.time.currentLabel) {
    return world.computed.time.currentLabel;
  }
  const parsed = world.computed.time.currentWorldTime
    ? new Date(world.computed.time.currentWorldTime)
    : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    const diff = Math.max(1, Math.ceil((parsed.getTime() - Date.parse(world.createdAt)) / 86_400_000));
    return `Day ${formatNum(diff)}`;
  }
  return world.computed.time.eraLabel || 'Time anchored';
}

export function selectInitialWorld(worlds: readonly WorldListItem[]): string | null {
  const firstCreatorWorld = worlds.find((world) => !isMainWorld(world));
  return firstCreatorWorld?.id ?? worlds[0]?.id ?? null;
}

export function selectFeaturedWorlds(worlds: readonly WorldListItem[]): WorldListItem[] {
  const creatorWorlds = sortWorlds(worlds.filter((world) => !isMainWorld(world)), 'active');
  return creatorWorlds.length > 0 ? creatorWorlds : sortWorlds([...worlds], 'active');
}
