import type { RealmWorldData } from './data/realm-world-data.js';
import { useWorldSummaryBatches, worldSummaryBatches } from './use-world-summary-batches.js';
import { useFollowedWorlds } from './world-follow-store-context.js';

// Resolve saved IDs independently of the public catalog's pagination and filters.
export function useWorldFavorites(input: {
  data: RealmWorldData; realmBaseUrl: string; enabled: boolean; offline: boolean; search: string;
}) {
  const followed = useFollowedWorlds();
  const batch = useWorldSummaryBatches({ ...input, enabled: input.enabled && followed.available && !followed.error },
    worldSummaryBatches(followed.ids));
  const search = input.search.trim().toLocaleLowerCase();
  const worlds = batch.worlds.filter((world) => !search
    || `${world.name}\n${world.description ?? ''}`.toLocaleLowerCase().includes(search));
  return {
    worlds,
    loading: batch.loading,
    unavailable: !followed.available ? 'World.favorites.signIn' : followed.error ? 'World.favorites.readError' : undefined,
    error: batch.error && batch.worlds.length === 0,
    partialError: batch.error && batch.worlds.length > 0,
    offline: batch.offline,
    retry: batch.retry,
  };
}
