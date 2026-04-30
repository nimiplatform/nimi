import { useMemo } from 'react';
import type { LocalRuntimeAssetKind, LocalRuntimeAssetRecord } from '@runtime/local-runtime';
import { parseTimestamp } from './runtime-config-model-center-utils';
import { filterInstalledAssets } from './runtime-config-local-model-center-helpers';
import { RUNNABLE_ASSET_KINDS } from './runtime-config-use-local-model-center-helpers.js';

type InstalledAssetViewsInput = {
  assetKindFilter: 'all' | LocalRuntimeAssetKind;
  deferredSearchQuery: string;
  installedAssets: LocalRuntimeAssetRecord[];
};

export function useLocalModelCenterInstalledAssetViews({
  assetKindFilter,
  deferredSearchQuery,
  installedAssets,
}: InstalledAssetViewsInput) {
  const sortedInstalledAssets = useMemo(
    () => [...installedAssets].sort((left, right) => {
      const leftRank = parseTimestamp(left.installedAt) || parseTimestamp(left.updatedAt);
      const rightRank = parseTimestamp(right.installedAt) || parseTimestamp(right.updatedAt);
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return String(right.localAssetId || '').localeCompare(String(left.localAssetId || ''));
    }),
    [installedAssets],
  );

  const visibleInstalledAssets = useMemo(
    () => sortedInstalledAssets.filter((asset) => asset.status !== 'removed'),
    [sortedInstalledAssets],
  );

  const sortedInstalledRunnableAssets = useMemo(
    () => visibleInstalledAssets.filter((asset) => RUNNABLE_ASSET_KINDS.has(asset.kind)),
    [visibleInstalledAssets],
  );

  const filteredInstalledRunnableAssets = useMemo(() => {
    if (!deferredSearchQuery.trim()) {
      return sortedInstalledRunnableAssets;
    }
    const query = deferredSearchQuery.toLowerCase().trim();
    return sortedInstalledRunnableAssets.filter((asset) => (
      asset.assetId.toLowerCase().includes(query)
      || asset.localAssetId.toLowerCase().includes(query)
      || asset.engine.toLowerCase().includes(query)
      || asset.kind.toLowerCase().includes(query)
      || asset.logicalModelId?.toLowerCase().includes(query)
      || asset.source.repo.toLowerCase().includes(query)
      || (asset.capabilities || []).some((capability) => capability.toLowerCase().includes(query))
    ));
  }, [deferredSearchQuery, sortedInstalledRunnableAssets]);

  const sortedInstalledDependencyAssets = useMemo(
    () => visibleInstalledAssets.filter((asset) => !RUNNABLE_ASSET_KINDS.has(asset.kind)),
    [visibleInstalledAssets],
  );

  const filteredInstalledDependencyAssets = useMemo(
    () => filterInstalledAssets(sortedInstalledDependencyAssets, assetKindFilter, deferredSearchQuery.toLowerCase().trim()),
    [assetKindFilter, deferredSearchQuery, sortedInstalledDependencyAssets],
  );

  return {
    filteredInstalledDependencyAssets,
    filteredInstalledRunnableAssets,
    sortedInstalledRunnableAssets,
    visibleInstalledAssets,
  };
}
