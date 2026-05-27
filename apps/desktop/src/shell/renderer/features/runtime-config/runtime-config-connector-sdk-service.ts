import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createNimiError,
  RuntimeReasonCode,
  ConnectorAuthKind,
  type ProviderCatalogEntry,
  CONNECTOR_AUTH_PROFILES,
  type ConnectorAuthProfileSpec,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  getVendorLabelV11,
  type ApiConnector,
  type ApiConnectorAuthModeV11,
  type ApiConnectorScopeV11,
  type ApiVendor,
} from '@renderer/features/runtime-config/runtime-config-state-types';

const CONNECTOR_CALL_OPTIONS = {
  timeoutMs: 5000,
  metadata: {
    callerKind: 'desktop-core' as const,
    callerId: 'runtime-config.connector',
    surfaceId: 'runtime.config',
  },
};
const CONNECTOR_MODELS_PAGE_SIZE = 200;
const CONNECTOR_MODELS_MAX_PAGES = 200;
const PROVIDER_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const CONNECTOR_LIST_CACHE_TTL_MS = 15 * 1000;
const CONNECTOR_MODEL_CACHE_TTL_MS = 30 * 1000;

const CONNECTOR_KIND_REMOTE_MANAGED = 2;
const CONNECTOR_OWNER_TYPE_SYSTEM = 1;

let cachedProviderCatalog: ProviderCatalogEntry[] | null = null;
let cachedProviderCatalogAt = 0;
let cachedConnectors: ApiConnector[] | null = null;
let cachedConnectorsAt = 0;
let pendingConnectors: Promise<ApiConnector[]> | null = null;
let connectorInventoryCacheGeneration = 0;

type RuntimeConnectorLike = {
  connectorId: string;
  provider: string;
  endpoint: string;
  label: string;
  hasCredential: boolean;
  authKind?: number;
  providerAuthProfile?: string;
  ownerType: number;
  ownerId?: string;
  kind: number;
  status: number;
};

export type ApiConnectorAuthOption = {
  value: string;
  label: string;
  authMode: ApiConnectorAuthModeV11;
  providerAuthProfile?: string;
};

type RuntimeConnectorModelLike = {
  available?: boolean;
  modelId?: string;
  capabilities?: string[];
};

export type ConnectorModelInfo = {
  modelId: string;
  capabilities: string[];
};

const cachedConnectorModels = new Map<string, { at: number; value: ConnectorModelInfo[] }>();
const pendingConnectorModels = new Map<string, Promise<ConnectorModelInfo[]>>();

function cloneConnector(connector: ApiConnector): ApiConnector {
  return {
    ...connector,
    models: Array.isArray(connector.models) ? [...connector.models] : [],
  };
}

function cloneConnectors(connectors: ApiConnector[]): ApiConnector[] {
  return connectors.map(cloneConnector);
}

function cloneConnectorModelInfo(model: ConnectorModelInfo): ConnectorModelInfo {
  return {
    modelId: model.modelId,
    capabilities: Array.isArray(model.capabilities) ? [...model.capabilities] : [],
  };
}

function cloneConnectorModelInfos(models: ConnectorModelInfo[]): ConnectorModelInfo[] {
  return models.map(cloneConnectorModelInfo);
}

function invalidateConnectorInventoryCache(): void {
  connectorInventoryCacheGeneration += 1;
  cachedConnectors = null;
  cachedConnectorsAt = 0;
  pendingConnectors = null;
  cachedConnectorModels.clear();
  pendingConnectorModels.clear();
}

export function clearRuntimeConnectorSdkCaches(): void {
  cachedProviderCatalog = null;
  cachedProviderCatalogAt = 0;
  invalidateConnectorInventoryCache();
}

function runtimeReasonCodeName(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  const enumName = (RuntimeReasonCode as unknown as Record<number, string>)[value];
  if (!enumName || enumName === 'REASON_CODE_UNSPECIFIED') {
    return '';
  }
  return String(enumName || '').trim();
}

function runtimeAdmin() {
  return getPlatformClient().domains.runtimeAdmin;
}

export async function sdkListProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  const now = Date.now();
  if (
    cachedProviderCatalog
    && now - cachedProviderCatalogAt < PROVIDER_CATALOG_CACHE_TTL_MS
  ) {
    return cachedProviderCatalog;
  }
  const response = await runtimeAdmin().listProviderCatalog({}, CONNECTOR_CALL_OPTIONS);
  const providers = Array.isArray(response.providers)
    ? (response.providers as ProviderCatalogEntry[])
    : [];
  cachedProviderCatalog = providers;
  cachedProviderCatalogAt = now;
  return providers;
}

export function resolveProviderEndpoint(
  provider: string,
  catalog: ProviderCatalogEntry[],
): string {
  const entry = catalog.find((item: ProviderCatalogEntry) => item.provider === provider);
  return entry?.defaultEndpoint || '';
}

export function providerToVendor(provider: string): ApiVendor {
  const normalized = String(provider || '').trim().toLowerCase();
  return normalized || 'custom';
}

export function vendorToProvider(vendor: ApiVendor): string {
  return String(vendor || '').trim().toLowerCase() || 'custom';
}

function normalizeProviderAuthProfile(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function authOptionLabelForProfile(profile: ConnectorAuthProfileSpec): string {
  if (profile.id === 'openai_codex') return 'Managed OAuth Token (Codex)';
  if (profile.id === 'anthropic') return 'Managed OAuth Token (Anthropic)';
  if (profile.id === 'qwen_oauth') return 'Managed OAuth Token (Qwen)';
  return `Managed OAuth Token (${profile.id})`;
}

export function listProviderAuthProfiles(provider: string): ConnectorAuthProfileSpec[] {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (!normalizedProvider) {
    return [];
  }
  return Object.values(CONNECTOR_AUTH_PROFILES)
    .filter((profile) => (
      profile.allowedProviders.map((item) => String(item || '').trim().toLowerCase()).includes(normalizedProvider)
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function listConnectorAuthOptionsForProvider(provider: string): ApiConnectorAuthOption[] {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const profileOptions = listProviderAuthProfiles(normalizedProvider).map((profile) => ({
    value: `oauth:${profile.id}`,
    label: authOptionLabelForProfile(profile),
    authMode: 'oauth_managed' as const,
    providerAuthProfile: profile.id,
  }));
  if (normalizedProvider === 'openai_codex') {
    return profileOptions;
  }
  return [
    {
      value: 'api_key',
      label: 'API Key',
      authMode: 'api_key',
    },
    ...profileOptions,
  ];
}

export function defaultConnectorAuthOptionForProvider(provider: string): ApiConnectorAuthOption {
  const options = listConnectorAuthOptionsForProvider(provider);
  return options[0] || {
    value: 'api_key',
    label: 'API Key',
    authMode: 'api_key',
  };
}

function authModeFromRuntimeAuthKind(value: unknown): ApiConnectorAuthModeV11 {
  return Number(value) === Number(ConnectorAuthKind.OAUTH_MANAGED) ? 'oauth_managed' : 'api_key';
}

function buildCredentialJsonFromSecret(secret: string): string {
  return JSON.stringify({ access_token: String(secret || '').trim() });
}

function resolveCredentialJsonInput(input: {
  credentialValue?: string;
  credentialJson?: string;
}): string {
  const explicitCredentialJson = String(input.credentialJson || '').trim();
  if (explicitCredentialJson) {
    return explicitCredentialJson;
  }
  return buildCredentialJsonFromSecret(String(input.credentialValue || '').trim());
}

export function sdkConnectorToApiConnector(
  connector: {
    connectorId: string;
    provider: string;
    endpoint: string;
    label: string;
    hasCredential: boolean;
    authKind?: number;
    providerAuthProfile?: string;
    ownerType: number;
    ownerId?: string;
    kind: number;
    status: number;
  },
  providerCatalog: ProviderCatalogEntry[],
  models?: string[],
): ApiConnector {
  const vendor = providerToVendor(connector.provider);
  const defaultEndpoint = resolveProviderEndpoint(connector.provider, providerCatalog);
  const normalizedOwnerId = String(connector.ownerId || '').trim().toLowerCase();
  const scope: ApiConnectorScopeV11 = connector.ownerType === CONNECTOR_OWNER_TYPE_SYSTEM
    ? (normalizedOwnerId === 'machine' ? 'machine-global' : 'runtime-system')
    : 'user';
  return {
    id: connector.connectorId,
    label: connector.label || `${getVendorLabelV11(vendor)} Connector`,
    vendor,
    provider: connector.provider,
    authMode: authModeFromRuntimeAuthKind(connector.authKind),
    providerAuthProfile: normalizeProviderAuthProfile(connector.providerAuthProfile || '') || undefined,
    endpoint: connector.endpoint || defaultEndpoint,
    scope,
    hasCredential: connector.hasCredential,
    isSystemOwned: scope !== 'user',
    models: models && models.length > 0 ? models : [],
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  };
}

export async function sdkListConnectors(): Promise<ApiConnector[]> {
  const now = Date.now();
  if (
    cachedConnectors
    && now - cachedConnectorsAt < CONNECTOR_LIST_CACHE_TTL_MS
  ) {
    return cloneConnectors(cachedConnectors);
  }
  if (pendingConnectors) {
    return cloneConnectors(await pendingConnectors);
  }
  const cacheGeneration = connectorInventoryCacheGeneration;
  pendingConnectors = (async () => {
    const providerCatalog = await sdkListProviderCatalog();
    const request = {
      pageSize: 0,
      pageToken: '',
      kindFilter: CONNECTOR_KIND_REMOTE_MANAGED,
      statusFilter: 0,
      providerFilter: '',
    };
    const response = await runtimeAdmin().listConnectors(request, CONNECTOR_CALL_OPTIONS);
    const connectors = Array.isArray(response.connectors)
      ? (response.connectors as RuntimeConnectorLike[])
      : [];
    const remoteConnectors = connectors.filter(
      (connector: RuntimeConnectorLike) => connector.kind === CONNECTOR_KIND_REMOTE_MANAGED,
    );
    const result = remoteConnectors.map((connector: RuntimeConnectorLike) => sdkConnectorToApiConnector(connector, providerCatalog));
    if (cacheGeneration === connectorInventoryCacheGeneration) {
      cachedConnectors = cloneConnectors(result);
      cachedConnectorsAt = Date.now();
    }
    return result;
  })();
  const pending = pendingConnectors;
  try {
    return cloneConnectors(await pending);
  } finally {
    if (pendingConnectors === pending) {
      pendingConnectors = null;
    }
  }
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
  const authMode = input.authMode === 'oauth_managed' ? 'oauth_managed' : 'api_key';
  const providerAuthProfile = normalizeProviderAuthProfile(input.providerAuthProfile || '');
  const credentialValue = String(input.credentialValue ?? input.apiKey ?? '').trim();
  const response = await runtimeAdmin().createConnector({
    provider: input.provider,
    endpoint: input.endpoint,
    label: input.label,
    apiKey: authMode === 'api_key' ? credentialValue : '',
    authKind: authMode === 'oauth_managed'
      ? ConnectorAuthKind.OAUTH_MANAGED
      : ConnectorAuthKind.API_KEY,
    providerAuthProfile: authMode === 'oauth_managed' ? providerAuthProfile : '',
    credentialJson: authMode === 'oauth_managed'
      ? resolveCredentialJsonInput({
        credentialValue,
        credentialJson: input.credentialJson,
      })
      : '',
  }, CONNECTOR_CALL_OPTIONS);
  invalidateConnectorInventoryCache();
  if (!response.connector) return null;
  const providerCatalog = await sdkListProviderCatalog();
  return sdkConnectorToApiConnector(response.connector, providerCatalog);
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
  const authMode = input.authMode;
  const credentialValue = String(input.credentialValue ?? input.apiKey ?? '').trim();
  const providerAuthProfile = normalizeProviderAuthProfile(input.providerAuthProfile || '');
  const response = await runtimeAdmin().updateConnector({
    connectorId: input.connectorId,
    label: input.label || '',
    endpoint: input.endpoint || '',
    apiKey: authMode === 'api_key' ? credentialValue : (input.apiKey || ''),
    status: 0,
    authKind: authMode
      ? (authMode === 'oauth_managed'
        ? ConnectorAuthKind.OAUTH_MANAGED
        : ConnectorAuthKind.API_KEY)
      : undefined,
    providerAuthProfile: authMode === 'oauth_managed' ? providerAuthProfile : undefined,
    credentialJson: authMode === 'oauth_managed'
      ? resolveCredentialJsonInput({
        credentialValue,
        credentialJson: input.credentialJson,
      })
      : undefined,
  }, CONNECTOR_CALL_OPTIONS);
  invalidateConnectorInventoryCache();
  if (!response.connector) return null;
  const providerCatalog = await sdkListProviderCatalog();
  return sdkConnectorToApiConnector(response.connector, providerCatalog);
}

export async function sdkDeleteConnector(connectorId: string): Promise<void> {
  await runtimeAdmin().deleteConnector(
    { connectorId },
    CONNECTOR_CALL_OPTIONS,
  );
  invalidateConnectorInventoryCache();
}

export async function sdkTestConnector(connectorId: string): Promise<void> {
  const response = await runtimeAdmin().testConnector(
    { connectorId },
    CONNECTOR_CALL_OPTIONS,
  );
  const ack = response.ack;
  if (!ack) {
    throw createNimiError({
      message: 'connector test failed: empty ack payload',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_or_check_runtime_status',
      source: 'runtime',
      details: {
        connectorId,
      },
    });
  }
  if (ack.ok) return;

  const reasonCode = runtimeReasonCodeName(ack.reasonCode) || ReasonCode.RUNTIME_CALL_FAILED;
  throw createNimiError({
    message: `connector test failed: ${reasonCode}`,
    reasonCode,
    code: reasonCode,
    actionHint: String(ack.actionHint || '').trim() || 'check_connector_config',
    source: 'runtime',
    details: {
      connectorId,
      ackReasonCode: ack.reasonCode,
    },
  });
}

export async function sdkListConnectorModels(
  connectorId: string,
  forceRefresh: boolean = false,
): Promise<string[]> {
  const descriptors = await sdkListConnectorModelDescriptors(connectorId, forceRefresh);
  return descriptors.map((item) => item.modelId);
}

export async function sdkListConnectorModelDescriptors(
  connectorId: string,
  forceRefresh: boolean = false,
): Promise<ConnectorModelInfo[]> {
  const normalizedConnectorId = String(connectorId || '').trim();
  const now = Date.now();
  if (!forceRefresh) {
    const cached = cachedConnectorModels.get(normalizedConnectorId);
    if (cached && now - cached.at < CONNECTOR_MODEL_CACHE_TTL_MS) {
      return cloneConnectorModelInfos(cached.value);
    }
    const pending = pendingConnectorModels.get(normalizedConnectorId);
    if (pending) {
      return cloneConnectorModelInfos(await pending);
    }
  }
  const cacheGeneration = connectorInventoryCacheGeneration;
  const pending = (async () => {
    const descriptors: ConnectorModelInfo[] = [];
    const seenModelIds = new Set<string>();
    let pageToken = '';
    for (let pageIndex = 0; pageIndex < CONNECTOR_MODELS_MAX_PAGES; pageIndex += 1) {
      const request = {
        connectorId: normalizedConnectorId,
        forceRefresh: pageIndex === 0 ? forceRefresh : false,
        pageSize: CONNECTOR_MODELS_PAGE_SIZE,
        pageToken,
      };
      const response = await runtimeAdmin().listConnectorModels(request, CONNECTOR_CALL_OPTIONS);
      const models = Array.isArray(response.models)
        ? (response.models as RuntimeConnectorModelLike[])
        : [];
      const pageItems = models
        .filter((item: RuntimeConnectorModelLike) => Boolean(item.available))
        .map((item: RuntimeConnectorModelLike) => ({
          modelId: String(item.modelId || '').trim(),
          capabilities: Array.isArray(item.capabilities)
            ? item.capabilities.map((capability: string) => String(capability || '').trim()).filter(Boolean)
            : [],
        }))
        .filter((item: ConnectorModelInfo) => item.modelId.length > 0);
      for (const item of pageItems) {
        if (seenModelIds.has(item.modelId)) {
          continue;
        }
        seenModelIds.add(item.modelId);
        descriptors.push(item);
      }
      pageToken = String(response.nextPageToken || '').trim();
      if (!pageToken) {
        break;
      }
    }
    if (cacheGeneration === connectorInventoryCacheGeneration) {
      cachedConnectorModels.set(normalizedConnectorId, {
        at: Date.now(),
        value: cloneConnectorModelInfos(descriptors),
      });
    }
    return descriptors;
  })();
  if (!forceRefresh) {
    pendingConnectorModels.set(normalizedConnectorId, pending);
  }
  try {
    return cloneConnectorModelInfos(await pending);
  } finally {
    if (!forceRefresh && pendingConnectorModels.get(normalizedConnectorId) === pending) {
      pendingConnectorModels.delete(normalizedConnectorId);
    }
  }
}
