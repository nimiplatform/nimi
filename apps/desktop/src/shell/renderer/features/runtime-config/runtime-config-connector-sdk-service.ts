import { createNimiRuntimeConnectorInventoryClient, defaultNimiRuntimeConnectorAuthOptionForProvider, listNimiRuntimeConnectorAuthOptionsForProvider, providerToNimiRuntimeConnectorVendor, resolveNimiRuntimeConnectorProviderEndpoint, nimiRuntimeConnectorAuthProfileForId, nimiRuntimeConnectorToProjection, runtimeConnectorProjectionToNimiRuntimeConfigConnector, nimiRuntimeConnectorVendorToProvider, type NimiRuntimeConnectorAuthProfileSpec, type NimiRuntimeConnectorAuthOption, type NimiRuntimeConnectorClient, type NimiRuntimeConnectorModelInfo, type NimiRuntimeConnectorProjection, type NimiRuntimeConnectorProjectionInput } from '@nimiplatform/sdk/runtime';
import { type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import { type ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import type {
  ApiConnector,
  ApiConnectorAuthModeV11,
  ApiVendor,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

const CONNECTOR_CALL_OPTIONS: RuntimeTypedCallOptions = {
  timeoutMs: 5000,
  metadata: {
    callerKind: 'desktop-core',
    callerId: 'runtime-config.connector',
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

export const runtimeConnectors: NimiRuntimeConnectorClient = {
  listProviderCatalog: (request, options) => getDesktopRuntime().connectors.listProviderCatalog(request, options),
  listConnectors: (request, options) => getDesktopRuntime().connectors.listConnectors(request, options),
  createConnector: (request, options) => getDesktopRuntime().connectors.createConnector(request, options),
  updateConnector: (request, options) => getDesktopRuntime().connectors.updateConnector(request, options),
  deleteConnector: (request, options) => getDesktopRuntime().connectors.deleteConnector(request, options),
  testConnector: (request, options) => getDesktopRuntime().connectors.testConnector(request, options),
  listConnectorModels: (request, options) => getDesktopRuntime().connectors.listConnectorModels(request, options),
};

const runtimeConnectorInventory = createNimiRuntimeConnectorInventoryClient({
  connectors: runtimeConnectors,
  callOptions: CONNECTOR_CALL_OPTIONS,
});

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

export function clearRuntimeConnectorSdkCaches(): void {
  runtimeConnectorInventory.clearCaches();
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

export async function sdkListProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  return [...await runtimeConnectorInventory.listProviderCatalog()];
}

export async function sdkListConnectors(): Promise<ApiConnector[]> {
  const connectors = await runtimeConnectorInventory.listConnectors();
  return connectors.map(runtimeConnectorProjectionToApiConnector);
}

export async function sdkCreateConnector(input: {
  provider: string;
  endpoint: string;
  label: string;
  apiKey?: string;
  credentialValue?: string;
  credentialJson?: string;
  authMode?: ApiConnectorAuthModeV11;
  providerAuthProfile?: string;
}): Promise<ApiConnector | null> {
  const connector = await runtimeConnectorInventory.createConnector(input);
  return connector ? runtimeConnectorProjectionToApiConnector(connector) : null;
}

export async function sdkUpdateConnector(input: {
  connectorId: string;
  label?: string;
  endpoint?: string;
  apiKey?: string;
  credentialValue?: string;
  credentialJson?: string;
  authMode?: ApiConnectorAuthModeV11;
  providerAuthProfile?: string;
}): Promise<ApiConnector | null> {
  const connector = await runtimeConnectorInventory.updateConnector(input);
  return connector ? runtimeConnectorProjectionToApiConnector(connector) : null;
}

export async function sdkDeleteConnector(connectorId: string): Promise<void> {
  await runtimeConnectorInventory.deleteConnector(connectorId);
}

export async function sdkTestConnector(connectorId: string): Promise<void> {
  await runtimeConnectorInventory.testConnector(connectorId);
}

export async function sdkListConnectorModels(
  connectorId: string,
  forceRefresh: boolean = false,
): Promise<string[]> {
  return [...await runtimeConnectorInventory.listConnectorModels(connectorId, forceRefresh)];
}

export async function sdkListConnectorModelDescriptors(
  connectorId: string,
  forceRefresh: boolean = false,
): Promise<ConnectorModelInfo[]> {
  return [...await runtimeConnectorInventory.listConnectorModelDescriptors(connectorId, forceRefresh)];
}
