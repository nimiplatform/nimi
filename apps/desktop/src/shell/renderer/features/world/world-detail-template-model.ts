import type { WorldAssetExternalRef, WorldCharacter, WorldDetailData, WorldPublicAssetsData, WorldSceneItem, WorldSemanticData, WorldSemanticRule } from './world-detail-types.js';

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
  return characters.filter((character) => character.ownership === 'userOwned' || character.sourceKind === 'realmPersona').length;
}

export function worldCharacterCount(characters: readonly WorldCharacter[]): number {
  return characters.filter((character) => character.ownership !== 'userOwned' && character.sourceKind !== 'realmPersona').length;
}

export function displayTags(world: WorldDetailData): string[] {
  const tags: string[] = [];
  const pushTag = (value: string | null | undefined) => {
    const tag = normalizeUserFacingWorldTag(value);
    if (!tag) {
      return;
    }
    const key = tag.toLocaleLowerCase();
    if (tags.some((existing) => existing.toLocaleLowerCase() === key)) {
      return;
    }
    tags.push(tag);
  };
  pushTag(world.genre);
  pushTag(world.era);
  for (const theme of world.themes ?? []) {
    pushTag(theme);
  }
  return tags.slice(0, 4);
}

function normalizeUserFacingWorldTag(value: string | null | undefined): string | null {
  const tag = value?.trim().replace(/\s+/g, ' ');
  if (!tag || isTechnicalWorldTag(tag)) {
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

export function worldSummary(world: WorldDetailData): string {
  return world.overview || world.description || world.tagline || 'Public world background for discovering characters and personas.';
}

export function worldStatus(world: WorldDetailData): string {
  if (world.status === 'SYSTEM') return 'System';
  if (world.status === 'PUBLIC') return 'Public';
  return 'Discoverable';
}

export function currentWorldTime(world: WorldDetailData): string {
  if (world.currentTimeLabel) return world.currentTimeLabel;
  if (world.currentWorldTime) return world.currentWorldTime;
  return world.eraLabel || 'Anchored';
}

export function relationLabel(character: WorldCharacter): string {
  if (character.relation?.state === 'connected') return 'Partner ready';
  if (character.relation?.state === 'unavailable') return 'Unavailable';
  return 'Become my partner';
}

export function characterMeta(character: WorldCharacter): string {
  return [character.role, character.faction, character.sceneName].filter(Boolean).join(' / ') || character.handle;
}

export function topRules(semantic: WorldSemanticData): WorldSemanticRule[] {
  const directRules = semantic.operationRules.slice(0, 4);
  if (directRules.length > 0) return withTimeFlowRule(directRules);
  const powerRules = semantic.powerSystems.flatMap((system) => (
    system.rules.map((rule, index) => ({
      key: `${system.name}-${index}`,
      title: system.name,
      value: rule,
    }))
  ));
  return withTimeFlowRule(powerRules.slice(0, 4));
}

export function withTimeFlowRule(rules: readonly WorldSemanticRule[]): WorldSemanticRule[] {
  const hasTimeFlow = rules.some((rule) => `${rule.title} ${rule.value}`.toLowerCase().includes('timeflow'));
  if (hasTimeFlow) {
    return [...rules];
  }
  const timeFlowRule = {
    key: 'timeflow',
    title: 'Time Flow',
    value: 'Current world time is calculated from initial world time and timeflow ratio.',
  };
  return rules.length >= 4
    ? [...rules.slice(0, 3), timeFlowRule]
    : [...rules, timeFlowRule];
}

export function derivedScenes(
  publicAssets: WorldPublicAssetsData,
  semantic: WorldSemanticData,
  characters: readonly WorldCharacter[] = [],
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
  return scenes.map((scene) => withPlacementTaggedCharacters(scene, characters));
}

function withPlacementTaggedCharacters(
  scene: WorldSceneItem,
  characters: readonly WorldCharacter[],
): WorldSceneItem {
  const existingIds = new Set(scene.relatedCharacters.map((character) => character.id));
  const placementCharacters = characters.filter((character) => {
    if (existingIds.has(character.id)) {
      return false;
    }
    return character.tags?.some((tag) => tag.trim() === scene.id) ?? false;
  });
  if (placementCharacters.length === 0) {
    return scene;
  }
  const relatedCharacters = [...scene.relatedCharacters, ...placementCharacters];
  return {
    ...scene,
    relatedCharacters,
    counts: {
      ...scene.counts,
      relatedCharacterCount: Math.max(scene.counts.relatedCharacterCount, relatedCharacters.length),
    },
  };
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
