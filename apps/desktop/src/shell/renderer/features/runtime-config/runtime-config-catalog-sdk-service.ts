import { createNimiRuntimeModelCatalogClient, type NimiRuntimeModelCatalogConnectorClient } from '@nimiplatform/sdk/runtime';
import { type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

const CATALOG_CALL_OPTIONS: RuntimeTypedCallOptions = {
  timeoutMs: 8000,
  metadata: {
    callerKind: 'desktop-core',
    callerId: 'runtime-config.catalog',
    surfaceId: 'runtime.config',
  },
};

const runtimeCatalogConnectors: NimiRuntimeModelCatalogConnectorClient = {
  listModelCatalogProviders: (request, options) => getDesktopRuntime().connectors.listModelCatalogProviders(request, options),
  listCatalogProviderModels: (request, options) => getDesktopRuntime().connectors.listCatalogProviderModels(request, options),
  getCatalogModelDetail: (request, options) => getDesktopRuntime().connectors.getCatalogModelDetail(request, options),
  upsertModelCatalogProvider: (request, options) => getDesktopRuntime().connectors.upsertModelCatalogProvider(request, options),
  deleteModelCatalogProvider: (request, options) => getDesktopRuntime().connectors.deleteModelCatalogProvider(request, options),
  upsertCatalogModelOverlay: (request, options) => getDesktopRuntime().connectors.upsertCatalogModelOverlay(request, options),
  deleteCatalogModelOverlay: (request, options) => getDesktopRuntime().connectors.deleteCatalogModelOverlay(request, options),
};

export const runtimeConfigCatalogClient = createNimiRuntimeModelCatalogClient({
  connectors: runtimeCatalogConnectors,
  callOptions: CATALOG_CALL_OPTIONS,
});

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
