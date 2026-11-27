import { useAppsDownloads } from './apps-downloads-context.js';
import { ReasonCode, type ApprovedAppCatalogTarget } from '@nimiplatform/sdk/runtime/wire-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import { useAppsPresentationCache } from './use-apps-presentation-cache.js';
import { mergeAppPresentation, normalizeCatalogTargetsResponse, retainCurrentAppPresentation, projectAppsPanel, timestampUnixMs, type DesktopAppsCatalogProjection, type DesktopAppsCatalogReadOptions, type DesktopAppsPanelProjection, type DesktopAppsProjectionSource } from './apps-panel-projection.js';

const inventoryKey = ['desktop', 'apps-overview'] as const;
const overviewCatalogKey = ['desktop', 'apps-overview-catalog'] as const;

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042c
export function useAppsOverviewQuery(source: DesktopAppsProjectionSource, options: { readonly enabled?: boolean } = {}) {
  const client = useQueryClient();
  const forceNextCatalogRefreshRef = useRef(false);
  const inventory = useQuery({
    queryKey: inventoryKey,
    staleTime: 15_000,
    networkMode: 'always', // The local Runtime remains readable without internet connectivity.
    enabled: options.enabled,
    queryFn: ({ signal }) => {
      const previous = client.getQueryData<DesktopAppsPanelProjection>(inventoryKey);
      return projectAppsPanel(source, {
        previous,
        refreshAIConfig: false,
        background: true,
        onEntry(entry, patch) {
          if (signal.aborted) return;
          client.setQueryData<DesktopAppsPanelProjection | null>(inventoryKey, current => mergeAppPresentation(current ?? null, entry, patch));
        },
        catalog: { status: 'loading', targets: [] },
        onInventory: (projection) => {
          if (!signal.aborted && previous?.status !== 'loaded') client.setQueryData(inventoryKey, projection);
        },
      }).then(next => retainCurrentAppPresentation(client.getQueryData<DesktopAppsPanelProjection>(inventoryKey) ?? null, next));
    },
  });
  const catalog = useQuery({
    queryKey: overviewCatalogKey,
    staleTime: 15_000,
    enabled: options.enabled,
    queryFn: async (): Promise<DesktopAppsCatalogProjection> => {
      const forceRefresh = forceNextCatalogRefreshRef.current;
      forceNextCatalogRefreshRef.current = false;
      try {
        if (!source.listApprovedCatalogTargets) return { status: 'not-implemented', targets: [] };
        const projected = normalizeCatalogTargetsResponse(
          await source.listApprovedCatalogTargets(forceRefresh ? { forceRefresh: true } : undefined),
        );
        const appIds = new Set<string>();
        for (const target of projected.targets) {
          if (appIds.has(target.appId)) throw Error(`Runtime Apps Catalog conflict: multiple targets for verified:${target.appId}`);
          appIds.add(target.appId);
        }
        return projected;
      } catch (error) {
        return { status: 'unavailable', targets: [], error };
      }
    },
  });
  const catalogRefreshInProgress = Boolean(catalog.data?.refreshInProgress);
  useEffect(() => {
    if (options.enabled === false || !catalogRefreshInProgress || !source.listApprovedCatalogTargets) return;
    let cancelled = false;
    void (async () => {
      try {
        const projected = normalizeCatalogTargetsResponse(
          await source.listApprovedCatalogTargets!({ awaitRefresh: true }),
        );
        const appIds = new Set<string>();
        for (const target of projected.targets) {
          if (appIds.has(target.appId)) throw Error(`Runtime Apps Catalog conflict: multiple targets for verified:${target.appId}`);
          appIds.add(target.appId);
        }
        if (cancelled) return;
        client.setQueryData<DesktopAppsCatalogProjection>(overviewCatalogKey, projected);
      } catch {
        if (cancelled) return;
        client.setQueryData<DesktopAppsCatalogProjection | undefined>(
          overviewCatalogKey,
          (previous) => (previous?.refreshInProgress
            ? { ...previous, refreshInProgress: false }
            : previous),
        );
      }
    })();
    return () => { cancelled = true; };
  }, [catalogRefreshInProgress, client, options.enabled, source]);
  const data = useMemo(() => {
    if (inventory.data?.status !== 'loaded') return inventory.data;
    const targets = new Map<string, ApprovedAppCatalogTarget>();
    for (const target of catalog.data?.targets ?? []) {
      targets.set(target.appId, target);
    }
    const catalogStale = catalog.data?.status === 'stale';
    return {
      ...inventory.data,
      catalogStatus: catalog.isPaused ? 'unavailable' as const : catalog.data?.status ?? 'loading',
      catalogUpdatedAtUnixMs: catalog.isPaused ? null : (catalog.data?.updatedAtUnixMs ?? null),
      ...(catalog.data?.refreshInProgress && !catalog.isPaused ? { catalogRefreshInProgress: true } : {}),
      // Catalog data only adds update facts to local rows. It never adds remote
      // Apps or triggers information downloads for entries absent from this device.
      entries: inventory.data.entries.map((entry) => ({
        ...entry,
        catalogTarget: entry.identity.sourceClass === 'verified' ? targets.get(entry.identity.appId) ?? null : null,
        catalogStale: entry.identity.sourceClass === 'verified' && catalogStale ? true : false,
      })),
    };
  }, [inventory.data, catalog.data, catalog.isPaused]);
  const updatesUnavailable = inventory.isError || data?.status === 'error' || catalog.isError || catalog.isPaused
    || (data?.status === 'loaded' && Boolean(data.runtimeError))
    || catalog.data?.status === 'unavailable' || catalog.data?.status === 'stale' || catalog.data?.status === 'not-implemented';
  const updatesStatus = updatesUnavailable ? 'unavailable' as const
    : data?.status === 'loaded' && data.catalogStatus === 'loaded' ? 'ready' as const : 'loading' as const;
  const refreshUpdates = () => {
    forceNextCatalogRefreshRef.current = true;
    return Promise.all([inventory.refetch(), catalog.refetch()]);
  };
  return { ...inventory, data, updatesStatus, refreshUpdates };
}

/** Read-only reuse of the Apps inventory projection for Home and target choice. */
export function useAppsOverview(options: { readonly enabled?: boolean } = {}) {
  const presentationCache = useAppsPresentationCache();
  const jobs = useAppsDownloads()?.observer;
  const sdk = useDesktopRendererSdk();
  const source = useMemo<DesktopAppsProjectionSource>(() => {
    const apps = sdk.machineProduct().apps;
    const liveBridge = createDesktopAppsLiveBridge();
    return {
      presentationCache,
      listRegistrations: liveBridge.listRegistrations,
      listRuns: liveBridge.listRuns,
      listInstalledRuns: liveBridge.listInstalledRuns,
      // Development projects carry their own artwork, read the same way as on the Apps page.
      readAppIcon: async (selector) => (await liveBridge.readProjectIcon(selector)).iconDataUrl,
      listCommittedReleases: async () => {
        const r = await apps.listCommittedAppReleases({});
        if (r.reasonCode !== ReasonCode.ACTION_EXECUTED) throw Error(String(r.reasonCode));
        return r.releases;
      },
      listPackageJobs: jobs?.readJobs ?? (async () => {
        const r = await apps.listAppPackageJobs({});
        if (r.reasonCode !== ReasonCode.ACTION_EXECUTED) throw Error(String(r.reasonCode));
        return r.jobs;
      }),
      listApprovedCatalogTargets: async (readOptions?: DesktopAppsCatalogReadOptions) => {
        const r = await apps.listApprovedAppCatalogTargets({
          forceRefresh: Boolean(readOptions?.forceRefresh),
          awaitRefresh: Boolean(readOptions?.awaitRefresh),
        });
        if (r.reasonCode !== ReasonCode.ACTION_EXECUTED) throw Error(String(r.reasonCode));
        return {
          targets: r.targets,
          stale: r.stale,
          updatedAtUnixMs: timestampUnixMs(r.updatedAt) || null,
          refreshInProgress: r.refreshInProgress,
        };
      },
      readPackageInfo: async (request) => {
        const r = await apps.getAppPackageInfo(request);
        if (r.reasonCode !== ReasonCode.ACTION_EXECUTED || !r.info) throw Error(String(r.reasonCode));
        return r.info;
      },
    };
  }, [sdk, presentationCache, jobs]);
  return useAppsOverviewQuery(source, options);
}
