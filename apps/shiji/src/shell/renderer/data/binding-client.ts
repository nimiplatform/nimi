/**
 * binding-client.ts — Realm API: asset bindings
 * Full implementation: Phase 1 Step 1.4
 */
import { getPlatformClient } from '@nimiplatform/sdk';

export async function getWorldBindings(worldId: string): Promise<unknown> {
  // GET /api/world/by-id/{worldId}/bindings — WorldsService
  return getPlatformClient().realm.services.WorldsService.worldControllerGetWorldBindings(worldId);
}
