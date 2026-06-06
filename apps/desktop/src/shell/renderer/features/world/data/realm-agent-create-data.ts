import {
  createNimiRealmMasterAgent,
  loadNimiRealmCreatorAgents,
  type NimiRealmCreateMasterAgentInput,
  type NimiRealmCreatorAgentProjection,
} from '@nimiplatform/sdk/realm';
import { getDesktopRealm } from '@renderer/infra/sdk/desktop-nimi-client-session';

export type CreateMasterAgentInput = NimiRealmCreateMasterAgentInput;

export async function createMasterAgent(
  input: CreateMasterAgentInput,
): Promise<NimiRealmCreatorAgentProjection> {
  return createNimiRealmMasterAgent(getDesktopRealm(), input);
}

let inflightCreatorAgents: Promise<readonly NimiRealmCreatorAgentProjection[]> | null = null;

export async function loadCreatorAgents(): Promise<readonly NimiRealmCreatorAgentProjection[]> {
  if (inflightCreatorAgents) return inflightCreatorAgents;
  const task = loadNimiRealmCreatorAgents(getDesktopRealm()).finally(() => { inflightCreatorAgents = null; });
  inflightCreatorAgents = task;
  return task;
}

export const realmAgentCreateData = {
  createAgent: (input: CreateMasterAgentInput) =>
    createMasterAgent(input),
  loadMyAgents: () =>
    loadCreatorAgents(),
};
