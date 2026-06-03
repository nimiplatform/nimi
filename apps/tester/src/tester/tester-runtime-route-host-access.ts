import {
  createHostRuntimeRouteAccessSurface,
  ModelHealthStatus,
  RuntimeReasonCode,
  type CheckModelHealthRequest,
  type RuntimeRouteHostAccessClient,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeRouteHostAccessProjection = {
  callerId: string;
  keySource: string;
  healthStatus: string;
};

export async function loadTesterRuntimeRouteHostAccessProjection(): Promise<TesterRuntimeRouteHostAccessProjection> {
  const surface = createHostRuntimeRouteAccessSurface({
    getRuntime: () => ({
      appId: 'nimi.tester',
      ai: {},
      media: {},
      local: {
        async listLocalAssets() {
          return { assets: [], nextPageToken: '' };
        },
        async warmLocalAsset() {
          return {};
        },
      },
      connector: {
        async testConnector() {
          return { ack: { ok: true, reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED, actionHint: '' } };
        },
      },
      model: {
        async checkHealth(request: CheckModelHealthRequest) {
          return {
            healthy: true,
            status: ModelHealthStatus.HEALTHY,
            endpoint: request.endpoint,
            modelId: request.modelId,
            detail: 'tester runtime route host access ready',
            actionHint: 'none',
            reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
          };
        },
      },
    } as unknown as RuntimeRouteHostAccessClient),
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
    callerId: options.metadata.callerId,
    keySource: String(metadata.keySource || options.metadata.keySource || 'direct'),
    healthStatus: health.status,
  };
}
