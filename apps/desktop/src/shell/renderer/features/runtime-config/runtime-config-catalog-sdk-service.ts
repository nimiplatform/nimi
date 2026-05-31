import { getPlatformClient } from '@nimiplatform/sdk';
import {
  Runtime,
  createRuntimeModelCatalogClient,
  type RuntimeCallOptions,
} from '@nimiplatform/sdk/runtime';

const CATALOG_CALL_OPTIONS: RuntimeCallOptions = {
  timeoutMs: 8000,
  metadata: {
    callerKind: 'desktop-core',
    callerId: 'runtime-config.catalog',
    surfaceId: 'runtime.config',
  },
};

let anonymousRuntime: Runtime | null = null;

function runtimeAdmin() {
  return getPlatformClient().domains.runtimeAdmin;
}

function anonymousRuntimeConnector() {
  const runtime = getPlatformClient().runtime;
  if (
    anonymousRuntime
    && anonymousRuntime.appId === runtime.appId
    && anonymousRuntime.transport === runtime.transport
  ) {
    return anonymousRuntime.connector;
  }
  anonymousRuntime = new Runtime({
    appId: runtime.appId,
    transport: runtime.transport,
  });
  return anonymousRuntime.connector;
}

export const runtimeConfigCatalogClient = createRuntimeModelCatalogClient({
  connector: runtimeAdmin,
  readConnector: anonymousRuntimeConnector,
  callOptions: CATALOG_CALL_OPTIONS,
});

export type {
  RuntimeCatalogModelDetail,
  RuntimeCatalogModelOverlayInput,
  RuntimeCatalogProviderModelsResponse,
  RuntimeCatalogVoiceEntry,
  RuntimeCatalogWorkflowBinding,
  RuntimeCatalogWorkflowModel,
  RuntimeCatalogPricing,
  RuntimeModelCatalogProvider,
} from '@nimiplatform/sdk/runtime';
