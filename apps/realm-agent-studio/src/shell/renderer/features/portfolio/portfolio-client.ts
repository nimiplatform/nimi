import type { Realm } from '@nimiplatform/sdk/realm';
import { createStudioRealmClient } from '@renderer/data/realm-client.js';
import { normalizeOwnerPortfolio, type OwnerPortfolioAgent } from './portfolio-data.js';

export async function listOwnerPortfolioAgents(realm: Realm = createStudioRealmClient()): Promise<OwnerPortfolioAgent[]> {
  const agents = await realm.services.MeService.listMyRealmAgents();
  return normalizeOwnerPortfolio(agents);
}
