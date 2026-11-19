import { useQueryClient } from '@tanstack/react-query';
import type { RealmWorldData } from './data/realm-world-data.js';
import { useWorldSummaryBatches, worldSummaryQueryOptions } from './use-world-summary-batches.js';
import { WORLD_ATLAS_LEAD_WORLD_IDS, WORLD_DISCOVERY_OPENING_IDS, WORLD_DISCOVERY_DEFERRED_IDS } from './world-list-catalog-model.js';

export type WorldAtlasSource = { data: RealmWorldData; realmBaseUrl: string; enabled: boolean; offline: boolean };

const opening = [...WORLD_DISCOVERY_OPENING_IDS, ...WORLD_ATLAS_LEAD_WORLD_IDS];

export function useWorldAtlasLeadWorlds(source: WorldAtlasSource, includeDeferred: boolean) {
  const client = useQueryClient();
  const request = worldSummaryQueryOptions(source, opening);
  // Start only the requested opening batch while the panel transition is running.
  if (request.enabled && !client.getQueryState(request.queryKey)) {
    void client.query(request).catch(() => { /* The shared query observer handles failures. */ });
  }
  return useWorldSummaryBatches(source, includeDeferred ? [opening, WORLD_DISCOVERY_DEFERRED_IDS] : [opening]);
}
