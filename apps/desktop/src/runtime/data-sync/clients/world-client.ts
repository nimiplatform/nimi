import { OpenAPI } from '@nimiplatform/sdk-realm/core/OpenAPI';
import { request as openApiRequest } from '@nimiplatform/sdk-realm/core/request';

function assertNonEmpty(value: string, code: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 20;
  }
  return Math.min(Math.floor(limit), 100);
}

export async function fetchWorldById(worldId: string): Promise<unknown> {
  const id = assertNonEmpty(worldId, 'WORLD_CLIENT_WORLD_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'GET',
    url: '/api/world/by-id/{id}',
    path: { id },
  });
}

export async function fetchWorldLevelAudits(input: {
  worldId: string;
  limit?: number;
}): Promise<unknown> {
  const id = assertNonEmpty(input.worldId, 'WORLD_CLIENT_WORLD_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'GET',
    url: '/api/world/by-id/{id}/level/audits',
    path: { id },
    query: { limit: normalizeLimit(Number(input.limit || 20)) },
  });
}

export async function fetchWorldview(worldId: string): Promise<unknown> {
  const id = assertNonEmpty(worldId, 'WORLD_CLIENT_WORLD_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'GET',
    url: '/api/world/by-id/{id}/worldview',
    path: { id },
  });
}

export async function fetchWorldviewEvents(input: {
  worldId: string;
  offset?: number;
  limit?: number;
}): Promise<unknown> {
  const id = assertNonEmpty(input.worldId, 'WORLD_CLIENT_WORLD_ID_REQUIRED');
  const offset = Number.isFinite(input.offset) && Number(input.offset) >= 0
    ? Math.floor(Number(input.offset))
    : 0;
  const limit = Number.isFinite(input.limit) && Number(input.limit) > 0
    ? Math.min(Math.floor(Number(input.limit)), 200)
    : 50;
  return openApiRequest<unknown>(OpenAPI, {
    method: 'GET',
    url: '/api/world/by-id/{id}/worldview/events',
    path: { id },
    query: { offset, limit },
  });
}

export async function fetchWorldviewSnapshots(worldId: string): Promise<unknown> {
  const id = assertNonEmpty(worldId, 'WORLD_CLIENT_WORLD_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'GET',
    url: '/api/world/by-id/{id}/worldview/snapshots',
    path: { id },
  });
}

export async function requestWorldTransitGate(worldId: string): Promise<unknown> {
  const id = assertNonEmpty(worldId, 'WORLD_CLIENT_WORLD_ID_REQUIRED');
  return openApiRequest<unknown>(OpenAPI, {
    method: 'POST',
    url: '/api/world/by-id/{id}/transit',
    path: { id },
  });
}
