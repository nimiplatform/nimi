import { ReasonCode } from '@nimiplatform/sdk/runtime/wire-types';
import { useQuery } from '@tanstack/react-query';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import { projectAppsPanel, type DesktopAppsCatalogProjection } from './apps-panel-projection.js';

/** Read-only reuse of the Apps inventory projection for Home and target choice. */
export function useAppsOverview() {
  const sdk = useDesktopRendererSdk();
  return useQuery({
    queryKey: ['desktop', 'apps-overview'],
    staleTime: 15_000,
    queryFn: async () => {
      const apps = sdk.machineProduct().apps;
      const catalog: DesktopAppsCatalogProjection = await apps
        .listApprovedAppCatalogTargets({})
        .then((response) => {
          if (response.reasonCode !== ReasonCode.ACTION_EXECUTED) throw Error(String(response.reasonCode));
          return { status: 'loaded' as const, targets: response.targets };
        })
        .catch((error: unknown) => ({ status: 'unavailable' as const, targets: [], error }));
      return projectAppsPanel(
        {
          ...createDesktopAppsLiveBridge(),
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
        },
        { catalog },
      );
    },
  });
}
