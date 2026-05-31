import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createRuntimeConnectorInventoryClient,
  defaultRuntimeConnectorAuthOptionForProvider,
  listRuntimeConnectorAuthOptionsForProvider,
  providerToRuntimeConnectorVendor,
  resolveRuntimeConnectorProviderEndpoint,
  runtimeConnectorAuthProfileForId,
  runtimeConnectorToProjection,
  runtimeConnectorProjectionToRuntimeConfigConnector,
  runtimeConnectorVendorToProvider,
  type ConnectorAuthProfileSpec,
  type ProviderCatalogEntry,
  type RuntimeCallOptions,
  type RuntimeConnectorAuthOption,
  type RuntimeConnectorModelInfo,
  type RuntimeConnectorProjection,
  type RuntimeConnectorProjectionInput,
} from '@nimiplatform/sdk/runtime';
import type {
  ApiConnector,
  ApiConnectorAuthModeV11,
  ApiVendor,
} from '@renderer/features/runtime-config/runtime-config-state-types';

const CONNECTOR_CALL_OPTIONS: RuntimeCallOptions = {
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

export type ConnectorModelInfo = RuntimeConnectorModelInfo;

const runtimeConnectorInventory = createRuntimeConnectorInventoryClient({
  runtimeAdmin: () => getPlatformClient().domains.runtimeAdmin,
  callOptions: CONNECTOR_CALL_OPTIONS,
});

function runtimeConnectorProjectionToApiConnector(
  connector: RuntimeConnectorProjection,
): ApiConnector {
  return runtimeConnectorProjectionToRuntimeConfigConnector(connector);
}

function runtimeConnectorAuthOptionToApiOption(
  option: RuntimeConnectorAuthOption,
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
  return resolveRuntimeConnectorProviderEndpoint(provider, catalog);
}

export function providerToVendor(provider: string): ApiVendor {
  return providerToRuntimeConnectorVendor(provider) as ApiVendor;
}

export function vendorToProvider(vendor: ApiVendor): string {
  return runtimeConnectorVendorToProvider(vendor);
}

export function connectorAuthProfileForId(profileId: string | undefined): ConnectorAuthProfileSpec | null {
  return runtimeConnectorAuthProfileForId(profileId);
}

export function listConnectorAuthOptionsForProvider(
  provider: string,
  catalog?: ProviderCatalogEntry[],
): ApiConnectorAuthOption[] {
  return listRuntimeConnectorAuthOptionsForProvider(provider, catalog).map(runtimeConnectorAuthOptionToApiOption);
}

export function defaultConnectorAuthOptionForProvider(
  provider: string,
  catalog?: ProviderCatalogEntry[],
): ApiConnectorAuthOption {
  return runtimeConnectorAuthOptionToApiOption(defaultRuntimeConnectorAuthOptionForProvider(provider, catalog));
}

export function sdkConnectorToApiConnector(
  connector: RuntimeConnectorProjectionInput,
  providerCatalog: ProviderCatalogEntry[],
  models?: string[],
): ApiConnector {
  return runtimeConnectorProjectionToApiConnector(
    runtimeConnectorToProjection(connector, providerCatalog, models),
  );
}

export async function sdkListProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  return runtimeConnectorInventory.listProviderCatalog();
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
  return runtimeConnectorInventory.listConnectorModels(connectorId, forceRefresh);
}

export async function sdkListConnectorModelDescriptors(
  connectorId: string,
  forceRefresh: boolean = false,
): Promise<ConnectorModelInfo[]> {
  return runtimeConnectorInventory.listConnectorModelDescriptors(connectorId, forceRefresh);
}
