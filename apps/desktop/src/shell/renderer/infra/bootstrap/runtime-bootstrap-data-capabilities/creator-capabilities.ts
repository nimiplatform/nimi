import { OpenAPI } from '@nimiplatform/sdk/realm';
import { openApiRequest } from '@nimiplatform/sdk/realm';
import { WORLD_DATA_API_CAPABILITIES, toRecord } from '../runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

function toObjectOr<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  return value && typeof value === 'object' ? (value as T) : fallback;
}

export async function registerCreatorDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsList, async () => {
    const payload = await withRuntimeOpenApiContext(() => openApiRequest<unknown>(OpenAPI, {
      method: 'GET',
      url: '/api/creator/agents',
    }));
    return Array.isArray(payload) ? payload : [];
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsCreate, async (query) => {
    const payload = await withRuntimeOpenApiContext(() => openApiRequest<unknown>(OpenAPI, {
      method: 'POST',
      url: '/api/creator/agents',
      body: toRecord(query),
      mediaType: 'application/json',
    }));
    return toObjectOr(payload, {});
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsBatchCreate, async (query) => {
    const record = toRecord(query);
    const items = Array.isArray(record.items) ? record.items : [];
    const payload = await withRuntimeOpenApiContext(() => openApiRequest<unknown>(OpenAPI, {
      method: 'POST',
      url: '/api/creator/agents/batch-create',
      body: {
        items,
        continueOnError: record.continueOnError !== false,
      },
      mediaType: 'application/json',
    }));
    return toObjectOr(payload, { created: [], failed: [] });
  });
}
