export function normalizeLocalEngine(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'media') return 'media';
  if (normalized === 'speech') return 'speech';
  if (normalized === 'sidecar') return 'sidecar';
  return 'llama';
}

export function normalizeLocalModelRoot(value: unknown): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('llama/')) return trimmed.slice('llama/'.length).trim();
  if (lower.startsWith('media/')) return trimmed.slice('media/'.length).trim();
  if (lower.startsWith('speech/')) return trimmed.slice('speech/'.length).trim();
  if (lower.startsWith('sidecar/')) return trimmed.slice('sidecar/'.length).trim();
  if (lower.startsWith('local/')) return trimmed.slice('local/'.length).trim();
  return trimmed;
}

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

export function requireRecord(input: unknown, code: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(code);
  }
  return input as Record<string, unknown>;
}

export function requireObjectPayload<T extends Record<string, unknown>>(input: unknown, code: string): T {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(code);
  }
  return input as T;
}

export function requireItemsPayload<T extends { items: unknown[] }>(input: unknown, code: string): T {
  const payload = requireObjectPayload<Record<string, unknown>>(input, code);
  if (!Array.isArray(payload.items)) {
    throw new Error(code);
  }
  return payload as T;
}

export function requireObjectArray<T extends Record<string, unknown>>(input: unknown, code: string): T[] {
  if (!Array.isArray(input)) {
    throw new Error(code);
  }
  if (input.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(code);
  }
  return input as T[];
}

export const WORLD_DATA_API_CAPABILITIES = {
  accessMe: 'data-api.world.access.me',
  oasisGet: 'data-api.world.oasis.get',
  landingResolve: 'data-api.world.landing.resolve',
  draftCreate: 'data-api.world.draft.create',
  draftGet: 'data-api.world.draft.get',
  draftUpdate: 'data-api.world.draft.update',
  draftPublish: 'data-api.world.draft.publish',
  stateGet: 'data-api.world.state.get',
  stateCommit: 'data-api.world.state.commit',
  historyList: 'data-api.world.history.list',
  scenesList: 'data-api.world.scenes.list',
  historyAppend: 'data-api.world.history.append',
  lorebooksList: 'data-api.world.lorebooks.list',
  mediaBindingsList: 'data-api.world.media-bindings.list',
  draftsList: 'data-api.world.drafts.list',
  worldsMine: 'data-api.world.worlds.mine',
  creatorAgentsList: 'data-api.creator.agents.list',
  creatorAgentsGet: 'data-api.creator.agents.get',
  creatorAgentsCreate: 'data-api.creator.agents.create',
  creatorAgentsUpdate: 'data-api.creator.agents.update',
  creatorAgentsBatchCreate: 'data-api.creator.agents.batch-create',
} as const;

export const CORE_DATA_API_CAPABILITIES = {
  friendsWithDetailsList: 'data-api.core.social.friends-with-details.list',
  userByIdGet: 'data-api.core.user.by-id.get',
  userByHandleGet: 'data-api.core.user.by-handle.get',
  worldByIdGet: 'data-api.core.world.by-id.get',
  worldviewByIdGet: 'data-api.core.worldview.by-id.get',
  agentChatRouteResolve: 'data-api.core.agent.chat.route.resolve',
  agentMemoryCoreList: 'data-api.core.agent.memory.core.list',
  agentMemoryDyadicList: 'data-api.core.agent.memory.dyadic.list',
  agentMemoryProfilesList: 'data-api.core.agent.memory.profiles.list',
} as const;

export const CORE_WORLD_DATA_CAPABILITY_SET = new Set<string>(
  [
    ...Object.values(WORLD_DATA_API_CAPABILITIES),
    ...Object.values(CORE_DATA_API_CAPABILITIES),
  ],
);
