import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

export type RealmAgentCreationWorldDto = RealmServiceResult<'WorldsService', 'worldControllerListWorlds'>[number];
export type RealmAgentCreationWorldDetailDto = RealmServiceResult<'WorldsService', 'worldControllerGetWorldDetailWithAgents'>;

export const CREATE_REALM_AGENT_BLOCKED_REASON = 'Missing admitted Studio create write contract for owner-created scope, OASIS defaulting, selected-world detail/rules, and public Realm Agent composition.';

export type CreateRealmAgentDraftInput = {
  handle: string;
  displayName: string;
  publicBio: string;
  concept: string;
  description: string;
  ruleText: string;
  selectedWorldId: string;
};

export type NormalizedCreateRealmAgentDraft = {
  handle: string;
  displayName: string;
  publicBio: string;
  concept: string;
  description: string;
  ruleText: string;
  selectedWorldId: string;
};

export type SelectableRealmWorld = {
  id: string;
  name: string;
  type: string | null;
  status: string | null;
  description: string;
  tagline: string;
  source: 'Realm WorldsService.worldControllerListWorlds';
};

export type SelectedWorldPreview = {
  id: string;
  name: string;
  type: string | null;
  status: string | null;
  contentRating: string | null;
  tagline: string;
  description: string;
  overview: string;
  themes: string[];
  agentCount: number | null;
  nativeCreationState: string | null;
  source: 'Realm WorldsService.worldControllerGetWorldDetailWithAgents';
};

export type CandidateCreateRealmAgentPayload = {
  candidate: true;
  source: 'realm-agent-studio.local-create-agent-draft';
  blocked: true;
  blockedReason: typeof CREATE_REALM_AGENT_BLOCKED_REASON;
  publicFields: {
    handle: string;
    displayName: string;
    publicBio?: string;
    concept?: string;
    description?: string;
    rulesText?: string;
  };
  realmCreateAgentCandidate: {
    handle: string;
    displayName: string;
    worldId: string;
    concept: string;
    description?: string;
    rules?: {
      format: 'rule-lines-v1';
      lines: string[];
      text: string;
    };
  };
};

export type CreateRealmAgentReadiness =
  | {
    ready: false;
    errors: string[];
    blockedReason: typeof CREATE_REALM_AGENT_BLOCKED_REASON;
    payload: null;
  }
  | {
    ready: true;
    errors: [];
    blockedReason: typeof CREATE_REALM_AGENT_BLOCKED_REASON;
    payload: CandidateCreateRealmAgentPayload;
  };

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@+/, '').toLocaleLowerCase();
}

function normalizeRuleLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeCreateRealmAgentDraft(input: CreateRealmAgentDraftInput): NormalizedCreateRealmAgentDraft {
  return {
    handle: normalizeHandle(input.handle),
    displayName: input.displayName.trim(),
    publicBio: input.publicBio.trim(),
    concept: input.concept.trim(),
    description: input.description.trim(),
    ruleText: input.ruleText.trim(),
    selectedWorldId: input.selectedWorldId.trim(),
  };
}

export function normalizeSelectableWorld(world: RealmAgentCreationWorldDto): SelectableRealmWorld {
  return {
    id: world.id,
    name: world.name,
    type: readString(world.type) || null,
    status: readString(world.status) || null,
    description: readString(world.description) || '',
    tagline: readString(world.tagline) || readString(world.motto) || '',
    source: 'Realm WorldsService.worldControllerListWorlds',
  };
}

export function normalizeSelectableWorlds(worlds: RealmAgentCreationWorldDto[]): SelectableRealmWorld[] {
  return worlds.map(normalizeSelectableWorld);
}

export function selectOasisDefaultWorld(worlds: SelectableRealmWorld[]): SelectableRealmWorld | null {
  return worlds.find((world) => world.type === 'OASIS')
    || worlds.find((world) => world.id.toLocaleLowerCase() === 'oasis')
    || worlds.find((world) => world.name.toLocaleLowerCase() === 'oasis')
    || null;
}

export function normalizeSelectedWorldPreview(world: RealmAgentCreationWorldDetailDto): SelectedWorldPreview {
  const record = readRecord(world);
  const themes = Array.isArray(world.themes)
    ? world.themes.filter((theme): theme is string => typeof theme === 'string' && theme.length > 0)
    : [];

  return {
    id: world.id,
    name: world.name,
    type: readString(world.type) || null,
    status: readString(world.status) || null,
    contentRating: readString(world.contentRating) || null,
    tagline: readString(world.tagline) || readString(world.motto) || '',
    description: readString(world.description) || '',
    overview: readString(world.overview) || '',
    themes,
    agentCount: typeof world.agentCount === 'number' && Number.isFinite(world.agentCount) ? world.agentCount : null,
    nativeCreationState: readString(record?.nativeCreationState) || null,
    source: 'Realm WorldsService.worldControllerGetWorldDetailWithAgents',
  };
}

export function validateCreateRealmAgentReadiness(input: CreateRealmAgentDraftInput): CreateRealmAgentReadiness {
  const draft = normalizeCreateRealmAgentDraft(input);
  const errors: string[] = [];

  if (!draft.handle) {
    errors.push('handle missing');
  }
  if (!draft.displayName) {
    errors.push('display name missing');
  }
  if (!draft.concept) {
    errors.push('concept missing');
  }
  if (!draft.selectedWorldId) {
    errors.push('selected world missing');
  }

  if (errors.length > 0) {
    return {
      ready: false,
      errors,
      blockedReason: CREATE_REALM_AGENT_BLOCKED_REASON,
      payload: null,
    };
  }

  return {
    ready: true,
    errors: [],
    blockedReason: CREATE_REALM_AGENT_BLOCKED_REASON,
    payload: {
      candidate: true,
      source: 'realm-agent-studio.local-create-agent-draft',
      blocked: true,
      blockedReason: CREATE_REALM_AGENT_BLOCKED_REASON,
      publicFields: {
        handle: draft.handle,
        displayName: draft.displayName,
        ...(draft.publicBio ? { publicBio: draft.publicBio } : {}),
        ...(draft.concept ? { concept: draft.concept } : {}),
        ...(draft.description ? { description: draft.description } : {}),
        ...(draft.ruleText ? { rulesText: draft.ruleText } : {}),
      },
      realmCreateAgentCandidate: {
        handle: draft.handle,
        displayName: draft.displayName,
        worldId: draft.selectedWorldId,
        concept: draft.concept,
        ...(draft.description ? { description: draft.description } : {}),
        ...(draft.ruleText ? { rules: { format: 'rule-lines-v1', lines: normalizeRuleLines(draft.ruleText), text: draft.ruleText } } : {}),
      },
    },
  };
}
