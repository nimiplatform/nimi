import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';
import {
  WORLD_DATA_API_CAPABILITIES,
  requireObjectArray,
  requireObjectPayload,
  requireRecord,
  toRecord,
} from './runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

type CreatorAgentCreateInput = RealmServiceArgs<'CreatorService', 'creatorControllerCreateAgent'>[0];
type CreatorAgentUpdateInput = RealmServiceArgs<'CreatorService', 'creatorControllerUpdateAgent'>[1];
type CreatorAgentBatchCreateInput = RealmServiceArgs<'CreatorService', 'creatorControllerBatchCreateAgents'>[0];

export async function registerCreatorDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsList, async () => {
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.CreatorService.creatorControllerListAgents()
    ));
    return requireObjectArray(payload, 'CREATOR_AGENT_LIST_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsGet, async (query) => {
    const agentId = String(toRecord(query).agentId || '').trim();
    if (!agentId) {
      throw new Error('CREATOR_AGENT_ID_REQUIRED');
    }
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.CreatorService.creatorControllerGetAgent(agentId)
    ));
    return requireObjectPayload(payload, 'CREATOR_AGENT_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsCreate, async (query) => {
    const input = requireRecord(query, 'CREATOR_AGENT_CREATE_INPUT_REQUIRED') as CreatorAgentCreateInput;
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.CreatorService.creatorControllerCreateAgent(input)
    ));
    return requireObjectPayload(payload, 'CREATOR_AGENT_CREATE_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.creatorAgentsUpdate, async (query) => {
    const record = toRecord(query);
    const agentId = String(record.agentId || '').trim();
    if (!agentId) {
      throw new Error('CREATOR_AGENT_ID_REQUIRED');
    }
    const patch = requireRecord(record.patch, 'CREATOR_AGENT_PATCH_REQUIRED') as CreatorAgentUpdateInput;
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.CreatorService.creatorControllerUpdateAgent(agentId, patch)
    ));
    return requireObjectPayload(payload, 'CREATOR_AGENT_UPDATE_CONTRACT_INVALID');
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
    return requireObjectPayload(payload, 'CREATOR_AGENT_BATCH_CREATE_CONTRACT_INVALID');
  });
}
