import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';
import { WORLD_DATA_API_CAPABILITIES, toRecord } from './runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

function toObjectOr<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  return value && typeof value === 'object' ? (value as T) : fallback;
}

type CreatorAgentCreateInput = RealmServiceArgs<'CreatorService', 'creatorControllerCreateAgent'>[0];
type CreatorAgentUpdateInput = RealmServiceArgs<'CreatorService', 'creatorControllerUpdateAgent'>[1];
type CreatorAgentBatchCreateInput = RealmServiceArgs<'CreatorService', 'creatorControllerBatchCreateAgents'>[0];

export async function registerCreatorDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsList, async () => {
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.CreatorService.creatorControllerListAgents()
    ));
    return Array.isArray(payload) ? payload : [];
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsGet, async (query) => {
    const agentId = String(toRecord(query).agentId || '').trim();
    if (!agentId) {
      return null;
    }
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.CreatorService.creatorControllerGetAgent(agentId)
    ));
    return toObjectOr(payload, {});
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsCreate, async (query) => {
    const input = toObjectOr(query, {} as Record<string, unknown>) as CreatorAgentCreateInput;
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.CreatorService.creatorControllerCreateAgent(input)
    ));
    return toObjectOr(payload, {});
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsUpdate, async (query) => {
    const record = toRecord(query);
    const agentId = String(record.agentId || '').trim();
    if (!agentId) {
      throw new Error('CREATOR_AGENT_ID_REQUIRED');
    }
    const patch = toObjectOr(record.patch, {} as Record<string, unknown>) as CreatorAgentUpdateInput;
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.CreatorService.creatorControllerUpdateAgent(agentId, patch)
    ));
    return toObjectOr(payload, {});
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsBatchCreate, async (query) => {
    const record = toRecord(query);
    const items = Array.isArray(record.items) ? record.items : [];
    const input = {
      items,
      continueOnError: record.continueOnError !== false,
    } as CreatorAgentBatchCreateInput;
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.CreatorService.creatorControllerBatchCreateAgents(input)
    ));
    return toObjectOr(payload, { created: [], failed: [] });
  });
}
