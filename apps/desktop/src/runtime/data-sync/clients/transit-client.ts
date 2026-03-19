import type { Realm, RealmServiceArgs } from '@nimiplatform/sdk/realm';

type TransitRequestType = RealmServiceArgs<'TransitsService', 'transitControllerCreateTransit'>[0]['transitType'];
type TransitQueryType = RealmServiceArgs<'TransitsService', 'transitControllerListTransits'>[2];
type TransitType = TransitRequestType | 'RETURN';
type TransitStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
type TransitCheckpointStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

function assertNonEmpty(value: string, code: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function normalizeTransitQuery(input: {
  agentId?: string;
  status?: TransitStatus;
  transitType?: TransitType;
} | undefined): {
  agentId?: string;
  status?: TransitStatus;
  transitType?: TransitQueryType;
} {
  const agentId = String(input?.agentId || '').trim();
  return {
    agentId: agentId || undefined,
    status: input?.status,
    transitType: toTransitRequestType(input?.transitType),
  };
}

function toTransitRequestType(value: TransitType | undefined): TransitRequestType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'RETURN') {
    throw new Error('TRANSIT_CLIENT_TRANSIT_TYPE_INVALID');
  }
  return value;
}

function assertTransitRequestType(value: TransitType): TransitRequestType {
  const normalized = toTransitRequestType(value);
  if (!normalized) {
    throw new Error('TRANSIT_CLIENT_TRANSIT_TYPE_REQUIRED');
  }
  return normalized;
}

export async function fetchSceneQuota(realm: Realm): Promise<unknown> {
  return realm.services.WorldsService.worldControllerGetSceneQuota();
}

export async function createTransit(
  realm: Realm,
  input: {
    agentId: string;
    fromWorldId?: string;
    toWorldId: string;
    transitType: TransitType;
    reason?: string;
    carriedState?: Record<string, unknown>;
  },
): Promise<unknown> {
  const agentId = assertNonEmpty(input.agentId, 'TRANSIT_CLIENT_AGENT_ID_REQUIRED');
  const toWorldId = assertNonEmpty(input.toWorldId, 'TRANSIT_CLIENT_WORLD_ID_REQUIRED');
  return realm.services.TransitsService.transitControllerCreateTransit({
    agentId,
    fromWorldId: String(input.fromWorldId || '').trim() || undefined,
    toWorldId,
    transitType: assertTransitRequestType(input.transitType),
    reason: String(input.reason || '').trim() || undefined,
    carriedState: input.carriedState,
  });
}

export async function listTransits(
  realm: Realm,
  query?: {
    agentId?: string;
    status?: TransitStatus;
    transitType?: TransitType;
  },
): Promise<unknown> {
  const normalized = normalizeTransitQuery(query);
  return realm.services.TransitsService.transitControllerListTransits(
    normalized.agentId,
    normalized.status,
    normalized.transitType,
  );
}

export async function fetchTransitById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.services.TransitsService.transitControllerGetTransit(id);
}

export async function fetchActiveTransit(realm: Realm, agentId: string): Promise<unknown> {
  const normalizedAgentId = assertNonEmpty(agentId, 'TRANSIT_CLIENT_AGENT_ID_REQUIRED');
  return realm.services.TransitsService.transitControllerGetActiveTransit(normalizedAgentId);
}

export async function startTransitSessionById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.services.TransitsService.transitControllerStartSession(id);
}

export async function appendTransitCheckpoint(
  realm: Realm,
  input: {
    transitId: string;
    name: string;
    status: TransitCheckpointStatus;
    data?: Record<string, unknown>;
  },
): Promise<unknown> {
  const transitId = assertNonEmpty(input.transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  const name = assertNonEmpty(input.name, 'TRANSIT_CLIENT_CHECKPOINT_NAME_REQUIRED');
  return realm.services.TransitsService.transitControllerAddCheckpoint(transitId, {
    name,
    status: input.status,
    data: input.data,
  });
}

export async function completeTransitById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.services.TransitsService.transitControllerComplete(id);
}

export async function abandonTransitById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.services.TransitsService.transitControllerAbandon(id);
}
