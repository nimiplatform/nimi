import type {
  RealmServiceArgs,
  RealmServiceMethod,
  RealmServiceName,
  RealmServiceResult,
} from '@nimiplatform/sdk/realm';
import { createStudioRealmClient } from '@renderer/data/realm-client.js';
import {
  normalizeOwnerPortfolio,
  normalizeOwnerPortfolioAgentDetail,
  type OwnerPortfolioAgent,
  type OwnerPortfolioAgentDetail,
} from './portfolio-data.js';
import {
  REALM_AGENT_CREATE_SOURCE,
  normalizeCreateRealmAgentDraft,
  normalizeRealmAgentHandleAvailability,
  normalizeSelectableWorlds,
  normalizeSelectedWorldPreview,
  type NormalizedRealmAgentHandleAvailability,
  type RealmAgentCreationWorldDto,
  type RealmCreateAgentInput,
  type ReviewedCreateRealmAgentPayload,
  type SelectableRealmWorld,
  type SelectedWorldPreview,
} from './create-agent-draft.js';

type StudioRealmMethod<
  Service extends RealmServiceName,
  Method extends RealmServiceMethod<Service>,
> = (...args: RealmServiceArgs<Service, Method>) => Promise<RealmServiceResult<Service, Method>>;

type StudioRealmClient = {
  services: {
    AgentsService: {
      agentControllerCheckHandle: StudioRealmMethod<'AgentsService', 'agentControllerCheckHandle'>;
      agentControllerCreate: StudioRealmMethod<'AgentsService', 'agentControllerCreate'>;
    };
    MeService: {
      getMyRealmAgent: StudioRealmMethod<'MeService', 'getMyRealmAgent'>;
      listMyRealmAgents: StudioRealmMethod<'MeService', 'listMyRealmAgents'>;
    };
    WorldsService: {
      worldControllerGetWorldDetailWithAgents: StudioRealmMethod<'WorldsService', 'worldControllerGetWorldDetailWithAgents'>;
      worldControllerListWorlds: StudioRealmMethod<'WorldsService', 'worldControllerListWorlds'>;
    };
  };
};

type RealmCreateAgentResponse = RealmServiceResult<'AgentsService', 'agentControllerCreate'>;
type RealmAgentHandleAvailabilityResponse = RealmServiceResult<'AgentsService', 'agentControllerCheckHandle'>;

export type RealmAgentCreateCanonicalFields = {
  id: string;
  state?: string;
};

export type RealmAgentCreateResult =
  | {
    ok: true;
    source: typeof REALM_AGENT_CREATE_SOURCE;
    agent: RealmCreateAgentResponse;
    canonical: RealmAgentCreateCanonicalFields;
  }
  | {
    ok: false;
    source: typeof REALM_AGENT_CREATE_SOURCE;
    failure: 'realm-create-agent-failed' | 'realm-create-agent-missing-canonical-id';
    message: string;
  };

export type RealmAgentHandleAvailabilityResult =
  | {
    ok: true;
    truthWrite: false;
    availability: NormalizedRealmAgentHandleAvailability;
    response: RealmAgentHandleAvailabilityResponse;
  }
  | {
    ok: false;
    truthWrite: false;
    failure: 'agent-handle-invalid' | 'realm-agent-handle-check-failed' | 'realm-agent-handle-check-invalid-response';
    message: string;
    availability: null;
  };

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function buildRealmCreateAgentInput(payload: ReviewedCreateRealmAgentPayload): RealmCreateAgentInput {
  const body = payload.body;
  return {
    handle: body.handle,
    displayName: body.displayName,
    worldId: body.worldId,
    concept: body.concept,
    ownershipType: 'MASTER_OWNED',
    ...(body.description ? { description: body.description } : {}),
    ...(body.rules
      ? {
        rules: {
          format: 'rule-lines-v1',
          lines: [...body.rules.lines],
          text: body.rules.text,
        },
      }
      : {}),
  };
}

export function normalizeRealmAgentCreateResult(agent: RealmCreateAgentResponse): RealmAgentCreateResult {
  if (!agent || typeof agent !== 'object') {
    return {
      ok: false,
      source: REALM_AGENT_CREATE_SOURCE,
      failure: 'realm-create-agent-missing-canonical-id',
      message: 'Realm Create Agent returned no agent object.',
    };
  }

  const record = agent as Record<string, unknown>;
  const id = readOptionalString(record, 'id');
  if (!id) {
    return {
      ok: false,
      source: REALM_AGENT_CREATE_SOURCE,
      failure: 'realm-create-agent-missing-canonical-id',
      message: 'Realm Create Agent returned no canonical agent id.',
    };
  }

  const state = readOptionalString(record, 'state');
  return {
    ok: true,
    source: REALM_AGENT_CREATE_SOURCE,
    agent,
    canonical: {
      id,
      ...(state ? { state } : {}),
    },
  };
}
export async function listOwnerPortfolioAgents(realm: StudioRealmClient = createStudioRealmClient()): Promise<OwnerPortfolioAgent[]> {
  const agents = await realm.services.MeService.listMyRealmAgents();
  return normalizeOwnerPortfolio(agents);
}

export async function getOwnerPortfolioAgentDetail(
  agentId: string,
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<OwnerPortfolioAgentDetail> {
  const agent = await realm.services.MeService.getMyRealmAgent(agentId);
  return normalizeOwnerPortfolioAgentDetail(agent);
}

export async function listCreateRealmAgentSelectableWorlds(
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<SelectableRealmWorld[]> {
  const worlds = await realm.services.WorldsService.worldControllerListWorlds();
  return normalizeSelectableWorlds(worlds as RealmAgentCreationWorldDto[]);
}

export async function getCreateRealmAgentWorldPreview(
  worldId: string,
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<SelectedWorldPreview> {
  const world = await realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(worldId, 4);
  return normalizeSelectedWorldPreview(world);
}

export async function checkCreateRealmAgentHandleAvailability(
  handle: string,
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<RealmAgentHandleAvailabilityResult> {
  const normalizedHandle = normalizeCreateRealmAgentDraft({
    handle,
    displayName: '',
    publicBio: '',
    concept: '',
    description: '',
    ruleText: '',
    selectedWorldId: '',
  }).handle;
  if (!normalizedHandle) {
    return {
      ok: false,
      truthWrite: false,
      failure: 'agent-handle-invalid',
      message: 'Agent handle check requires a non-empty normalized handle.',
      availability: null,
    };
  }

  try {
    const response = await realm.services.AgentsService.agentControllerCheckHandle(normalizedHandle);
    if (!response || typeof response !== 'object' || typeof (response as Record<string, unknown>).available !== 'boolean') {
      return {
        ok: false,
        truthWrite: false,
        failure: 'realm-agent-handle-check-invalid-response',
        message: 'Realm handle availability check did not return an availability boolean.',
        availability: null,
      };
    }
    return {
      ok: true,
      truthWrite: false,
      availability: normalizeRealmAgentHandleAvailability(normalizedHandle, response),
      response,
    };
  } catch (error) {
    return {
      ok: false,
      truthWrite: false,
      failure: 'realm-agent-handle-check-failed',
      message: error instanceof Error ? error.message : 'Realm handle availability check failed.',
      availability: null,
    };
  }
}

export async function createReviewedRealmAgent(
  payload: ReviewedCreateRealmAgentPayload,
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<RealmAgentCreateResult> {
  try {
    const agent = await realm.services.AgentsService.agentControllerCreate(buildRealmCreateAgentInput(payload));
    return normalizeRealmAgentCreateResult(agent);
  } catch (error) {
    return {
      ok: false,
      source: REALM_AGENT_CREATE_SOURCE,
      failure: 'realm-create-agent-failed',
      message: error instanceof Error ? error.message : 'Realm Create Agent failed.',
    };
  }
}

export * from './portfolio-media-client.js';
export * from './portfolio-post-client.js';
export * from './portfolio-settings-client.js';
