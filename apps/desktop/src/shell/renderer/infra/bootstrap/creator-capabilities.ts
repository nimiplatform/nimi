import { WORLD_DATA_API_CAPABILITIES, toRecord } from './runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

type RealmRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

type RealmRequestSpec = {
  method: RealmRequestMethod;
  url: string;
  path?: Record<string, string | number | boolean>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

function toObjectOr<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  return value && typeof value === 'object' ? (value as T) : fallback;
}

function resolveRequestPath(
  url: string,
  pathParams?: Record<string, string | number | boolean>,
): string {
  let resolved = String(url || '').trim();
  for (const [key, value] of Object.entries(pathParams || {})) {
    resolved = resolved.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

async function requestRealm<T>(spec: RealmRequestSpec): Promise<T> {
  return withRuntimeOpenApiContext((realm) => realm.raw.request<T>({
    method: spec.method,
    path: resolveRequestPath(spec.url, spec.path),
    query: spec.query,
    body: spec.body,
    headers: spec.headers,
    timeoutMs: spec.timeoutMs,
  }));
}

export async function registerCreatorDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsList, async () => {
    const payload = await requestRealm<unknown>({
      method: 'GET',
      url: '/api/creator/agents',
    });
    return Array.isArray(payload) ? payload : [];
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsCreate, async (query) => {
    const payload = await requestRealm<unknown>({
      method: 'POST',
      url: '/api/creator/agents',
      body: toRecord(query),
    });
    return toObjectOr(payload, {});
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsBatchCreate, async (query) => {
    const record = toRecord(query);
    const items = Array.isArray(record.items) ? record.items : [];
    const payload = await requestRealm<unknown>({
      method: 'POST',
      url: '/api/creator/agents/batch-create',
      body: {
        items,
        continueOnError: record.continueOnError !== false,
      },
    });
    return toObjectOr(payload, { created: [], failed: [] });
  });
}
