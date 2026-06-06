import {
  createNimiHostRuntimeRouteAccessSurface,
  type NimiRuntimeRouteHostAccessClient,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeRouteHostAccessProjection = {
  callerId: string;
  keySource: string;
  healthStatus: string;
};

export async function loadTesterRuntimeRouteHostAccessProjection(): Promise<TesterRuntimeRouteHostAccessProjection> {
  const surface = createNimiHostRuntimeRouteAccessSurface({
    getRuntime: () => ({
      local: {
        async listLocalAssets() {
          return { assets: [], nextPageToken: '' };
        },
        async checkLocalAssetHealth() {
          return { assets: [] };
        },
        async warmLocalAsset() {
          return {};
        },
      },
      connectors: {
        async testConnector() {
          return { ack: { ok: true, reasonCode: 0, actionHint: '' } };
        },
      },
    } as unknown as NimiRuntimeRouteHostAccessClient),
    appId: 'nimi.tester',
    callerKind: 'third-party-app',
    surfaceId: 'tester.settings',
  });
  const [metadata, options, health] = await Promise.all([
    surface.buildRequestMetadata({
      source: 'cloud',
      connectorId: 'tester-cloud',
    }),
    surface.buildCallOptions({
      targetId: 'tester.settings.runtime-route-host-access',
      timeoutMs: 5000,
      source: 'cloud',
      connectorId: 'tester-cloud',
    }),
    surface.checkLocalHealth({
      provider: 'tester',
      connectorId: 'tester-cloud',
      localProviderModel: 'tester-health-model',
    }),
  ]);
  return {
    callerId: String(options.metadata?.callerId || 'unknown'),
    keySource: String(metadata.keySource || options.metadata?.keySource || 'direct'),
    healthStatus: health.status ?? 'unknown',
  };
}
