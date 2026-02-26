import { OpenAPI } from '@nimiplatform/sdk/realm';
import { openApiRequest } from '@nimiplatform/sdk/realm';

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

export async function fetchSceneQuota(): Promise<unknown> {
  return openApiRequest<unknown>(OpenAPI, {
    method: 'GET',
    url: '/api/world/me/scene-quota',
  });
}

export async function createTransit(input: {
  agentId: string;
  fromWorldId?: string;
  toWorldId: string;
  transitType: TransitType;
  reason?: string;
  carriedState?: Record<string, unknown>;
}): Promise<unknown> {
  const agentId = assertNonEmpty(input.agentId, 'TRANSIT_CLIENT_AGENT_ID_REQUIRED');
  const toWorldId = assertNonEmpty(input.toWorldId, 'TRANSIT_CLIENT_WORLD_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'POST',
    url: '/api/world/transit',
    body: {
      agentId,
      fromWorldId: String(input.fromWorldId || '').trim() || undefined,
      toWorldId,
      transitType: input.transitType,
      reason: String(input.reason || '').trim() || undefined,
      carriedState: input.carriedState,
    },
    mediaType: 'application/json',
  });
}

export async function listTransits(query?: {
  agentId?: string;
  status?: TransitStatus;
  transitType?: TransitType;
}): Promise<unknown> {
  return openApiRequest<unknown>(OpenAPI, {
    method: 'GET',
    url: '/api/world/transit',
    query: normalizeTransitQuery(query),
  });
}

export async function fetchTransitById(transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'GET',
    url: '/api/world/transit/{id}',
    path: { id },
  });
}

export async function fetchActiveTransit(agentId: string): Promise<unknown> {
  const normalizedAgentId = assertNonEmpty(agentId, 'TRANSIT_CLIENT_AGENT_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'GET',
    url: '/api/world/transit/active/{agentId}',
    path: { agentId: normalizedAgentId },
  });
}

export async function startTransitSessionById(transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'POST',
    url: '/api/world/transit/{id}/session/start',
    path: { id },
  });
}

export async function appendTransitCheckpoint(input: {
  transitId: string;
  name: string;
  status: TransitCheckpointStatus;
  data?: Record<string, unknown>;
}): Promise<unknown> {
  const transitId = assertNonEmpty(input.transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  const name = assertNonEmpty(input.name, 'TRANSIT_CLIENT_CHECKPOINT_NAME_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'POST',
    url: '/api/world/transit/{id}/checkpoints',
    path: { id: transitId },
    body: {
      name,
      status: input.status,
      data: input.data,
    },
    mediaType: 'application/json',
  });
}

export async function completeTransitById(transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'POST',
    url: '/api/world/transit/{id}/complete',
    path: { id },
  });
}

export async function abandonTransitById(transitId: string): Promise<unknown> {
  const id = assertNonEmpty(transitId, 'TRANSIT_CLIENT_TRANSIT_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'POST',
    url: '/api/world/transit/{id}/abandon',
    path: { id },
  });
}
