import type {
  AgentCenterCloudAIConfigModule,
  AgentCenterCloudGrantOption,
  AgentCenterCloudTargetOption,
} from '@nimiplatform/kit/features/agent-center';
import {
  createNimiRuntimeConnectorInventoryClient,
  createNimiRuntimeModelCatalogClient,
  projectNimiRuntimeCloudImplementationOptions,
  type NimiRuntimeModelCatalogConnectorClient,
} from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

const PAGE_SIZE = 500;
const MAX_PAGES = 200;

/** Runtime catalog and account-authorization composition for first-party Cloud configuration. */
export function createDesktopCloudAIConfigModule(
  sdk: Pick<DesktopRendererSdkPort, 'connectorAdmin' | 'accountProduct'>,
): AgentCenterCloudAIConfigModule {
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

  const module: AgentCenterCloudAIConfigModule = {
    async listImplementations(capabilityContract: string) {
      return projectNimiRuntimeCloudImplementationOptions(
        await catalog.listProviders(),
        capabilityContract,
      );
    },

    async listTargets(input: { readonly capabilityContract: string; readonly provider: string }) {
      const provider = (await catalog.listProviders()).find((entry) => (
        entry.provider === input.provider
        && entry.runtimePlane === 'remote'
        && entry.managedSupported
        && entry.capabilities.includes(input.capabilityContract)
      ));
      if (!provider) throw new Error('DESKTOP_CLOUD_IMPLEMENTATION_NOT_IN_RUNTIME_CATALOG');

      const targets = new Map<string, AgentCenterCloudTargetOption>();
      const seenPageTokens = new Set<string>();
      let pageToken = '';
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await catalog.listProviderModels(provider.provider, PAGE_SIZE, pageToken);
        for (const model of response.models) {
          if (model.capabilities.includes(input.capabilityContract)) {
            addTarget(targets, provider.provider, model.modelId);
          }
        }
        pageToken = response.nextPageToken;
        if (!pageToken) break;
        if (seenPageTokens.has(pageToken)) {
          throw new Error('DESKTOP_CLOUD_TARGET_CATALOG_PAGE_TOKEN_REPEATED');
        }
        seenPageTokens.add(pageToken);
      }
      if (pageToken) throw new Error('DESKTOP_CLOUD_TARGET_CATALOG_PAGE_LIMIT_EXCEEDED');
      if (input.capabilityContract === 'text.generate') {
        addTarget(targets, provider.provider, provider.defaultTextModel);
      }
      return Object.freeze([...targets.values()].sort((left, right) => left.label.localeCompare(right.label)));
    },

    async listAuthorizationOptions() {
      const [connectorSnapshot, grants] = await Promise.all([
        inventory.listConnectors(),
        sdk.accountProduct().connectorGrants.list(),
      ]);
      const connectors = connectorSnapshot.map((item) => Object.freeze({
        connectorId: item.id,
        label: item.label || item.id,
        provider: item.provider,
      }));
      return Object.freeze({
        connectors: Object.freeze(connectors),
        grants: Object.freeze(grants.map(toGrantOption)),
      });
    },

    async createGrant(connectorId: string) {
      return toGrantOption(await sdk.accountProduct().connectorGrants.create(connectorId));
    },
  };
  return Object.freeze(module);
}

function addTarget(
  targets: Map<string, AgentCenterCloudTargetOption>,
  provider: string,
  modelId: string,
): void {
  if (!modelId) return;
  const targetId = JSON.stringify([provider, modelId]);
  if (targets.has(targetId)) return;
  targets.set(targetId, Object.freeze({
    targetId,
    label: modelId,
    provider,
    providerModelTarget: Object.freeze({ provider, providerModelId: modelId }),
  }));
}

function toGrantOption(
  grant: Awaited<ReturnType<ReturnType<DesktopRendererSdkPort['accountProduct']>['connectorGrants']['create']>>,
): AgentCenterCloudGrantOption {
  return Object.freeze({
    grantId: grant.grantId,
    connectorId: grant.connectorId,
    status: grant.status,
    createdAt: grant.createdAt,
    revokedAt: grant.revokedAt,
  });
}
