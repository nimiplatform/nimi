import { isMainWorld, type WorldListItem } from './world-list-model';

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
