import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../core/errors.js';
import type { RuntimeCallOptions } from './types.js';
import {
  ConnectorAuthKind,
  ConnectorKind,
  ConnectorOwnerType,
  ConnectorStatus,
  type ProviderCatalogEntry,
} from './generated/runtime/v1/connector.js';
import type { ReasonCode as RuntimeReasonCode } from './generated/runtime/v1/common.js';
import { normalizeRuntimeReasonCode } from './reason-code-messages.js';
import {
  CONNECTOR_AUTH_PROFILES,
  type ConnectorAuthProfileSpec,
} from './connector-auth-profiles.generated.js';

const DEFAULT_CONNECTOR_MODELS_PAGE_SIZE = 200;
const DEFAULT_CONNECTOR_MODELS_MAX_PAGES = 200;
const DEFAULT_PROVIDER_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CONNECTOR_LIST_CACHE_TTL_MS = 15 * 1000;
const DEFAULT_CONNECTOR_MODEL_CACHE_TTL_MS = 30 * 1000;

export type RuntimeConnectorAuthMode = 'api_key' | 'oauth_managed';
export type RuntimeConnectorScope = 'user' | 'machine-global' | 'runtime-system';

export type RuntimeConnectorAuthOption = {
  value: string;
  label: string;
  authMode: RuntimeConnectorAuthMode;
  providerAuthProfile?: string;
};

export type RuntimeConnectorProjection = {
  id: string;
  label: string;
  vendor: string;
  provider: string;
  authMode: RuntimeConnectorAuthMode;
  providerAuthProfile?: string;
  endpoint: string;
  scope: RuntimeConnectorScope;
  hasCredential: boolean;
  isSystemOwned: boolean;
  models: string[];
};

export type RuntimeConnectorModelInfo = {
  modelId: string;
  capabilities: string[];
};

export type RuntimeConnectorProjectionInput = {
  connectorId: string;
  provider: string;
  endpoint: string;
  label: string;
  hasCredential: boolean;
  authKind?: ConnectorAuthKind;
  providerAuthProfile?: string;
  ownerType: ConnectorOwnerType;
  ownerId?: string;
  kind: ConnectorKind;
  status: ConnectorStatus;
};

type RuntimeConnectorModelProjectionInput = {
  available?: boolean;
  modelId?: string;
  capabilities?: string[];
};

export type RuntimeConnectorAdminClient = {
  listProviderCatalog(
    input: Record<string, never>,
    options?: RuntimeCallOptions,
  ): Promise<{ providers?: ProviderCatalogEntry[] }>;
  listConnectors(
    input: {
      pageSize?: number;
      pageToken?: string;
      kindFilter?: ConnectorKind;
      statusFilter?: ConnectorStatus;
      providerFilter?: string;
    },
    options?: RuntimeCallOptions,
  ): Promise<{ connectors?: RuntimeConnectorProjectionInput[] }>;
  createConnector(
    input: {
      provider: string;
      endpoint: string;
      label: string;
      apiKey?: string;
      authKind?: ConnectorAuthKind;
      providerAuthProfile?: string;
      credentialJson?: string;
    },
    options?: RuntimeCallOptions,
  ): Promise<{ connector?: RuntimeConnectorProjectionInput }>;
  updateConnector(
    input: {
      connectorId: string;
      label?: string;
      endpoint?: string;
      apiKey?: string;
      status?: number;
      authKind?: ConnectorAuthKind;
      providerAuthProfile?: string;
      credentialJson?: string;
    },
    options?: RuntimeCallOptions,
  ): Promise<{ connector?: RuntimeConnectorProjectionInput }>;
  deleteConnector(
    input: { connectorId: string },
    options?: RuntimeCallOptions,
  ): Promise<unknown>;
  testConnector(
    input: { connectorId: string },
    options?: RuntimeCallOptions,
  ): Promise<{
    ack?: {
      ok?: boolean;
      reasonCode?: RuntimeReasonCode | number;
      actionHint?: string;
    };
  }>;
  listConnectorModels(
    input: {
      connectorId: string;
      forceRefresh?: boolean;
      pageSize?: number;
      pageToken?: string;
    },
    options?: RuntimeCallOptions,
  ): Promise<{
    models?: RuntimeConnectorModelProjectionInput[];
    nextPageToken?: string;
  }>;
};

export type RuntimeConnectorInventoryClientOptions = {
  runtimeAdmin: RuntimeConnectorAdminClient | (() => RuntimeConnectorAdminClient);
  callOptions?: RuntimeCallOptions;
  modelPageSize?: number;
  maxModelPages?: number;
  providerCatalogCacheTtlMs?: number;
  connectorListCacheTtlMs?: number;
  connectorModelCacheTtlMs?: number;
  now?: () => number;
};

export type RuntimeConnectorInventoryClient = {
  clearCaches(): void;
  listProviderCatalog(): Promise<ProviderCatalogEntry[]>;
  listConnectors(): Promise<RuntimeConnectorProjection[]>;
  createConnector(input: {
    provider: string;
    endpoint: string;
    label: string;
    apiKey?: string;
    credentialValue?: string;
    credentialJson?: string;
    authMode?: RuntimeConnectorAuthMode;
    providerAuthProfile?: string;
  }): Promise<RuntimeConnectorProjection | null>;
  updateConnector(input: {
    connectorId: string;
    label?: string;
    endpoint?: string;
    apiKey?: string;
    credentialValue?: string;
    credentialJson?: string;
    authMode?: RuntimeConnectorAuthMode;
    providerAuthProfile?: string;
  }): Promise<RuntimeConnectorProjection | null>;
  deleteConnector(connectorId: string): Promise<void>;
  testConnector(connectorId: string): Promise<void>;
  listConnectorModels(connectorId: string, forceRefresh?: boolean): Promise<string[]>;
  listConnectorModelDescriptors(
    connectorId: string,
    forceRefresh?: boolean,
  ): Promise<RuntimeConnectorModelInfo[]>;
};

function cloneProviderCatalog(catalog: ProviderCatalogEntry[]): ProviderCatalogEntry[] {
  return catalog.map((entry) => ({ ...entry }));
}

function cloneConnector(connector: RuntimeConnectorProjection): RuntimeConnectorProjection {
  return {
    ...connector,
    models: Array.isArray(connector.models) ? [...connector.models] : [],
  };
}

function cloneConnectors(connectors: RuntimeConnectorProjection[]): RuntimeConnectorProjection[] {
  return connectors.map(cloneConnector);
}

function cloneConnectorModelInfo(model: RuntimeConnectorModelInfo): RuntimeConnectorModelInfo {
  return {
    modelId: model.modelId,
    capabilities: Array.isArray(model.capabilities) ? [...model.capabilities] : [],
  };
}

function cloneConnectorModelInfos(models: RuntimeConnectorModelInfo[]): RuntimeConnectorModelInfo[] {
  return models.map(cloneConnectorModelInfo);
}

function normalizeProviderAuthProfile(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function runtimeReasonCodeName(value: unknown): string {
  return normalizeRuntimeReasonCode(value);
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

function resolveRuntimeAdmin(
  runtimeAdmin: RuntimeConnectorAdminClient | (() => RuntimeConnectorAdminClient),
): RuntimeConnectorAdminClient {
  return typeof runtimeAdmin === 'function' ? runtimeAdmin() : runtimeAdmin;
}

export function runtimeConnectorVendorLabel(vendor: string): string {
  const normalized = String(vendor || '').trim();
  if (!normalized) {
    return 'Custom';
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

export function providerToRuntimeConnectorVendor(provider: string): string {
  const normalized = String(provider || '').trim().toLowerCase();
  return normalized || 'custom';
}

export function runtimeConnectorVendorToProvider(vendor: string): string {
  return String(vendor || '').trim().toLowerCase() || 'custom';
}

export function runtimeConnectorAuthProfileForId(
  profileId: string | undefined,
): ConnectorAuthProfileSpec | null {
  const normalized = normalizeProviderAuthProfile(profileId || '');
  return normalized ? (CONNECTOR_AUTH_PROFILES[normalized] || null) : null;
}

function providerCatalogEntryForProvider(
  provider: string,
  catalog: ProviderCatalogEntry[] | undefined,
): ProviderCatalogEntry | null {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (!normalizedProvider || !Array.isArray(catalog)) {
    return null;
  }
  return catalog.find((item) => String(item.provider || '').trim().toLowerCase() === normalizedProvider) || null;
}

function providerSupportsInlineCredential(
  provider: string,
  catalog?: ProviderCatalogEntry[],
): boolean {
  const entry = providerCatalogEntryForProvider(provider, catalog);
  return entry?.inlineSupported !== false;
}

export function resolveRuntimeConnectorProviderEndpoint(
  provider: string,
  catalog: ProviderCatalogEntry[],
): string {
  const entry = catalog.find((item: ProviderCatalogEntry) => item.provider === provider);
  return entry?.defaultEndpoint || '';
}

function authOptionLabelForProfile(profile: ConnectorAuthProfileSpec): string {
  return `Managed OAuth Token (${runtimeConnectorVendorLabel(profile.id)})`;
}

export function listRuntimeConnectorAuthProfiles(provider: string): ConnectorAuthProfileSpec[] {
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

export function listRuntimeConnectorAuthOptionsForProvider(
  provider: string,
  catalog?: ProviderCatalogEntry[],
): RuntimeConnectorAuthOption[] {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const profileOptions = listRuntimeConnectorAuthProfiles(normalizedProvider).map((profile) => ({
    value: `oauth:${profile.id}`,
    label: authOptionLabelForProfile(profile),
    authMode: 'oauth_managed' as const,
    providerAuthProfile: profile.id,
  }));
  if (!providerSupportsInlineCredential(normalizedProvider, catalog)) {
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

export function defaultRuntimeConnectorAuthOptionForProvider(
  provider: string,
  catalog?: ProviderCatalogEntry[],
): RuntimeConnectorAuthOption {
  const options = listRuntimeConnectorAuthOptionsForProvider(provider, catalog);
  return options[0] || {
    value: 'api_key',
    label: 'API Key',
    authMode: 'api_key',
  };
}

function authModeFromRuntimeAuthKind(value: unknown): RuntimeConnectorAuthMode {
  return Number(value) === Number(ConnectorAuthKind.OAUTH_MANAGED) ? 'oauth_managed' : 'api_key';
}

export function runtimeConnectorToProjection(
  connector: RuntimeConnectorProjectionInput,
  providerCatalog: ProviderCatalogEntry[],
  models?: string[],
): RuntimeConnectorProjection {
  const vendor = providerToRuntimeConnectorVendor(connector.provider);
  const defaultEndpoint = resolveRuntimeConnectorProviderEndpoint(connector.provider, providerCatalog);
  const normalizedOwnerId = String(connector.ownerId || '').trim().toLowerCase();
  const scope: RuntimeConnectorScope = connector.ownerType === ConnectorOwnerType.SYSTEM
    ? (normalizedOwnerId === 'machine' ? 'machine-global' : 'runtime-system')
    : 'user';
  return {
    id: connector.connectorId,
    label: connector.label || `${runtimeConnectorVendorLabel(vendor)} Connector`,
    vendor,
    provider: connector.provider,
    authMode: authModeFromRuntimeAuthKind(connector.authKind),
    providerAuthProfile: normalizeProviderAuthProfile(connector.providerAuthProfile || '') || undefined,
    endpoint: connector.endpoint || defaultEndpoint,
    scope,
    hasCredential: connector.hasCredential,
    isSystemOwned: scope !== 'user',
    models: models && models.length > 0 ? [...models] : [],
  };
}

export function createRuntimeConnectorInventoryClient(
  options: RuntimeConnectorInventoryClientOptions,
): RuntimeConnectorInventoryClient {
  const modelPageSize = options.modelPageSize ?? DEFAULT_CONNECTOR_MODELS_PAGE_SIZE;
  const maxModelPages = options.maxModelPages ?? DEFAULT_CONNECTOR_MODELS_MAX_PAGES;
  const providerCatalogCacheTtlMs = options.providerCatalogCacheTtlMs ?? DEFAULT_PROVIDER_CATALOG_CACHE_TTL_MS;
  const connectorListCacheTtlMs = options.connectorListCacheTtlMs ?? DEFAULT_CONNECTOR_LIST_CACHE_TTL_MS;
  const connectorModelCacheTtlMs = options.connectorModelCacheTtlMs ?? DEFAULT_CONNECTOR_MODEL_CACHE_TTL_MS;
  const now = options.now || (() => Date.now());

  let cachedProviderCatalog: ProviderCatalogEntry[] | null = null;
  let cachedProviderCatalogAt = 0;
  let cachedConnectors: RuntimeConnectorProjection[] | null = null;
  let cachedConnectorsAt = 0;
  let pendingConnectors: Promise<RuntimeConnectorProjection[]> | null = null;
  let connectorInventoryCacheGeneration = 0;
  const cachedConnectorModels = new Map<string, { at: number; value: RuntimeConnectorModelInfo[] }>();
  const pendingConnectorModels = new Map<string, Promise<RuntimeConnectorModelInfo[]>>();

  function runtimeAdmin(): RuntimeConnectorAdminClient {
    return resolveRuntimeAdmin(options.runtimeAdmin);
  }

  function invalidateConnectorInventoryCache(): void {
    connectorInventoryCacheGeneration += 1;
    cachedConnectors = null;
    cachedConnectorsAt = 0;
    pendingConnectors = null;
    cachedConnectorModels.clear();
    pendingConnectorModels.clear();
  }

  async function listProviderCatalog(): Promise<ProviderCatalogEntry[]> {
    const currentTime = now();
    if (
      cachedProviderCatalog
      && currentTime - cachedProviderCatalogAt < providerCatalogCacheTtlMs
    ) {
      return cloneProviderCatalog(cachedProviderCatalog);
    }
    const response = await runtimeAdmin().listProviderCatalog({}, options.callOptions);
    const providers = Array.isArray(response.providers)
      ? (response.providers as ProviderCatalogEntry[])
      : [];
    cachedProviderCatalog = cloneProviderCatalog(providers);
    cachedProviderCatalogAt = currentTime;
    return cloneProviderCatalog(providers);
  }

  async function listConnectors(): Promise<RuntimeConnectorProjection[]> {
    const currentTime = now();
    if (
      cachedConnectors
      && currentTime - cachedConnectorsAt < connectorListCacheTtlMs
    ) {
      return cloneConnectors(cachedConnectors);
    }
    if (pendingConnectors) {
      return cloneConnectors(await pendingConnectors);
    }
    const cacheGeneration = connectorInventoryCacheGeneration;
    pendingConnectors = (async () => {
      const providerCatalog = await listProviderCatalog();
      const response = await runtimeAdmin().listConnectors({
        pageSize: 0,
        pageToken: '',
        kindFilter: ConnectorKind.REMOTE_MANAGED,
        statusFilter: ConnectorStatus.UNSPECIFIED,
        providerFilter: '',
      }, options.callOptions);
      const connectors = Array.isArray(response.connectors)
        ? (response.connectors as RuntimeConnectorProjectionInput[])
        : [];
      const remoteConnectors = connectors.filter(
        (connector) => connector.kind === ConnectorKind.REMOTE_MANAGED,
      );
      const result = remoteConnectors.map((connector) => runtimeConnectorToProjection(connector, providerCatalog));
      if (cacheGeneration === connectorInventoryCacheGeneration) {
        cachedConnectors = cloneConnectors(result);
        cachedConnectorsAt = now();
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

  async function createConnector(input: {
    provider: string;
    endpoint: string;
    label: string;
    apiKey?: string;
    credentialValue?: string;
    credentialJson?: string;
    authMode?: RuntimeConnectorAuthMode;
    providerAuthProfile?: string;
  }): Promise<RuntimeConnectorProjection | null> {
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
    }, options.callOptions);
    invalidateConnectorInventoryCache();
    if (!response.connector) return null;
    const providerCatalog = await listProviderCatalog();
    return runtimeConnectorToProjection(response.connector, providerCatalog);
  }

  async function updateConnector(input: {
    connectorId: string;
    label?: string;
    endpoint?: string;
    apiKey?: string;
    credentialValue?: string;
    credentialJson?: string;
    authMode?: RuntimeConnectorAuthMode;
    providerAuthProfile?: string;
  }): Promise<RuntimeConnectorProjection | null> {
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
    }, options.callOptions);
    invalidateConnectorInventoryCache();
    if (!response.connector) return null;
    const providerCatalog = await listProviderCatalog();
    return runtimeConnectorToProjection(response.connector, providerCatalog);
  }

  async function deleteConnector(connectorId: string): Promise<void> {
    await runtimeAdmin().deleteConnector({ connectorId }, options.callOptions);
    invalidateConnectorInventoryCache();
  }

  async function testConnector(connectorId: string): Promise<void> {
    const response = await runtimeAdmin().testConnector({ connectorId }, options.callOptions);
    const ack = response.ack;
    if (!ack) {
      throw createNimiError({
        message: 'connector test failed: empty ack payload',
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'retry_or_check_runtime_status',
        source: 'runtime',
        details: { connectorId },
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

  async function listConnectorModelDescriptors(
    connectorId: string,
    forceRefresh = false,
  ): Promise<RuntimeConnectorModelInfo[]> {
    const normalizedConnectorId = String(connectorId || '').trim();
    const currentTime = now();
    if (!forceRefresh) {
      const cached = cachedConnectorModels.get(normalizedConnectorId);
      if (cached && currentTime - cached.at < connectorModelCacheTtlMs) {
        return cloneConnectorModelInfos(cached.value);
      }
      const pending = pendingConnectorModels.get(normalizedConnectorId);
      if (pending) {
        return cloneConnectorModelInfos(await pending);
      }
    }
    const cacheGeneration = connectorInventoryCacheGeneration;
    const pending = (async () => {
      const descriptors: RuntimeConnectorModelInfo[] = [];
      const seenModelIds = new Set<string>();
      let pageToken = '';
      for (let pageIndex = 0; pageIndex < maxModelPages; pageIndex += 1) {
        const response = await runtimeAdmin().listConnectorModels({
          connectorId: normalizedConnectorId,
          forceRefresh: pageIndex === 0 ? forceRefresh : false,
          pageSize: modelPageSize,
          pageToken,
        }, options.callOptions);
        const models = Array.isArray(response.models)
          ? (response.models as RuntimeConnectorModelProjectionInput[])
          : [];
        const pageItems = models
          .filter((item) => Boolean(item.available))
          .map((item) => ({
            modelId: String(item.modelId || '').trim(),
            capabilities: Array.isArray(item.capabilities)
              ? item.capabilities.map((capability) => String(capability || '').trim()).filter(Boolean)
              : [],
          }))
          .filter((item) => item.modelId.length > 0);
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
          at: now(),
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

  async function listConnectorModels(
    connectorId: string,
    forceRefresh = false,
  ): Promise<string[]> {
    const descriptors = await listConnectorModelDescriptors(connectorId, forceRefresh);
    return descriptors.map((item) => item.modelId);
  }

  return {
    clearCaches(): void {
      cachedProviderCatalog = null;
      cachedProviderCatalogAt = 0;
      invalidateConnectorInventoryCache();
    },
    listProviderCatalog,
    listConnectors,
    createConnector,
    updateConnector,
    deleteConnector,
    testConnector,
    listConnectorModels,
    listConnectorModelDescriptors,
  };
}
