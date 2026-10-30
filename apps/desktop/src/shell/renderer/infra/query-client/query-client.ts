import { QueryClient } from '@tanstack/react-query';

export function createDesktopQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 15_000,
      },
      mutations: {
        retry: 0,
      },
    },
  });
  // Keep World browsing data through a chat or App visit. Freshness still belongs
  // to each query: stale entries render immediately while refreshing in the background.
  // These caches remain memory-only and retain their Realm/query-specific keys.
  for (const key of ['world-catalog', 'world-list-item', 'world-topics']) {
    client.setQueryDefaults([key], { gcTime: 30 * 60_000 });
  }
  return client;
}
