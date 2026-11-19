import { useQueries, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { RealmWorldData } from './data/realm-world-data.js';
import { toWorldListItem, type WorldListItem } from './world-list-model.js';
import { WORLD_CATALOG_CONTRACT_VERSION } from './world-detail-queries.js';

type Source = { data: RealmWorldData; realmBaseUrl: string; enabled: boolean; offline: boolean };

export function worldSummaryBatches(ids: readonly string[]) {
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += 40) batches.push(ids.slice(offset, offset + 40));
  return batches;
}

// A user can change favorites offline. Reuse the last accepted batch containing each ID;
// a later successful omission supersedes an older discoverable summary.
function offlineSummaries(client: QueryClient, prefix: readonly string[], ids: readonly string[]) {
  const remaining = new Set(ids);
  const found = new Map<string, WorldListItem>();
  const cached = client.getQueriesData<WorldListItem[]>({ queryKey: prefix })
    .sort(([a], [b]) => (client.getQueryState(b)?.dataUpdatedAt ?? 0) - (client.getQueryState(a)?.dataUpdatedAt ?? 0));
  for (const [key, rows] of cached) {
    if (!rows || !remaining.size) continue;
    for (const row of rows) if (remaining.has(row.id)) found.set(row.id, row);
    for (const id of key[prefix.length] as readonly string[]) remaining.delete(id);
  }
  return { worlds: ids.flatMap(id => found.get(id) ?? []), incomplete: remaining.size > 0 };
}

function summaryPrefix(source: Source) {
  return ['world-summaries', WORLD_CATALOG_CONTRACT_VERSION, source.realmBaseUrl] as const;
}

export function worldSummaryQueryOptions(source: Source, ids: readonly string[]) {
  return {
    queryKey: [...summaryPrefix(source), ids],
    queryFn: async () => (await source.data.loadWorldSummaries(ids)).map(toWorldListItem),
    enabled: source.enabled && !source.offline,
    staleTime: 30_000,
    retry: false,
  };
}

export function useWorldSummaryBatches(source: Source, batches: readonly (readonly string[])[]) {
  const client = useQueryClient();
  const queries = useQueries({ queries: batches.map(ids => worldSummaryQueryOptions(source, ids)) });
  const pendingIds = new Set(batches.flatMap((ids, i) =>
    source.enabled && !source.offline && queries[i]!.isPending && !queries[i]!.isPaused ? ids : []));
  const offline = source.offline || queries.some(query => query.isPaused);
  const cached = offline && source.enabled
    ? offlineSummaries(client, summaryPrefix(source), batches.flat())
    : undefined;
  const worlds = cached?.worlds ?? queries.flatMap(query => query.data ?? []);
  return { worlds, pendingIds, loading: pendingIds.size > 0, offline,
    error: source.enabled && !pendingIds.size && (Boolean(cached?.incomplete) || queries.some(query => query.isError)),
    retry: () => { for (const query of queries) void query.refetch(); } };
}
