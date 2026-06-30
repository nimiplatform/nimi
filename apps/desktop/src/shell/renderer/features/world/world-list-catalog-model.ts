import { formatNum } from './world-list-atoms';
import { isMainWorld, type WorldListItem } from './world-list-model';

export type CategoryId = 'all' | 'followed' | 'trending' | 'new' | 'fantasy' | 'sci-fi' | 'nature' | 'steampunk' | 'mystery' | 'anime';
export type SortId = 'active' | 'recent' | 'alpha' | 'sources';
export type ViewMode = 'grid' | 'list';

export const CATEGORY_TABS: readonly { id: CategoryId; label: string }[] = [
  { id: 'all', label: 'All Worlds' },
  { id: 'followed', label: 'Followed' },
  { id: 'trending', label: 'Trending' },
  { id: 'new', label: 'New' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'sci-fi', label: 'Sci-Fi' },
  { id: 'nature', label: 'Nature' },
  { id: 'steampunk', label: 'Steampunk' },
  { id: 'mystery', label: 'Mystery' },
  { id: 'anime', label: 'Anime' },
] as const;

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

export function categoryMatches(world: WorldListItem, category: CategoryId): boolean {
  if (category === 'all' || category === 'trending' || category === 'new') {
    return true;
  }
  const needle = category.replace('-', ' ');
  const tags = [world.genre, world.era, ...world.themes]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase();
  return tags.includes(needle);
}

type WorldTagLanguage = 'en' | 'zh';

const WORLD_TAG_LABELS: Record<string, Record<WorldTagLanguage, string>> = {
  historical: { en: 'Historical', zh: '历史世界' },
  fantasy: { en: 'Fantasy', zh: '奇幻' },
  'sci-fi': { en: 'Sci-Fi', zh: '科幻' },
  scifi: { en: 'Sci-Fi', zh: '科幻' },
  nature: { en: 'Nature', zh: '自然' },
  steampunk: { en: 'Steampunk', zh: '蒸汽朋克' },
  mystery: { en: 'Mystery', zh: '悬疑' },
  anime: { en: 'Anime', zh: '动画' },
};

const WORLD_TAG_PREFIX_LABELS: ReadonlyArray<{
  prefix: string;
  labels: Record<WorldTagLanguage, string>;
}> = [
  { prefix: 'cbdb', labels: { en: 'Scholarly sources', zh: '学术资料' } },
];

function resolveWorldTagLanguage(language?: string): WorldTagLanguage {
  return language?.toLocaleLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function normalizeWorldDisplayTag(value: string | null | undefined, language?: string): string | null {
  const tag = value?.trim().replace(/\s+/g, ' ');
  if (!tag) {
    return null;
  }
  const locale = resolveWorldTagLanguage(language);
  const key = tag.toLocaleLowerCase();
  const directLabel = WORLD_TAG_LABELS[key];
  if (directLabel) {
    return directLabel[locale];
  }
  const prefixLabel = WORLD_TAG_PREFIX_LABELS.find(({ prefix }) =>
    key === prefix || key.startsWith(`${prefix}-`) || key.startsWith(`${prefix}_`),
  );
  if (prefixLabel) {
    return prefixLabel.labels[locale];
  }
  if (isTechnicalWorldTag(tag)) {
    return null;
  }
  return tag;
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

export function displayTags(world: WorldListItem, limit = 4, language?: string): string[] {
  const values: string[] = [];
  const pushTag = (value: string | null | undefined) => {
    const tag = normalizeWorldDisplayTag(value, language);
    if (!tag) {
      return;
    }
    const key = tag.toLocaleLowerCase();
    if (values.some((existing) => existing.toLocaleLowerCase() === key)) {
      return;
    }
    values.push(tag);
  };
  pushTag(world.genre);
  pushTag(world.era);
  for (const theme of world.themes) {
    pushTag(theme);
  }
  return values.slice(0, limit);
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
