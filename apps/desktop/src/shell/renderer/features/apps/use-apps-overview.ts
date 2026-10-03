import { ReasonCode, type ApprovedAppCatalogTarget } from '@nimiplatform/sdk/runtime/wire-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import { projectAppsPanel, type DesktopAppsCatalogProjection, type DesktopAppsPanelProjection, type DesktopAppsProjectionSource } from './apps-panel-projection.js';

const inventoryKey = ['desktop', 'apps-overview'] as const;

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042c
export function useAppsOverviewQuery(source: DesktopAppsProjectionSource, options: { readonly enabled?: boolean } = {}) {
  const client = useQueryClient();
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
        catalog: { status: 'loading', targets: [] },
        onInventory: (projection) => {
          if (!signal.aborted && previous?.status !== 'loaded') client.setQueryData(inventoryKey, projection);
        },
      });
    },
  });
  const catalog = useQuery({
    queryKey: ['desktop', 'apps-overview-catalog'],
    staleTime: 15_000,
    enabled: options.enabled,
    queryFn: async (): Promise<DesktopAppsCatalogProjection> => {
      try {
        if (!source.listApprovedCatalogTargets) return { status: 'not-implemented', targets: [] };
        const targets = await source.listApprovedCatalogTargets();
        const appIds = new Set<string>();
        for (const target of targets) {
          if (appIds.has(target.appId)) throw Error(`Runtime Apps Catalog conflict: multiple targets for verified:${target.appId}`);
          appIds.add(target.appId);
        }
        return { status: 'loaded', targets };
      } catch (error) {
        return { status: 'unavailable', targets: [], error };
      }
    },
  });
  const data = useMemo(() => {
    if (inventory.data?.status !== 'loaded') return inventory.data;
    const targets = new Map<string, ApprovedAppCatalogTarget>();
    for (const target of catalog.data?.targets ?? []) {
      targets.set(target.appId, target);
    }
    return {
      ...inventory.data,
      catalogStatus: catalog.isPaused ? 'unavailable' as const : catalog.data?.status ?? 'loading',
      // Catalog data only adds update facts to local rows. It never adds remote
      // Apps or triggers information downloads for entries absent from this device.
      entries: inventory.data.entries.map((entry) => ({
        ...entry,
        catalogTarget: entry.identity.sourceClass === 'verified' ? targets.get(entry.identity.appId) ?? null : null,
      })),
    };
  }, [inventory.data, catalog.data, catalog.isPaused]);
  return { ...inventory, data };
}

/** Read-only reuse of the Apps inventory projection for Home and target choice. */
export function useAppsOverview(options: { readonly enabled?: boolean } = {}) {
  const sdk = useDesktopRendererSdk();
  const source = useMemo<DesktopAppsProjectionSource>(() => {
    const apps = sdk.machineProduct().apps;
    const liveBridge = createDesktopAppsLiveBridge();
    return {
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
      listPackageJobs: async () => {
        const r = await apps.listAppPackageJobs({});
        if (r.reasonCode !== ReasonCode.ACTION_EXECUTED) throw Error(String(r.reasonCode));
        return r.jobs;
      },
      listApprovedCatalogTargets: async () => {
        const r = await apps.listApprovedAppCatalogTargets({});
        if (r.reasonCode !== ReasonCode.ACTION_EXECUTED) throw Error(String(r.reasonCode));
        return r.targets;
      },
      readPackageInfo: async (request) => {
        const r = await apps.getAppPackageInfo(request);
        if (r.reasonCode !== ReasonCode.ACTION_EXECUTED || !r.info) throw Error(String(r.reasonCode));
        return r.info;
      },
    };
  }, [sdk]);
  return useAppsOverviewQuery(source, options);
}
