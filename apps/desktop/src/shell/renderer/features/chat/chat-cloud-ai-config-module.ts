import type {
  ModelConfigCloudAIConfigModule,
  ModelConfigCloudTargetOption,
} from '@nimiplatform/kit/features/model-config/headless';
import {
  createNimiRuntimeConnectorInventoryClient,
  createNimiRuntimeModelCatalogClient,
  projectNimiRuntimeCloudImplementationOptions,
  type NimiRuntimeModelCatalogConnectorClient,
} from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

/** Runtime catalog and current-account Connector composition for Nimi-owned Cloud configuration. */
export function createDesktopCloudAIConfigModule(
  sdk: Pick<DesktopRendererSdkPort, 'connectorAdmin' | 'accountProduct'>,
): ModelConfigCloudAIConfigModule {
  const methods = (): ReturnType<DesktopRendererSdkPort['connectorAdmin']> => sdk.connectorAdmin();
  const inventory = createNimiRuntimeConnectorInventoryClient({ connectors: methods });
  const catalogMethods: NimiRuntimeModelCatalogConnectorClient = Object.freeze({
    listModelCatalogProviders: (request, options) => methods().listModelCatalogProviders(request, options),
    listCatalogProviderModels: (request, options) => methods().listCatalogProviderModels(request, options),
    getCatalogModelDetail: (request, options) => methods().getCatalogModelDetail(request, options),
    upsertModelCatalogProvider: (request, options) => methods().upsertModelCatalogProvider(request, options),
    deleteModelCatalogProvider: (request, options) => methods().deleteModelCatalogProvider(request, options),
    upsertCatalogModelOverlay: (request, options) => methods().upsertCatalogModelOverlay(request, options),
    deleteCatalogModelOverlay: (request, options) => methods().deleteCatalogModelOverlay(request, options),
  });
  const catalog = createNimiRuntimeModelCatalogClient({ connectors: catalogMethods });

  const module: ModelConfigCloudAIConfigModule = {
    async listImplementations(capabilityContract: string) {
      return projectNimiRuntimeCloudImplementationOptions(
        await catalog.listProviders(),
        capabilityContract,
      );
    },

    async listTargets(input: {
      readonly capabilityContract: string;
      readonly provider: string;
      readonly connectorId: string;
    }) {
      const provider = (await catalog.listProviders()).find((entry) => (
        entry.provider === input.provider
        && entry.runtimePlane === 'remote'
        && entry.managedSupported
        && entry.capabilities.includes(input.capabilityContract)
      ));
      if (!provider) throw new Error('DESKTOP_CLOUD_IMPLEMENTATION_NOT_IN_RUNTIME_CATALOG');

      const connector = (await inventory.listConnectors()).find((item) => (
        item.id === input.connectorId
        && item.scope === 'user'
        && item.provider === provider.provider
        && item.hasCredential
      ));
      if (!connector) throw new Error('DESKTOP_CLOUD_CONNECTOR_NOT_CURRENT_ACCOUNT');
      const targets = new Map<string, ModelConfigCloudTargetOption>();
      for (const model of await inventory.listConnectorModelDescriptors(connector.id)) {
        if (model.provider === provider.provider && model.capabilities.includes(input.capabilityContract)) {
          addTarget(targets, model);
        }
      }
      return Object.freeze([...targets.values()].sort((left, right) => left.label.localeCompare(right.label)));
    },

    async listAuthorizationOptions() {
      const connectorSnapshot = await inventory.listConnectors();
      const connectors = connectorSnapshot
        .filter((item) => item.scope === 'user' && item.hasCredential)
        .map((item) => Object.freeze({
          connectorId: item.id,
          label: item.label || item.id,
          provider: item.provider,
        }))
        .sort((left, right) => left.label.localeCompare(right.label));
      return Object.freeze({
        connectors: Object.freeze(connectors),
      });
    },
  };
  return Object.freeze(module);
}

function addTarget(
  targets: Map<string, ModelConfigCloudTargetOption>,
  model: {
    readonly modelLabel: string;
    readonly provider: string;
    readonly providerModelId: string;
    readonly remoteModelCatalogId: string;
  },
): void {
  const targetId = model.remoteModelCatalogId;
  if (targets.has(targetId)) return;
  targets.set(targetId, Object.freeze({
    targetId,
    label: model.modelLabel || model.providerModelId,
    provider: model.provider,
    providerModelTarget: Object.freeze({
      provider: model.provider,
      providerModelId: model.providerModelId,
      remoteModelCatalogId: model.remoteModelCatalogId,
    }),
  }));
}
