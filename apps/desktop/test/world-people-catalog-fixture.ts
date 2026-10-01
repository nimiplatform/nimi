import type { WorldPeopleCatalogState } from '../src/shell/renderer/features/world/world-detail-types';

// A settled Realm people catalog for render tests: the first page is loaded and nothing is pending.
export function readyPeopleCatalog(
  totalCount: number,
  overrides: Partial<WorldPeopleCatalogState> = {},
): WorldPeopleCatalogState {
  return {
    status: 'ready',
    offline: false,
    totalCount,
    hasMore: false,
    loadingMore: false,
    loadMorePaused: false,
    loadMoreFailed: false,
    query: '',
    onQueryChange: () => {},
    onLoadMore: () => {},
    onRetry: () => {},
    ...overrides,
  };
}
