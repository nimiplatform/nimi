import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

type ListMyWorldsResult = RealmServiceResult<'WorldControlService', 'worldControlControllerListMyWorlds'>;
type WorldSummaryItem = ListMyWorldsResult extends { items: Array<infer Item> } ? Item : never;
type WorldDetailWithAgentsResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorldDetailWithAgents'>;
type WorldviewResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorldview'>;
type WorldScenesResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorldScenes'>;
type WorldSceneItem = WorldScenesResult extends { items: Array<infer Item> } ? Item : never;
type WorldLorebooksResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorldLorebooks'>;
type WorldLorebookItem = WorldLorebooksResult extends { items: Array<infer Item> } ? Item : never;

export type WorldSummary = {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  era?: string;
  themes?: string[];
  status?: string;
  bannerUrl?: string;
  iconUrl?: string;
  agentCount: number;
  createdAt?: string;
  updatedAt?: string;
};

export type WorldDetailWithAgents = {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  era?: string;
  themes?: string[];
  bannerUrl?: string;
  iconUrl?: string;
  agents: WorldAgent[];
};

export type WorldAgent = {
  id: string;
  name: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string;
};

export type WorldviewData = {
  description?: string;
  timeModel?: string;
  spaceTopology?: string;
  causality?: string;
  coreSystem?: string;
  languages?: string;
  resources?: string;
  locations?: string;
  visualGuide?: string;
};

export type WorldScene = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
};

export type WorldLorebook = {
  id: string;
  title: string;
  content?: string;
  category?: string;
  enabled?: boolean;
  constant?: boolean;
};

function requireNonEmptyString(value: unknown, code: string): string {
  if (typeof value !== 'string') {
    throw new Error(code);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
  return items.length > 0 ? items : undefined;
}

function requireItemsArray<T>(value: T[] | undefined, code: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(code);
  }
  return value;
}

function summarizeTimeModel(input: WorldviewResult['timeModel'] | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const parts: string[] = [input.type];
  if (typeof input.unit === 'string' && input.unit.trim()) {
    parts.push(`unit ${input.unit.trim()}`);
  }
  if (typeof input.timeFlowRatio === 'number') {
    parts.push(`flow ${input.timeFlowRatio}`);
  }
  const cycleNames = Array.isArray(input.cycles)
    ? input.cycles
      .map((cycle) => optionalString(cycle.name))
      .filter((value): value is string => Boolean(value))
      .slice(0, 3)
    : [];
  if (cycleNames.length > 0) {
    parts.push(`cycles ${cycleNames.join(', ')}`);
  }
  return parts.join('; ');
}

function summarizeSpaceTopology(input: WorldviewResult['spaceTopology'] | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const parts: string[] = [input.type, input.boundary];
  if (typeof input.dimensions === 'number') {
    parts.push(`${input.dimensions}D`);
  }
  const realmNames = Array.isArray(input.realms)
    ? input.realms
      .map((realm) => optionalString(realm.name))
      .filter((value): value is string => Boolean(value))
      .slice(0, 3)
    : [];
  if (realmNames.length > 0) {
    parts.push(`realms ${realmNames.join(', ')}`);
  }
  const sceneNames = Array.isArray(input.scenes)
    ? input.scenes
      .map((scene) => optionalString(scene.name))
      .filter((value): value is string => Boolean(value))
      .slice(0, 3)
    : [];
  if (sceneNames.length > 0) {
    parts.push(`scenes ${sceneNames.join(', ')}`);
  }
  return parts.join('; ');
}

function summarizeCausality(input: WorldviewResult['causality'] | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const parts: string[] = [input.type];
  if (typeof input.allowParadox === 'boolean') {
    parts.push(input.allowParadox ? 'paradox allowed' : 'paradox forbidden');
  }
  if (typeof input.karmaEnabled === 'boolean') {
    parts.push(input.karmaEnabled ? 'karma enabled' : 'karma disabled');
  }
  if (typeof input.fateWeight === 'number') {
    parts.push(`fate weight ${input.fateWeight}`);
  }
  return parts.join('; ');
}

function summarizeCoreSystem(input: WorldviewResult['coreSystem'] | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const parts: string[] = [input.name];
  if (typeof input.description === 'string' && input.description.trim()) {
    parts.push(input.description.trim());
  }
  const levelNames = Array.isArray(input.levels)
    ? input.levels
      .map((level) => optionalString(level.name))
      .filter((value): value is string => Boolean(value))
      .slice(0, 3)
    : [];
  if (levelNames.length > 0) {
    parts.push(`levels ${levelNames.join(', ')}`);
  }
  return parts.join('; ');
}

function summarizeLanguages(input: WorldviewResult['languages'] | undefined): string | undefined {
  if (!input || !Array.isArray(input.languages)) {
    return undefined;
  }
  const languageNames = input.languages
    .map((language) => optionalString(language.name))
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);
  return languageNames.length > 0 ? languageNames.join(', ') : undefined;
}

function summarizeResources(input: WorldviewResult['resources'] | undefined): string | undefined {
  if (!input || !Array.isArray(input.types)) {
    return undefined;
  }
  const resourceNames = input.types
    .map((resource) => optionalString(resource.name))
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);
  return resourceNames.length > 0 ? resourceNames.join(', ') : undefined;
}

function summarizeLocations(input: WorldviewResult['locations'] | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const regionNames = Array.isArray(input.regions)
    ? input.regions
      .map((region) => optionalString(region.name))
      .filter((value): value is string => Boolean(value))
      .slice(0, 3)
    : [];
  const landmarkNames = Array.isArray(input.landmarks)
    ? input.landmarks
      .map((landmark) => optionalString(landmark.name))
      .filter((value): value is string => Boolean(value))
      .slice(0, 3)
    : [];
  const parts: string[] = [];
  if (regionNames.length > 0) {
    parts.push(`regions ${regionNames.join(', ')}`);
  }
  if (landmarkNames.length > 0) {
    parts.push(`landmarks ${landmarkNames.join(', ')}`);
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function summarizeVisualGuide(input: WorldviewResult['visualGuide'] | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const parts = [
    optionalString(input.artStyle),
    optionalString(input.colorPalette),
    optionalString(input.atmosphere),
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join('; ') : undefined;
}

export async function listMyWorlds(): Promise<WorldSummary[]> {
  const { realm } = getPlatformClient();
  const data: ListMyWorldsResult = await realm.services.WorldControlService.worldControlControllerListMyWorlds();
  const items = requireItemsArray(data.items, 'WORLD_BROWSER_WORLD_LIST_CONTRACT_INVALID');

  return items.map((world: WorldSummaryItem) => ({
    id: requireNonEmptyString(world.id, 'WORLD_BROWSER_WORLD_ID_REQUIRED'),
    name: requireNonEmptyString(world.name, 'WORLD_BROWSER_WORLD_NAME_REQUIRED'),
    description: optionalString(world.description),
    status: optionalString(world.status),
    agentCount: 0,
    updatedAt: requireNonEmptyString(world.updatedAt, 'WORLD_BROWSER_WORLD_UPDATED_AT_REQUIRED'),
  }));
}

export async function getWorldDetailWithAgents(worldId: string): Promise<WorldDetailWithAgents> {
  const { realm } = getPlatformClient();
  const data: WorldDetailWithAgentsResult =
    await realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(worldId, 4);
  const agents = requireItemsArray(data.agents, 'WORLD_BROWSER_WORLD_AGENTS_CONTRACT_INVALID');

  return {
    id: requireNonEmptyString(data.id, 'WORLD_BROWSER_WORLD_ID_REQUIRED'),
    name: requireNonEmptyString(data.name, 'WORLD_BROWSER_WORLD_NAME_REQUIRED'),
    description: optionalString(data.description),
    genre: optionalString(data.genre),
    era: optionalString(data.era),
    themes: optionalStringArray(data.themes),
    bannerUrl: optionalString(data.bannerUrl),
    iconUrl: optionalString(data.iconUrl),
    agents: agents.map((agent) => ({
      id: requireNonEmptyString(agent.id, 'WORLD_BROWSER_AGENT_ID_REQUIRED'),
      name: requireNonEmptyString(agent.name, 'WORLD_BROWSER_AGENT_NAME_REQUIRED'),
      handle: optionalString(agent.handle),
      bio: optionalString(agent.bio),
      avatarUrl: optionalString(agent.avatarUrl),
    })),
  };
}

export async function getWorldview(worldId: string): Promise<WorldviewData> {
  const { realm } = getPlatformClient();
  const data: WorldviewResult = await realm.services.WorldsService.worldControllerGetWorldview(worldId);

  return {
    description: undefined,
    timeModel: summarizeTimeModel(data.timeModel),
    spaceTopology: summarizeSpaceTopology(data.spaceTopology),
    causality: summarizeCausality(data.causality),
    coreSystem: summarizeCoreSystem(data.coreSystem),
    languages: summarizeLanguages(data.languages),
    resources: summarizeResources(data.resources),
    locations: summarizeLocations(data.locations),
    visualGuide: summarizeVisualGuide(data.visualGuide),
  };
}

export async function listWorldScenes(worldId: string): Promise<WorldScene[]> {
  const { realm } = getPlatformClient();
  const data: WorldScenesResult = await realm.services.WorldsService.worldControllerGetWorldScenes(worldId);
  const items = requireItemsArray(data.items, 'WORLD_BROWSER_SCENE_LIST_CONTRACT_INVALID');

  return items.map((scene: WorldSceneItem) => ({
    id: requireNonEmptyString(scene.id, 'WORLD_BROWSER_SCENE_ID_REQUIRED'),
    name: requireNonEmptyString(scene.name, 'WORLD_BROWSER_SCENE_NAME_REQUIRED'),
    description: optionalString(scene.description),
  }));
}

export async function listWorldLorebooks(worldId: string): Promise<WorldLorebook[]> {
  const { realm } = getPlatformClient();
  const data: WorldLorebooksResult = await realm.services.WorldsService.worldControllerGetWorldLorebooks(worldId);
  const items = requireItemsArray(data.items, 'WORLD_BROWSER_LOREBOOK_LIST_CONTRACT_INVALID');

  return items.map((lorebook: WorldLorebookItem) => ({
    id: requireNonEmptyString(lorebook.id, 'WORLD_BROWSER_LOREBOOK_ID_REQUIRED'),
    title: optionalString(lorebook.name) ?? requireNonEmptyString(lorebook.key, 'WORLD_BROWSER_LOREBOOK_KEY_REQUIRED'),
    content: optionalString(lorebook.content),
  }));
}
