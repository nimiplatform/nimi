import type { WorldAssetExternalRef, WorldCharacter, WorldDetailData, WorldPublicAssetsData, WorldSceneItem, WorldSemanticData } from './world-detail-types.js';

export const DETAIL_MEDIA_PLACEHOLDER =
  'linear-gradient(135deg, rgba(95,201,234,0.84), rgba(143,115,255,0.78))';

export function detailHeroBackground(imageUrl: string | null): string {
  if (imageUrl) {
    return `linear-gradient(180deg, rgba(15,23,42,0.04), rgba(15,23,42,0.52)), url(${imageUrl}) center/cover no-repeat`;
  }
  return DETAIL_MEDIA_PLACEHOLDER;
}

export function detailSceneBackground(imageUrl: string | null): string {
  if (imageUrl) {
    return `linear-gradient(180deg, rgba(15,23,42,0.05), rgba(15,23,42,0.56)), url(${imageUrl}) center/cover no-repeat`;
  }
  return DETAIL_MEDIA_PLACEHOLDER;
}

export function formatNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) {
    const value = n / 1000;
    return `${value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, '')}k`;
  }
  return String(Math.round(n));
}

export function sourceCount(characters: readonly WorldCharacter[]): number {
  return characters.length;
}

export function personaCount(characters: readonly WorldCharacter[]): number {
  return characters.filter((character) => character.ownership === 'userOwned' || character.sourceKind === 'personaCharacter').length;
}

export function worldCharacterCount(characters: readonly WorldCharacter[]): number {
  return characters.filter((character) => character.ownership !== 'userOwned' && character.sourceKind !== 'personaCharacter').length;
}

// Explicit genre, themes and optional era only, in that order; nothing is inferred.
export function displayTags(world: WorldDetailData): string[] {
  const tags: string[] = [];
  for (const value of [world.genre, ...(world.themes ?? []), world.era]) {
    const tag = value?.trim().replace(/\s+/g, ' ');
    if (!tag || tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      continue;
    }
    tags.push(tag);
  }
  return tags.slice(0, 4);
}

export function worldSummary(world: WorldDetailData): string {
  return world.overview || world.description || world.tagline || '';
}

export function worldStatus(world: WorldDetailData): string {
  if (world.status === 'SYSTEM') return 'System';
  if (world.status === 'PUBLIC') return 'Public';
  return 'Discoverable';
}

export function relationLabel(character: WorldCharacter): string {
  if (character.relation?.state === 'connected') return 'Partner ready';
  if (character.relation?.state === 'unavailable') return 'Unavailable';
  return 'Become my partner';
}

export function characterMeta(character: WorldCharacter): string {
  return [character.role, character.faction, character.sceneName].filter(Boolean).join(' / ') || character.handle;
}

export function derivedScenes(
  publicAssets: WorldPublicAssetsData,
  semantic: WorldSemanticData,
): WorldSceneItem[] {
  const scenes = publicAssets.scenes.length > 0
    ? [...publicAssets.scenes]
    : (semantic.topology?.realms ?? []).slice(0, 4).map((realm, index) => ({
    id: `realm-${index + 1}`,
    name: realm.name,
    description: realm.description ?? realm.accessibility ?? '',
    activeEntities: [],
    relatedCharacters: [],
    relatedEvents: [],
    relatedResources: [],
    counts: {
      activeEntityCount: 0,
      relatedCharacterCount: 0,
      relatedEventCount: 0,
      relatedResourceCount: 0,
    },
    media: [],
  }));
  return scenes;
}

export function sceneImageRef(
  scene: WorldSceneItem,
  fallbackRefs: readonly WorldAssetExternalRef[],
  index: number,
): WorldAssetExternalRef | null {
  const sceneMedia = scene.media.find((asset) => asset.url);
  if (sceneMedia) {
    return {
      refId: sceneMedia.id,
      kind: sceneMedia.kind,
      purpose: 'scene',
      label: null,
      uri: sceneMedia.url,
    };
  }
  if (fallbackRefs.length === 0) {
    return null;
  }
  return fallbackRefs[index % fallbackRefs.length] ?? null;
}
