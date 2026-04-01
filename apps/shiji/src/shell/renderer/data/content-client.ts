/**
 * content-client.ts — Realm API: world content (rules, lorebooks, events, scenes)
 * Per feature-matrix.yaml dialogue-session realm-apis
 * Full typed implementation: Phase 1 Step 1.5
 */
import { getPlatformClient } from '@nimiplatform/sdk';

export async function getWorldRules(worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{worldId}/rules — WorldRulesService
  return getPlatformClient().realm.services.WorldRulesService.worldRulesControllerGetRules(worldId);
}

export async function getAgentRules(worldId: string, agentId: string): Promise<unknown> {
  // GET /api/world/by-id/{worldId}/agents/{agentId}/rules — AgentRulesService
  return getPlatformClient().realm.services.AgentRulesService.agentRulesControllerListRules(worldId, agentId);
}

export async function getLorebooks(worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{id}/lorebooks — WorldsService
  return getPlatformClient().realm.services.WorldsService.worldControllerGetWorldLorebooks(worldId);
}

export async function getTrunkEvents(_worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{worldId}/events — API proposed; implementation in Step 1.5
  // This endpoint is not yet in the SDK generated code
  throw new Error('getTrunkEvents: endpoint not yet available in SDK — Phase 1 Step 1.5');
}

export async function getScenes(_worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{worldId}/scenes — provides location/setting metadata
  // NOT the source for ShiJi pacing scene types (SJ-DIAL-006:8)
  // API proposed; implementation in Step 1.5
  throw new Error('getScenes: endpoint not yet available in SDK — Phase 1 Step 1.5');
}
