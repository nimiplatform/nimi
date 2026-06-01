import {
  createRealmMasterAgent,
  loadRealmCreatorAgents,
  type CreateRealmMasterAgentInput,
  type RealmAgentProfileApiCaller,
} from '@nimiplatform/sdk/realm';
import { callRealmApi } from '@renderer/infra/realm/realm-api';

export type CreateMasterAgentInput = CreateRealmMasterAgentInput;

export async function createMasterAgent(
  callApi: RealmAgentProfileApiCaller,
  input: CreateMasterAgentInput,
): Promise<Record<string, unknown>> {
  return createRealmMasterAgent(callApi, input);
}

let inflightCreatorAgents: Promise<Record<string, unknown>[]> | null = null;

export async function loadCreatorAgents(
  callApi: RealmAgentProfileApiCaller,
): Promise<Record<string, unknown>[]> {
  if (inflightCreatorAgents) return inflightCreatorAgents;
  const task = loadRealmCreatorAgents(callApi).finally(() => { inflightCreatorAgents = null; });
  inflightCreatorAgents = task;
  return task;
}

export const realmAgentCreateData = {
  createAgent: (input: CreateMasterAgentInput) =>
    createMasterAgent(callRealmApi, input),
  loadMyAgents: () =>
    loadCreatorAgents(callRealmApi),
};
