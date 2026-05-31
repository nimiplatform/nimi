import { getPlatformClient } from '@nimiplatform/sdk';
import {
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

function runtimeAdmin() {
  return getPlatformClient().domains.runtimeAdmin;
}

export const runtimeConfigCatalogClient = createRuntimeModelCatalogClient({
  connector: runtimeAdmin,
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
