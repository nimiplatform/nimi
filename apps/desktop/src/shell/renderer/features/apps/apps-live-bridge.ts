// Desktop Apps live bridge.
//
// This is the Apps-surface-only registry bridge. It intentionally avoids the
// broader Nimi Home bridge, because Apps only needs the SDK NimiAppClient over
// owner projections exposed through the SDK and protected Runtime carrier.

import { NimiAppClient, createNimiAppRegistryTransport } from '@nimiplatform/sdk/app';
import { getAppsBridgeProjection } from '../../bridge/runtime-bridge/apps-projection';
import { getDesktopRuntime } from '../../infra/sdk/desktop-nimi-client-session';

export interface DesktopAppsLiveBridge {
  readonly appClient: NimiAppClient;
}

export function createDesktopAppsLiveBridge(): DesktopAppsLiveBridge {
  // Fetch once per bridge instance so registry rows and release descriptors see
  // the same materialized projection snapshot. Immutable package readiness is
  // the selector-free global 0K typed-unavailable projection.
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
          surfaceId: 'desktop.apps',
        },
      }),
      loadPackageReadiness: async () => getDesktopRuntime().appLifecycle.packageReadiness({
        timeoutMs: 20_000,
        metadata: {
          surfaceId: 'desktop.apps',
        },
      }),
    })),
  };
}
