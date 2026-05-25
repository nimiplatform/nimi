// Desktop Apps live bridge.
//
// This is the Apps-surface-only registry bridge. It intentionally avoids the
// broader Nimi Home bridge, because Apps only needs the SDK NimiAppClient over
// the desktop `~/.nimi/apps` projection.

import { NimiAppClient, createNimiAppRegistryTransport } from '@nimiplatform/sdk/app';
import { getAppsBridgeProjection } from '@renderer/bridge/runtime-bridge/apps-projection';

export interface DesktopAppsLiveBridge {
  readonly appClient: NimiAppClient;
}

export function createDesktopAppsLiveBridge(): DesktopAppsLiveBridge {
  // Fetch once per bridge instance so registry rows, release descriptors, and
  // install evidence all see the same materialized projection snapshot.
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
      loadInstallEvidence: async () => (await loadProjection()).installEvidence,
    })),
  };
}
