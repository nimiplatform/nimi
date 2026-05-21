import type { Realm } from '@nimiplatform/sdk/realm';
import { createStudioRealmClient } from '@renderer/data/realm-client.js';
import {
  normalizeOwnerPortfolio,
  normalizeOwnerPortfolioAgentDetail,
  type OwnerPortfolioAgent,
  type OwnerPortfolioAgentDetail,
} from './portfolio-data.js';
import {
  normalizeSelectableWorlds,
  normalizeSelectedWorldPreview,
  type RealmAgentCreationWorldDto,
  type SelectableRealmWorld,
  type SelectedWorldPreview,
} from './create-agent-draft.js';

export async function listOwnerPortfolioAgents(realm: Realm = createStudioRealmClient()): Promise<OwnerPortfolioAgent[]> {
  const agents = await realm.services.MeService.listMyRealmAgents();
  return normalizeOwnerPortfolio(agents);
}

export async function getOwnerPortfolioAgentDetail(
  agentId: string,
  realm: Realm = createStudioRealmClient(),
): Promise<OwnerPortfolioAgentDetail> {
  const agent = await realm.services.MeService.getMyRealmAgent(agentId);
  return normalizeOwnerPortfolioAgentDetail(agent);
}

export async function listCreateRealmAgentSelectableWorlds(
  realm: Realm = createStudioRealmClient(),
): Promise<SelectableRealmWorld[]> {
  const worlds = await realm.services.WorldsService.worldControllerListWorlds();
  return normalizeSelectableWorlds(worlds as RealmAgentCreationWorldDto[]);
}

export async function getCreateRealmAgentWorldPreview(
  worldId: string,
  realm: Realm = createStudioRealmClient(),
): Promise<SelectedWorldPreview> {
  const world = await realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(worldId, 4);
  return normalizeSelectedWorldPreview(world);
}
