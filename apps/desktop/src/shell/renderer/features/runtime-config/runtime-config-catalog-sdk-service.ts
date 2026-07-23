import {
  createNimiRuntimeModelCatalogClient,
  type NimiRuntimeModelCatalogConnectorClient,
} from '@nimiplatform/sdk/runtime';
import { type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

const CATALOG_CALL_OPTIONS: RuntimeTypedCallOptions = {
  timeoutMs: 8000,
  metadata: { surfaceId: 'runtime.config' },
};

export function createRuntimeConfigCatalogClient(
  connectors: ReturnType<DesktopRendererSdkPort['connectorAdmin']>,
) {
  const runtimeCatalogConnectors: NimiRuntimeModelCatalogConnectorClient = {
    listModelCatalogProviders: (request, options) => connectors.listModelCatalogProviders(request, options),
    listCatalogProviderModels: (request, options) => connectors.listCatalogProviderModels(request, options),
    getCatalogModelDetail: (request, options) => connectors.getCatalogModelDetail(request, options),
    upsertModelCatalogProvider: (request, options) => connectors.upsertModelCatalogProvider(request, options),
    deleteModelCatalogProvider: (request, options) => connectors.deleteModelCatalogProvider(request, options),
    upsertCatalogModelOverlay: (request, options) => connectors.upsertCatalogModelOverlay(request, options),
    deleteCatalogModelOverlay: (request, options) => connectors.deleteCatalogModelOverlay(request, options),
  };
  return createNimiRuntimeModelCatalogClient({
    connectors: runtimeCatalogConnectors,
    callOptions: CATALOG_CALL_OPTIONS,
  });
}

export type RuntimeConfigCatalogClient = ReturnType<typeof createRuntimeConfigCatalogClient>;

export type {
  NimiRuntimeCatalogModelDetail,
  NimiRuntimeCatalogModelOverlayInput,
  NimiRuntimeCatalogProviderModelsResponse,
  NimiRuntimeCatalogVoiceEntry,
  NimiRuntimeCatalogWorkflowBinding,
  NimiRuntimeCatalogWorkflowModel,
  NimiRuntimeCatalogPricing,
  NimiRuntimeModelCatalogProvider,
} from '@nimiplatform/sdk/runtime';
