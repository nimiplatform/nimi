import type { Realm, RealmServiceArgs } from '@nimiplatform/sdk/realm';

type TransitRequestType = RealmServiceArgs<'WorldsService', 'worldControllerTransitToWorld'>[1]['transitType'];
type TransitQueryType = RealmServiceArgs<'TransitsService', 'transitControllerListTransits'>[2];
type TransitType = TransitRequestType | 'RETURN';
type TransitStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';

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

export async function createTransit(
  realm: Realm,
  input: {
    agentId: string;
    fromWorldId?: string;
    toWorldId: string;
    transitType: TransitType;
    reason?: string;
    context?: Record<string, unknown>;
  },
): Promise<unknown> {
  const agentId = assertNonEmpty(input.agentId, 'TRANSIT_CLIENT_AGENT_ID_REQUIRED');
  const toWorldId = assertNonEmpty(input.toWorldId, 'TRANSIT_CLIENT_WORLD_ID_REQUIRED');
  return realm.services.WorldsService.worldControllerTransitToWorld(toWorldId, {
    agentId,
    fromWorldId: String(input.fromWorldId || '').trim() || undefined,
    transitType: assertTransitRequestType(input.transitType),
    context: {
      ...(String(input.reason || '').trim() ? { reason: String(input.reason || '').trim() } : {}),
      ...(input.context ? { handoffRefs: input.context } : {}),
    },
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

export async function completeTransitById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.services.TransitsService.transitControllerComplete(id);
}

export async function abandonTransitById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.services.TransitsService.transitControllerAbandon(id);
}
