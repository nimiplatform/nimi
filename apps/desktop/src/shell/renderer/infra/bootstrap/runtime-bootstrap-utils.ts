export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

export function isCreatorAgentApiEnabled(): boolean {
  const raw = String(import.meta.env.VITE_NIMI_ENABLE_CREATOR_AGENTS || '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function toRecordArray(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as Record<string, unknown>);
  }

  if (!input || typeof input !== 'object') {
    return [];
  }

  const root = input as Record<string, unknown>;
  const items = Array.isArray(root.items) ? root.items : [];
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>);
}

export function toRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

export const WORLD_DATA_API_CAPABILITIES = {
  runtimeRouteOptions: 'data-api.runtime.route.options',
  accessMe: 'data-api.world.access.me',
  oasisGet: 'data-api.world.oasis.get',
  landingResolve: 'data-api.world.landing.resolve',
  draftCreate: 'data-api.world.draft.create',
  draftGet: 'data-api.world.draft.get',
  draftUpdate: 'data-api.world.draft.update',
  draftPublish: 'data-api.world.draft.publish',
  maintenanceGet: 'data-api.world.maintenance.get',
  maintenanceUpdate: 'data-api.world.maintenance.update',
  eventsList: 'data-api.world.events.list',
  scenesList: 'data-api.world.scenes.list',
  narrativeContextsList: 'data-api.world.narrative-contexts.list',
  narrativeSpineGetOrCreate: 'data-api.world.spine.get-or-create',
  satellitesBySpineList: 'data-api.world.satellites.by-spine.list',
  satellitesCreate: 'data-api.world.satellites.create',
  eventsBatchUpsert: 'data-api.world.events.batch-upsert',
  eventsDelete: 'data-api.world.events.delete',
  lorebooksList: 'data-api.world.lorebooks.list',
  lorebooksBatchUpsert: 'data-api.world.lorebooks.batch-upsert',
  lorebooksDelete: 'data-api.world.lorebooks.delete',
  draftsList: 'data-api.world.drafts.list',
  worldsMine: 'data-api.world.worlds.mine',
  mutationsList: 'data-api.world.mutations.list',
  creatorAgentsList: 'data-api.creator.agents.list',
  creatorAgentsCreate: 'data-api.creator.agents.create',
  creatorAgentsBatchCreate: 'data-api.creator.agents.batch-create',
} as const;

export const CORE_DATA_API_CAPABILITIES = {
  friendsWithDetailsList: 'data-api.core.social.friends-with-details.list',
  userByIdGet: 'data-api.core.user.by-id.get',
  userByHandleGet: 'data-api.core.user.by-handle.get',
  worldByIdGet: 'data-api.core.world.by-id.get',
  worldviewByIdGet: 'data-api.core.worldview.by-id.get',
  agentMemoryRecallForEntity: 'data-api.core.agent.memory.recall.for-entity',
  agentMemoryCoreList: 'data-api.core.agent.memory.core.list',
  agentMemoryE2EList: 'data-api.core.agent.memory.e2e.list',
  agentMemoryStatsGet: 'data-api.core.agent.memory.stats.get',
} as const;

export const CORE_WORLD_DATA_CAPABILITY_SET = new Set<string>(
  [
    ...Object.values(WORLD_DATA_API_CAPABILITIES),
    ...Object.values(CORE_DATA_API_CAPABILITIES),
  ],
);
