/**
 * world-client.ts — Realm API: world discovery
 * Uses WorldsService (SDK-generated) per feature-matrix.yaml explore-home
 * Full typed implementation: Phase 1 Step 1.4
 */
import { getPlatformClient } from '@nimiplatform/sdk';

export async function getWorlds(): Promise<unknown> {
  // GET /api/world — WorldsService.worldControllerListWorlds
  return getPlatformClient().realm.services.WorldsService.worldControllerListWorlds();
}

export async function getWorldDetail(worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{id}
  return getPlatformClient().realm.services.WorldsService.worldControllerGetWorld(worldId);
}

export async function getWorldDetailWithAgents(worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{id}/detail-with-agents
  return getPlatformClient().realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(worldId);
}

export async function getWorldAgents(worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{id}/agents
  return getPlatformClient().realm.services.WorldsService.worldControllerGetWorldAgents(worldId);
}

export async function getWorldBindings(worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{id}/bindings
  return getPlatformClient().realm.services.WorldsService.worldControllerGetWorldBindings(worldId);
}

export async function getWorldLorebooks(worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{id}/lorebooks
  return getPlatformClient().realm.services.WorldsService.worldControllerGetWorldLorebooks(worldId);
}
