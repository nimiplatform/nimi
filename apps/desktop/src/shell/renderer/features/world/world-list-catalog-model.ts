import type { CSSProperties } from 'react';
import { formatNum } from './world-list-atoms';
import { isMainWorld, type WorldListItem } from './world-list-model';

export type CategoryId = 'all' | 'trending' | 'new' | 'fantasy' | 'sci-fi' | 'nature' | 'steampunk' | 'mystery' | 'anime';
export type SortId = 'active' | 'recent' | 'alpha' | 'sources';
export type ViewMode = 'grid' | 'list';

export const CATEGORY_TABS: readonly { id: CategoryId; label: string }[] = [
  { id: 'all', label: 'All Worlds' },
  { id: 'trending', label: 'Trending' },
  { id: 'new', label: 'New' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'sci-fi', label: 'Sci-Fi' },
  { id: 'nature', label: 'Nature' },
  { id: 'steampunk', label: 'Steampunk' },
  { id: 'mystery', label: 'Mystery' },
  { id: 'anime', label: 'Anime' },
] as const;

export const GLASS_CARD_STYLE: CSSProperties = {
  background: 'var(--nimi-material-glass-regular-bg)',
  border: '1px solid var(--nimi-material-glass-regular-border)',
  boxShadow: '0 16px 42px rgba(54,80,125,0.08)',
};

export const GLASS_CARD_CLASS = 'nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]';

const WORLD_MEDIA_PLACEHOLDER =
  'linear-gradient(135deg, rgba(95,201,234,0.82), rgba(143,115,255,0.76))';

export function worldHeroBackground(imageUrl: string | null): string {
  if (imageUrl) {
    return `linear-gradient(180deg, rgba(15,23,42,0.12), rgba(15,23,42,0.58)), url(${imageUrl}) center/cover no-repeat`;
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

export function displayTags(world: WorldListItem, limit = 4): string[] {
  const values: string[] = [];
  if (world.genre) values.push(world.genre);
  if (world.era && !values.includes(world.era)) values.push(world.era);
  for (const theme of world.themes) {
    if (!values.includes(theme)) values.push(theme);
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
