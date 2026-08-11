import {
  ConnectorAuthKind,
  ConnectorKind,
  ConnectorOwnerType,
  ConnectorStatus,
  type Connector,
  type ConnectorModelDescriptor,
  type ProviderCatalogEntry,
  type RuntimeTypedCallOptions,
  type RuntimeTypedClient,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import {
  CONNECTOR_AUTH_PROFILES,
  type ConnectorAuthProfileSpec,
} from './connector-auth-profiles.generated.js';
import {
  type NimiRuntimeConnectorAuthMode,
  type NimiRuntimeConnectorProjection,
  type NimiRuntimeConnectorScope,
} from './config-projections';
import {
  NIMI_RUNTIME_REASON_CODES,
  normalizeNimiRuntimeReasonCode,
} from './reason-messages';

const DEFAULT_CONNECTOR_MODELS_PAGE_SIZE = 200;
const DEFAULT_CONNECTOR_MODELS_MAX_PAGES = 200;
const DEFAULT_PROVIDER_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CONNECTOR_LIST_CACHE_TTL_MS = 15 * 1000;
const DEFAULT_CONNECTOR_MODEL_CACHE_TTL_MS = 30 * 1000;

export type NimiRuntimeConnectorAuthProfileSpec = ConnectorAuthProfileSpec;

export const NIMI_RUNTIME_CONNECTOR_AUTH_PROFILES: Readonly<Record<string, NimiRuntimeConnectorAuthProfileSpec>> =
  CONNECTOR_AUTH_PROFILES;

export interface NimiRuntimeConnectorAuthOption {
  readonly value: string;
  readonly label: string;
  readonly authMode: NimiRuntimeConnectorAuthMode;
  readonly providerAuthProfile?: string;
}

export interface NimiRuntimeConnectorModelInfo {
  readonly modelId: string;
  readonly capabilities: readonly string[];
}

export interface NimiRuntimeConnectorProjectionInput {
  readonly connectorId: string;
  readonly provider: string;
  readonly endpoint: string;
  readonly label: string;
  readonly hasCredential: boolean;
  readonly authKind?: ConnectorAuthKind;
  readonly providerAuthProfile?: string;
  readonly ownerType: ConnectorOwnerType;
  readonly ownerId?: string;
  readonly kind: ConnectorKind;
  readonly status: ConnectorStatus;
}

export type NimiRuntimeConnectorClient = Pick<
  RuntimeTypedClient,
  | 'listProviderCatalog'
  | 'listConnectors'
  | 'createConnector'
  | 'updateConnector'
  | 'deleteConnector'
  | 'testConnector'
  | 'listConnectorModels'
>;

export interface NimiRuntimeConnectorInventoryClientOptions {
  readonly connectors: NimiRuntimeConnectorClient | (() => NimiRuntimeConnectorClient);
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly modelPageSize?: number;
  readonly maxModelPages?: number;
  readonly providerCatalogCacheTtlMs?: number;
  readonly connectorListCacheTtlMs?: number;
  readonly connectorModelCacheTtlMs?: number;
  readonly now?: () => number;
}

export interface NimiRuntimeConnectorInventoryClient {
  clearCaches(): void;
  listProviderCatalog(): Promise<readonly ProviderCatalogEntry[]>;
  listConnectors(): Promise<readonly NimiRuntimeConnectorProjection[]>;
  createConnector(input: {
    readonly provider: string;
    readonly endpoint: string;
    readonly label: string;
    readonly apiKey?: string;
    readonly credentialValue?: string;
    readonly authMode?: 'api_key';
  }): Promise<NimiRuntimeConnectorProjection | null>;
  updateConnector(input: {
    readonly connectorId: string;
    readonly label?: string;
    readonly endpoint?: string;
    readonly apiKey?: string;
    readonly credentialValue?: string;
    readonly authMode?: 'api_key';
  }): Promise<NimiRuntimeConnectorProjection | null>;
  deleteConnector(connectorId: string): Promise<void>;
  testConnector(connectorId: string): Promise<void>;
  listConnectorModels(connectorId: string, forceRefresh?: boolean): Promise<readonly string[]>;
  listConnectorModelDescriptors(
    connectorId: string,
    forceRefresh?: boolean,
  ): Promise<readonly NimiRuntimeConnectorModelInfo[]>;
}

function cloneProviderCatalog(catalog: readonly ProviderCatalogEntry[]): ProviderCatalogEntry[] {
  return catalog.map((entry) => ({ ...entry }));
}

function cloneConnector(connector: NimiRuntimeConnectorProjection): NimiRuntimeConnectorProjection {
  return {
    ...connector,
    models: [...connector.models],
  };
}

function cloneConnectors(
  connectors: readonly NimiRuntimeConnectorProjection[],
): NimiRuntimeConnectorProjection[] {
  return connectors.map(cloneConnector);
}

function cloneConnectorModelInfo(model: NimiRuntimeConnectorModelInfo): NimiRuntimeConnectorModelInfo {
  return {
    modelId: model.modelId,
    capabilities: [...model.capabilities],
  };
}

function cloneConnectorModelInfos(
  models: readonly NimiRuntimeConnectorModelInfo[],
): NimiRuntimeConnectorModelInfo[] {
  return models.map(cloneConnectorModelInfo);
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeProviderAuthProfile(value: unknown): string {
  return normalizeLower(value);
}

function resolveConnectors(
  connectors: NimiRuntimeConnectorClient | (() => NimiRuntimeConnectorClient),
): NimiRuntimeConnectorClient {
  return typeof connectors === 'function' ? connectors() : connectors;
}

function assertRendererSafeConnectorMutation(input: object): void {
  const record = input as Readonly<Record<string, unknown>>;
  if (
    record.authMode === 'oauth_managed'
    || ['credentialJson', 'providerAuthProfile', 'accessToken', 'refreshToken', 'raw']
      .some((field) => Object.hasOwn(record, field))
  ) {
    throw new Error('Managed OAuth credential custody requires an authorized non-renderer host.');
  }
}

export function nimiRuntimeConnectorVendorLabel(vendor: string): string {
  const normalized = normalizeText(vendor);
  if (!normalized) {
    return 'Custom';
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

export function providerToNimiRuntimeConnectorVendor(provider: string): string {
  return normalizeLower(provider) || 'custom';
}

export function nimiRuntimeConnectorVendorToProvider(vendor: string): string {
  return normalizeLower(vendor) || 'custom';
}

export function nimiRuntimeConnectorAuthProfileForId(
  profileId: string | undefined,
): NimiRuntimeConnectorAuthProfileSpec | null {
  const normalized = normalizeProviderAuthProfile(profileId);
  return normalized ? (CONNECTOR_AUTH_PROFILES[normalized] || null) : null;
}

function providerCatalogEntryForProvider(
  provider: string,
  catalog: readonly ProviderCatalogEntry[] | undefined,
): ProviderCatalogEntry | null {
  const normalizedProvider = normalizeLower(provider);
  if (!normalizedProvider || !Array.isArray(catalog)) {
    return null;
  }
  return catalog.find((item) => normalizeLower(item.provider) === normalizedProvider) || null;
}

function providerSupportsInlineCredential(
  provider: string,
  catalog?: readonly ProviderCatalogEntry[],
): boolean {
  const entry = providerCatalogEntryForProvider(provider, catalog);
  return entry?.inlineSupported !== false;
}

export function resolveNimiRuntimeConnectorProviderEndpoint(
  provider: string,
  catalog: readonly ProviderCatalogEntry[],
): string {
  const normalizedProvider = normalizeLower(provider);
  const entry = catalog.find((item) => normalizeLower(item.provider) === normalizedProvider);
  return normalizeText(entry?.defaultEndpoint);
}

function authOptionLabelForProfile(profile: NimiRuntimeConnectorAuthProfileSpec): string {
  return `Managed OAuth Token (${nimiRuntimeConnectorVendorLabel(profile.id)})`;
}

export function listNimiRuntimeConnectorAuthProfiles(provider: string): NimiRuntimeConnectorAuthProfileSpec[] {
  const normalizedProvider = normalizeLower(provider);
  if (!normalizedProvider) {
    return [];
  }
  return Object.values(CONNECTOR_AUTH_PROFILES)
    .filter((profile) => profile.allowedProviders.map(normalizeLower).includes(normalizedProvider))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function listNimiRuntimeConnectorAuthOptionsForProvider(
  provider: string,
  catalog?: readonly ProviderCatalogEntry[],
): NimiRuntimeConnectorAuthOption[] {
  const normalizedProvider = normalizeLower(provider);
  const profileOptions = listNimiRuntimeConnectorAuthProfiles(normalizedProvider).map((profile) => ({
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

export function defaultNimiRuntimeConnectorAuthOptionForProvider(
  provider: string,
  catalog?: readonly ProviderCatalogEntry[],
): NimiRuntimeConnectorAuthOption {
  return listNimiRuntimeConnectorAuthOptionsForProvider(provider, catalog)[0] || {
    value: 'api_key',
    label: 'API Key',
    authMode: 'api_key',
  };
}

function authModeFromRuntimeAuthKind(value: unknown): NimiRuntimeConnectorAuthMode {
  return Number(value) === Number(ConnectorAuthKind.OAUTH_MANAGED) ? 'oauth_managed' : 'api_key';
}

function connectorScopeFromOwner(connector: NimiRuntimeConnectorProjectionInput): NimiRuntimeConnectorScope {
  if (connector.ownerType !== ConnectorOwnerType.SYSTEM) {
    return 'user';
  }
  return normalizeLower(connector.ownerId) === 'machine' ? 'machine-global' : 'runtime-system';
}

export function nimiRuntimeConnectorToProjection(
  connector: NimiRuntimeConnectorProjectionInput,
  providerCatalog: readonly ProviderCatalogEntry[],
  models?: readonly string[],
): NimiRuntimeConnectorProjection {
  const vendor = providerToNimiRuntimeConnectorVendor(connector.provider);
  const defaultEndpoint = resolveNimiRuntimeConnectorProviderEndpoint(connector.provider, providerCatalog);
  const scope = connectorScopeFromOwner(connector);
  return {
    id: normalizeText(connector.connectorId),
    label: normalizeText(connector.label) || `${nimiRuntimeConnectorVendorLabel(vendor)} Connector`,
    vendor,
    provider: normalizeText(connector.provider),
    authMode: authModeFromRuntimeAuthKind(connector.authKind),
    providerAuthProfile: normalizeProviderAuthProfile(connector.providerAuthProfile) || undefined,
    endpoint: normalizeText(connector.endpoint) || defaultEndpoint,
    scope,
    hasCredential: Boolean(connector.hasCredential),
    isSystemOwned: scope !== 'user',
    models: models && models.length > 0 ? models.map(normalizeText).filter(Boolean) : [],
  };
}

export function createNimiRuntimeConnectorInventoryClient(
  options: NimiRuntimeConnectorInventoryClientOptions,
): NimiRuntimeConnectorInventoryClient {
  const modelPageSize = options.modelPageSize ?? DEFAULT_CONNECTOR_MODELS_PAGE_SIZE;
  const maxModelPages = options.maxModelPages ?? DEFAULT_CONNECTOR_MODELS_MAX_PAGES;
  const providerCatalogCacheTtlMs = options.providerCatalogCacheTtlMs ?? DEFAULT_PROVIDER_CATALOG_CACHE_TTL_MS;
  const connectorListCacheTtlMs = options.connectorListCacheTtlMs ?? DEFAULT_CONNECTOR_LIST_CACHE_TTL_MS;
  const connectorModelCacheTtlMs = options.connectorModelCacheTtlMs ?? DEFAULT_CONNECTOR_MODEL_CACHE_TTL_MS;
  const now = options.now || (() => Date.now());

  let cachedProviderCatalog: ProviderCatalogEntry[] | null = null;
  let cachedProviderCatalogAt = 0;
  let cachedConnectors: NimiRuntimeConnectorProjection[] | null = null;
  let cachedConnectorsAt = 0;
  let pendingConnectors: Promise<NimiRuntimeConnectorProjection[]> | null = null;
  let connectorInventoryCacheGeneration = 0;
  const cachedConnectorModels = new Map<string, { at: number; value: NimiRuntimeConnectorModelInfo[] }>();
  const pendingConnectorModels = new Map<string, Promise<NimiRuntimeConnectorModelInfo[]>>();

  function connectors(): NimiRuntimeConnectorClient {
    return resolveConnectors(options.connectors);
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
    const response = await connectors().listProviderCatalog({}, options.callOptions);
    const providers = Array.isArray(response.providers) ? response.providers : [];
    cachedProviderCatalog = cloneProviderCatalog(providers);
    cachedProviderCatalogAt = currentTime;
    return cloneProviderCatalog(providers);
  }

  async function listConnectors(): Promise<NimiRuntimeConnectorProjection[]> {
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
      const response = await connectors().listConnectors({
        pageSize: 0,
        pageToken: '',
        kindFilter: ConnectorKind.REMOTE_MANAGED,
        statusFilter: ConnectorStatus.UNSPECIFIED,
        providerFilter: '',
      }, options.callOptions);
      const remoteConnectors = (response.connectors ?? [])
        .filter((connector) => connector.kind === ConnectorKind.REMOTE_MANAGED);
      const result = remoteConnectors.map((connector) => nimiRuntimeConnectorToProjection(connector, providerCatalog));
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
    readonly provider: string;
    readonly endpoint: string;
    readonly label: string;
    readonly apiKey?: string;
    readonly credentialValue?: string;
    readonly authMode?: 'api_key';
  }): Promise<NimiRuntimeConnectorProjection | null> {
    assertRendererSafeConnectorMutation(input);
    const credentialValue = normalizeText(input.credentialValue ?? input.apiKey);
    const response = await connectors().createConnector({
      provider: input.provider,
      endpoint: input.endpoint,
      label: input.label,
      apiKey: credentialValue,
      authKind: ConnectorAuthKind.API_KEY,
      providerAuthProfile: '',
      credentialJson: '',
    }, options.callOptions);
    invalidateConnectorInventoryCache();
    if (!response.connector) return null;
    const providerCatalog = await listProviderCatalog();
    return nimiRuntimeConnectorToProjection(response.connector, providerCatalog);
  }

  async function updateConnector(input: {
    readonly connectorId: string;
    readonly label?: string;
    readonly endpoint?: string;
    readonly apiKey?: string;
    readonly credentialValue?: string;
    readonly authMode?: 'api_key';
  }): Promise<NimiRuntimeConnectorProjection | null> {
    assertRendererSafeConnectorMutation(input);
    const credentialValue = normalizeText(input.credentialValue ?? input.apiKey);
    const response = await connectors().updateConnector({
      connectorId: input.connectorId,
      label: normalizeText(input.label),
      endpoint: normalizeText(input.endpoint),
      apiKey: credentialValue,
      status: ConnectorStatus.UNSPECIFIED,
      authKind: input.authMode
        ? ConnectorAuthKind.API_KEY
        : undefined,
      providerAuthProfile: undefined,
      credentialJson: undefined,
    }, options.callOptions);
    invalidateConnectorInventoryCache();
    if (!response.connector) return null;
    const providerCatalog = await listProviderCatalog();
    return nimiRuntimeConnectorToProjection(response.connector, providerCatalog);
  }

  async function deleteConnector(connectorId: string): Promise<void> {
    await connectors().deleteConnector({ connectorId }, options.callOptions);
    invalidateConnectorInventoryCache();
  }

  async function testConnector(connectorId: string): Promise<void> {
    const response = await connectors().testConnector({ connectorId }, options.callOptions);
    const ack = response.ack;
    if (!ack) {
      throw createNimiError({
        message: 'connector test failed: empty ack payload',
        reasonCode: NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED,
        actionHint: 'retry_or_check_runtime_status',
        source: 'runtime',
        details: { connectorId },
      });
    }
    if (ack.ok) return;

    const reasonCode = normalizeNimiRuntimeReasonCode(ack.reasonCode)
      || NIMI_RUNTIME_REASON_CODES.RUNTIME_CALL_FAILED;
    throw createNimiError({
      message: `connector test failed: ${reasonCode}`,
      reasonCode,
      code: reasonCode,
      actionHint: normalizeText(ack.actionHint) || 'check_connector_config',
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
  ): Promise<NimiRuntimeConnectorModelInfo[]> {
    const normalizedConnectorId = normalizeText(connectorId);
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
      const descriptors: NimiRuntimeConnectorModelInfo[] = [];
      const seenModelIds = new Set<string>();
      let pageToken = '';
      for (let pageIndex = 0; pageIndex < maxModelPages; pageIndex += 1) {
        const response = await connectors().listConnectorModels({
          connectorId: normalizedConnectorId,
          forceRefresh: pageIndex === 0 ? forceRefresh : false,
          pageSize: modelPageSize,
          pageToken,
        }, options.callOptions);
        const pageItems = (response.models ?? [])
          .filter((item: ConnectorModelDescriptor) => Boolean(item.available))
          .map((item) => ({
            modelId: normalizeText(item.modelId),
            capabilities: (item.capabilities ?? []).map(normalizeText).filter(Boolean),
          }))
          .filter((item) => item.modelId.length > 0);
        for (const item of pageItems) {
          if (seenModelIds.has(item.modelId)) {
            continue;
          }
          seenModelIds.add(item.modelId);
          descriptors.push(item);
        }
        pageToken = normalizeText(response.nextPageToken);
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
