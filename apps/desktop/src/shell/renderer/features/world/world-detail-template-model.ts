import type { WorldCharacter, WorldDetailData, WorldPublicAssetsData, WorldSceneItem, WorldSemanticData, WorldSemanticRule } from './world-detail-types.js';

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
  if (world.genre) tags.push(world.genre);
  if (world.era && !tags.includes(world.era)) tags.push(world.era);
  for (const theme of world.themes ?? []) {
    if (!tags.includes(theme)) tags.push(theme);
  }
  return tags.slice(0, 8);
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
  if (character.relation?.state === 'connected') return 'Local agent ready';
  if (character.relation?.state === 'unavailable') return 'Unavailable';
  return 'Create Local Agent';
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

export function derivedScenes(publicAssets: WorldPublicAssetsData, semantic: WorldSemanticData): WorldSceneItem[] {
  if (publicAssets.scenes.length > 0) {
    return [...publicAssets.scenes];
  }
  return (semantic.topology?.realms ?? []).slice(0, 4).map((realm, index) => ({
    id: `realm-${index + 1}`,
    name: realm.name,
    description: realm.description ?? realm.accessibility ?? '',
    activeEntities: [],
  }));
}
