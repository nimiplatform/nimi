import { isMainWorld, type WorldListItem } from './world-list-model';

const WORLD_MEDIA_PLACEHOLDER = 'var(--nimi-surface-hero)';

export const WORLD_ATLAS_LEAD_WORLD_IDS = [
  'z01', // 季风之眼：云端标本船
  'd10', // 春风得意行
  'cwe-b03-u09', // 红土大满贯：混双搭档是刚分手的前任
  'thinink-plains', // 薄墨平原
  'z03', // 雾峡灯塔与鲸骨邮局
] as const;

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function selectWorldSpotlight(worlds: readonly WorldListItem[], leadWorlds: readonly WorldListItem[]) {
  const byId = new Map([...worlds, ...leadWorlds].map((world) => [world.id, world]));
  const leads = WORLD_ATLAS_LEAD_WORLD_IDS.flatMap((id) => {
    const world = byId.get(id);
    return world ? [world] : [];
  });
  const leadIds = new Set(leads.map((world) => world.id));
  return [...leads, ...worlds.filter((world) => !leadIds.has(world.id))]
    .filter((world) => !isMainWorld(world) && (world.heroMedia || world.bannerMedia || world.bannerUrl))
    .slice(0, 5);
}

export function worldHeroBackground(imageUrl: string | null): string {
  if (imageUrl) {
    return `url(${imageUrl}) center/cover no-repeat`;
  }
  return WORLD_MEDIA_PLACEHOLDER;
}

export function worldThumbBackground(imageUrl: string | null): string {
  return imageUrl ? `url(${imageUrl}) center/cover no-repeat` : WORLD_MEDIA_PLACEHOLDER;
}

export function sourceCount(world: WorldListItem): number {
  return world.characterCount + world.personaCharacterCount;
}

/**
 * Display tags come only from the world's explicit genre, themes and optional era, in that
 * order. Nothing is inferred from ids, names, anchors or text, and mixed-script tags are kept.
 */
export function displayTags(world: Pick<WorldListItem, 'genre' | 'themes' | 'era'>, limit = 4): string[] {
  const values: string[] = [];
  for (const value of [world.genre, ...world.themes, world.era]) {
    const tag = value?.trim().replace(/\s+/g, ' ');
    if (!tag || values.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      continue;
    }
    values.push(tag);
  }
  return values.slice(0, Math.max(0, limit));
}

export function worldSummary(world: WorldListItem): string {
  return world.tagline || world.description || world.overview || '';
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

export function selectInitialWorld(worlds: readonly WorldListItem[]): string | null {
  const firstCreatorWorld = worlds.find((world) => !isMainWorld(world));
  return firstCreatorWorld?.id ?? worlds[0]?.id ?? null;
}
