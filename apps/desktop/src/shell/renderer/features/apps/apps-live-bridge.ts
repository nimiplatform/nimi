// Desktop Apps live bridge.
//
// This is the Apps-surface-only registry bridge. It intentionally avoids the
// broader Nimi Home bridge, because Apps only needs the SDK NimiAppClient over
// the desktop `~/.nimi/apps` projection.

import { NimiAppClient, createNimiAppRegistryTransport } from '@nimiplatform/sdk/app';
import { getAppsBridgeProjection } from '@renderer/bridge/runtime-bridge/apps-projection';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

export interface DesktopAppsLiveBridge {
  readonly appClient: NimiAppClient;
}

export function createDesktopAppsLiveBridge(): DesktopAppsLiveBridge {
  // Fetch once per bridge instance so registry rows and release descriptors see
  // the same materialized projection snapshot. Package readiness is fetched
  // from Runtime per app through the SDK Runtime surface.
  let projectionPromise: ReturnType<typeof getAppsBridgeProjection> | null = null;
  const loadProjection = (): ReturnType<typeof getAppsBridgeProjection> => {
    if (!projectionPromise) {
      projectionPromise = getAppsBridgeProjection();
    }
    return projectionPromise;
  };

  return {
    appClient: new NimiAppClient(createNimiAppRegistryTransport({
      loadRows: async () => (await loadProjection()).registryRows,
      loadReleaseDescriptors: async () => (await loadProjection()).releaseDescriptors,
      loadAccountInventory: async () => getDesktopRuntime().appLifecycle.accountInventory({
        timeoutMs: 20_000,
        metadata: {
          callerKind: 'desktop-core',
          callerId: 'desktop.apps.account-inventory',
          surfaceId: 'desktop.apps',
        },
      }),
      loadLocalAdoptions: async () => getDesktopRuntime().appLifecycle.listLocalAdoptions({
        timeoutMs: 20_000,
        metadata: {
          callerKind: 'desktop-core',
          callerId: 'desktop.apps.local-adoptions',
          surfaceId: 'desktop.apps',
        },
      }),
      loadPackageReadiness: async (appId) => getDesktopRuntime().appLifecycle.packageReadiness(
        { appId },
        {
          timeoutMs: 20_000,
          metadata: {
            callerKind: 'desktop-core',
            callerId: 'desktop.apps.status',
            surfaceId: 'desktop.apps',
          },
        },
      ),
      loadActiveJobs: async (appId) => getDesktopRuntime().appLifecycle.listJobs(
        { appId },
        {
          timeoutMs: 20_000,
          metadata: {
            callerKind: 'desktop-core',
            callerId: 'desktop.apps.jobs',
            surfaceId: 'desktop.apps',
          },
        },
      ),
    })),
  };
}
