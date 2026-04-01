/**
 * agent-client.ts — Realm API: agent queries
 * Full implementation: Phase 1 Step 1.4
 */
import { getPlatformClient } from '@nimiplatform/sdk';

export async function getAgent(agentId: string): Promise<unknown> {
  // GET /api/agent/accounts/{agentId} — AgentsService.getAgent
  return getPlatformClient().realm.services.AgentsService.getAgent(agentId);
}
