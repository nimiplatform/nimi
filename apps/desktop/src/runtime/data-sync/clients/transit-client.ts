import type { Realm } from '@nimiplatform/sdk/realm';

type TransitType = 'INBOUND' | 'OUTBOUND' | 'RETURN';
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
  transitType?: TransitType;
} {
  const agentId = String(input?.agentId || '').trim();
  return {
    agentId: agentId || undefined,
    status: input?.status,
    transitType: input?.transitType,
  };
}

export async function fetchSceneQuota(realm: Realm): Promise<unknown> {
  return realm.raw.request<unknown>({
    method: 'GET',
    path: '/api/world/me/scene-quota',
  });
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
  return realm.raw.request<unknown>({
    method: 'POST',
    path: '/api/world/transit',
    body: {
      agentId,
      fromWorldId: String(input.fromWorldId || '').trim() || undefined,
      toWorldId,
      transitType: input.transitType,
      reason: String(input.reason || '').trim() || undefined,
      carriedState: input.carriedState,
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
  return realm.raw.request<unknown>({
    method: 'GET',
    path: '/api/world/transit',
    query: normalizeTransitQuery(query),
  });
}

export async function fetchTransitById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.raw.request<unknown>({
    method: 'GET',
    path: `/api/world/transit/${encodeURIComponent(id)}`,
  });
}

export async function fetchActiveTransit(realm: Realm, agentId: string): Promise<unknown> {
  const normalizedAgentId = assertNonEmpty(agentId, 'TRANSIT_CLIENT_AGENT_ID_REQUIRED');
  return realm.raw.request<unknown>({
    method: 'GET',
    path: `/api/world/transit/active/${encodeURIComponent(normalizedAgentId)}`,
  });
}

export async function startTransitSessionById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.raw.request<unknown>({
    method: 'POST',
    path: `/api/world/transit/${encodeURIComponent(id)}/session/start`,
  });
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
  return realm.raw.request<unknown>({
    method: 'POST',
    path: `/api/world/transit/${encodeURIComponent(transitId)}/checkpoints`,
    body: {
      name,
      status: input.status,
      data: input.data,
    },
  });
}

export async function completeTransitById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.raw.request<unknown>({
    method: 'POST',
    path: `/api/world/transit/${encodeURIComponent(id)}/complete`,
  });
}

export async function abandonTransitById(realm: Realm, transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return realm.raw.request<unknown>({
    method: 'POST',
    path: `/api/world/transit/${encodeURIComponent(id)}/abandon`,
  });
}
