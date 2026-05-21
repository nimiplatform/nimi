import type { RealmServiceArgs, RealmServiceResult } from '@nimiplatform/sdk/realm';

export type RealmAgentCreationWorldDto = RealmServiceResult<'WorldsService', 'worldControllerListWorlds'>[number];
export type RealmAgentCreationWorldDetailDto = RealmServiceResult<'WorldsService', 'worldControllerGetWorldDetailWithAgents'>;
export type RealmCreateAgentInput = RealmServiceArgs<'AgentsService', 'agentControllerCreate'>[0];
export type RealmAgentHandleAvailabilityDto = RealmServiceResult<'AgentsService', 'agentControllerCheckHandle'>;
type RealmCreateAgentRulesInput = NonNullable<RealmCreateAgentInput['rules']>;

export const REALM_AGENT_CREATE_SOURCE = 'Realm AgentsService.agentControllerCreate';
export const REALM_AGENT_CREATE_PATH = 'POST /api/agent';
export const REALM_AGENT_HANDLE_CHECK_SOURCE = 'Realm AgentsService.agentControllerCheckHandle';
export const REALM_AGENT_HANDLE_CHECK_PATH = 'GET /api/agent/handles/check';

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

export type ReviewedRealmCreateAgentInput = {
  handle: string;
  displayName: string;
  worldId: string;
  concept: string;
  ownershipType: 'MASTER_OWNED';
  description?: string;
  rules?: RealmCreateAgentRulesInput;
};

export type ReviewedCreateRealmAgentPayload = {
  source: typeof REALM_AGENT_CREATE_SOURCE;
  path: typeof REALM_AGENT_CREATE_PATH;
  publicFields: {
    handle: string;
    displayName: string;
    publicBio?: string;
    concept?: string;
    description?: string;
    rulesText?: string;
  };
  body: ReviewedRealmCreateAgentInput;
};

export type CreateRealmAgentReadiness =
  | {
    ready: false;
    errors: string[];
    source: typeof REALM_AGENT_CREATE_SOURCE;
    payload: null;
  }
  | {
    ready: true;
    errors: [];
    source: typeof REALM_AGENT_CREATE_SOURCE;
    payload: ReviewedCreateRealmAgentPayload;
  };

export type CreateRealmAgentReadinessOptions = {
  selectableWorldIds?: string[];
  handleAvailability?: NormalizedRealmAgentHandleAvailability | null | undefined;
};

export type NormalizedRealmAgentHandleAvailability =
  | {
    checked: true;
    source: typeof REALM_AGENT_HANDLE_CHECK_SOURCE;
    handle: string;
    normalized: string;
    available: true;
    message?: string;
  }
  | {
    checked: true;
    source: typeof REALM_AGENT_HANDLE_CHECK_SOURCE;
    handle: string;
    normalized: string;
    available: false;
    message: string;
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

export function normalizeRealmAgentHandleAvailability(
  handle: string,
  response: RealmAgentHandleAvailabilityDto,
): NormalizedRealmAgentHandleAvailability {
  const normalized = readString(response.normalized) || normalizeHandle(handle);
  if (response.available) {
    return {
      checked: true,
      source: REALM_AGENT_HANDLE_CHECK_SOURCE,
      handle: normalizeHandle(handle),
      normalized,
      available: true,
      ...(response.message ? { message: response.message } : {}),
    };
  }

  return {
    checked: true,
    source: REALM_AGENT_HANDLE_CHECK_SOURCE,
    handle: normalizeHandle(handle),
    normalized,
    available: false,
    message: response.message || 'Realm reported this agent handle is unavailable.',
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

export function validateCreateRealmAgentReadiness(
  input: CreateRealmAgentDraftInput,
  options: CreateRealmAgentReadinessOptions = {},
): CreateRealmAgentReadiness {
  const draft = normalizeCreateRealmAgentDraft(input);
  const errors: string[] = [];
  const selectableWorldIds = options.selectableWorldIds
    ? new Set(options.selectableWorldIds.map((worldId) => worldId.trim()).filter(Boolean))
    : null;
  const handleAvailability = options.handleAvailability;

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
  if (draft.selectedWorldId && selectableWorldIds && !selectableWorldIds.has(draft.selectedWorldId)) {
    errors.push('selected world not source-backed by WorldsService.worldControllerListWorlds');
  }
  if (draft.handle) {
    if (!handleAvailability) {
      errors.push('handle availability not checked by AgentsService.agentControllerCheckHandle');
    } else if (handleAvailability.handle !== draft.handle && handleAvailability.normalized !== draft.handle) {
      errors.push('handle availability not checked for the current normalized handle');
    } else if (!handleAvailability.available) {
      errors.push(`handle unavailable: ${handleAvailability.message}`);
    }
  }

  if (errors.length > 0) {
    return {
      ready: false,
      errors,
      source: REALM_AGENT_CREATE_SOURCE,
      payload: null,
    };
  }

  const ruleLines = normalizeRuleLines(draft.ruleText);
  const body: ReviewedRealmCreateAgentInput = {
    handle: draft.handle,
    displayName: draft.displayName,
    worldId: draft.selectedWorldId,
    concept: draft.concept,
    ownershipType: 'MASTER_OWNED',
    ...(draft.description ? { description: draft.description } : {}),
    ...(ruleLines.length > 0 ? { rules: { format: 'rule-lines-v1', lines: ruleLines, text: draft.ruleText } } : {}),
  };

  return {
    ready: true,
    errors: [],
    source: REALM_AGENT_CREATE_SOURCE,
    payload: {
      source: REALM_AGENT_CREATE_SOURCE,
      path: REALM_AGENT_CREATE_PATH,
      publicFields: {
        handle: draft.handle,
        displayName: draft.displayName,
        ...(draft.publicBio ? { publicBio: draft.publicBio } : {}),
        ...(draft.concept ? { concept: draft.concept } : {}),
        ...(draft.description ? { description: draft.description } : {}),
        ...(draft.ruleText ? { rulesText: draft.ruleText } : {}),
      },
      body,
    },
  };
}
