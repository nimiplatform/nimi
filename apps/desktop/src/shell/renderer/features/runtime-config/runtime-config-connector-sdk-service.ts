import {
  createNimiRuntimeConnectorInventoryClient,
  defaultNimiRuntimeConnectorAuthOptionForProvider,
  listNimiRuntimeConnectorAuthOptionsForProvider,
  providerToNimiRuntimeConnectorVendor,
  resolveNimiRuntimeConnectorProviderEndpoint,
  nimiRuntimeConnectorAuthProfileForId,
  nimiRuntimeConnectorToProjection,
  runtimeConnectorProjectionToNimiRuntimeConfigConnector,
  nimiRuntimeConnectorVendorToProvider,
  type NimiRuntimeConnectorAuthProfileSpec,
  type NimiRuntimeConnectorAuthOption,
  type NimiRuntimeConnectorClient,
  type NimiRuntimeConnectorModelInfo,
  type NimiRuntimeConnectorProjection,
  type NimiRuntimeConnectorProjectionInput,
} from '@nimiplatform/sdk/runtime';
import { type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import { type ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import type {
  ApiConnector,
  ApiConnectorAuthModeV11,
  ApiVendor,
} from './runtime-config-state-types';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

const CONNECTOR_CALL_OPTIONS: RuntimeTypedCallOptions = {
  timeoutMs: 5000,
  metadata: {
    surfaceId: 'runtime.config',
  },
};

export type ApiConnectorAuthOption = {
  value: string;
  label: string;
  authMode: ApiConnectorAuthModeV11;
  providerAuthProfile?: string;
};

export type ConnectorModelInfo = NimiRuntimeConnectorModelInfo;

export type RuntimeConfigConnectorSdkService = Readonly<{
  clearCaches(): void;
  sdkListProviderCatalog(): Promise<ProviderCatalogEntry[]>;
  sdkListConnectors(): Promise<ApiConnector[]>;
  sdkCreateConnector(input: {
    provider: string;
    endpoint: string;
    label: string;
    apiKey?: string;
    credentialValue?: string;
    authMode?: 'api_key';
  }): Promise<ApiConnector | null>;
  sdkUpdateConnector(input: {
    connectorId: string;
    label?: string;
    endpoint?: string;
    apiKey?: string;
    credentialValue?: string;
    authMode?: 'api_key';
  }): Promise<ApiConnector | null>;
  sdkDeleteConnector(connectorId: string): Promise<void>;
  sdkTestConnector(connectorId: string): Promise<void>;
  sdkListConnectorModels(connectorId: string, forceRefresh?: boolean): Promise<string[]>;
  sdkListConnectorModelDescriptors(
    connectorId: string,
    forceRefresh?: boolean,
  ): Promise<ConnectorModelInfo[]>;
}>;

function runtimeConnectorProjectionToApiConnector(
  connector: NimiRuntimeConnectorProjection,
): ApiConnector {
  return runtimeConnectorProjectionToNimiRuntimeConfigConnector(connector);
}

function runtimeConnectorAuthOptionToApiOption(
  option: NimiRuntimeConnectorAuthOption,
): ApiConnectorAuthOption {
  return {
    value: option.value,
    label: option.label,
    authMode: option.authMode,
    providerAuthProfile: option.providerAuthProfile,
  };
}

export function createRuntimeConfigConnectorSdkService(
  getConnectors: () => ReturnType<DesktopRendererSdkPort['connectorAdmin']>,
): RuntimeConfigConnectorSdkService {
  const runtimeConnectors: NimiRuntimeConnectorClient = Object.freeze({
    listProviderCatalog: (request, options) => getConnectors().listProviderCatalog(request, options),
    listConnectors: (request, options) => getConnectors().listConnectors(request, options),
    createConnector: (request, options) => getConnectors().createConnector(request, options),
    updateConnector: (request, options) => getConnectors().updateConnector(request, options),
    deleteConnector: (request, options) => getConnectors().deleteConnector(request, options),
    testConnector: (request, options) => getConnectors().testConnector(request, options),
    listConnectorModels: (request, options) => getConnectors().listConnectorModels(request, options),
  });
  const inventory = createNimiRuntimeConnectorInventoryClient({
    connectors: runtimeConnectors,
    callOptions: CONNECTOR_CALL_OPTIONS,
  });

  return Object.freeze({
    clearCaches: () => inventory.clearCaches(),
    async sdkListProviderCatalog() {
      return [...await inventory.listProviderCatalog()];
    },
    async sdkListConnectors() {
      const connectors = await inventory.listConnectors();
      return connectors.map(runtimeConnectorProjectionToApiConnector);
    },
    async sdkCreateConnector(input) {
      assertRendererConnectorMutation(input);
      const connector = await inventory.createConnector(input);
      return connector ? runtimeConnectorProjectionToApiConnector(connector) : null;
    },
    async sdkUpdateConnector(input) {
      assertRendererConnectorMutation(input);
      const connector = await inventory.updateConnector(input);
      return connector ? runtimeConnectorProjectionToApiConnector(connector) : null;
    },
    async sdkDeleteConnector(connectorId) {
      await inventory.deleteConnector(connectorId);
    },
    async sdkTestConnector(connectorId) {
      await inventory.testConnector(connectorId);
    },
    async sdkListConnectorModels(connectorId, forceRefresh = false) {
      return [...await inventory.listConnectorModels(connectorId, forceRefresh)];
    },
    async sdkListConnectorModelDescriptors(connectorId, forceRefresh = false) {
      return [...await inventory.listConnectorModelDescriptors(connectorId, forceRefresh)];
    },
  });
}

function assertRendererConnectorMutation(input: Readonly<Record<string, unknown>>): void {
  if (input.authMode === 'oauth_managed' || Object.hasOwn(input, 'credentialJson')) {
    throw new Error('Managed OAuth credential custody requires the Desktop native host.');
  }
}

export function resolveProviderEndpoint(
  provider: string,
  catalog: ProviderCatalogEntry[],
): string {
  return resolveNimiRuntimeConnectorProviderEndpoint(provider, catalog);
}

export function providerToVendor(provider: string): ApiVendor {
  return providerToNimiRuntimeConnectorVendor(provider) as ApiVendor;
}

export function vendorToProvider(vendor: ApiVendor): string {
  return nimiRuntimeConnectorVendorToProvider(vendor);
}

export function connectorAuthProfileForId(profileId: string | undefined): NimiRuntimeConnectorAuthProfileSpec | null {
  return nimiRuntimeConnectorAuthProfileForId(profileId);
}

export function listConnectorAuthOptionsForProvider(
  provider: string,
  catalog?: ProviderCatalogEntry[],
): ApiConnectorAuthOption[] {
  return listNimiRuntimeConnectorAuthOptionsForProvider(provider, catalog).map(runtimeConnectorAuthOptionToApiOption);
}

export function defaultConnectorAuthOptionForProvider(
  provider: string,
  catalog?: ProviderCatalogEntry[],
): ApiConnectorAuthOption {
  return runtimeConnectorAuthOptionToApiOption(defaultNimiRuntimeConnectorAuthOptionForProvider(provider, catalog));
}

export function sdkConnectorToApiConnector(
  connector: NimiRuntimeConnectorProjectionInput,
  providerCatalog: ProviderCatalogEntry[],
  models?: string[],
): ApiConnector {
  return runtimeConnectorProjectionToApiConnector(
    nimiRuntimeConnectorToProjection(connector, providerCatalog, models),
  );
}
