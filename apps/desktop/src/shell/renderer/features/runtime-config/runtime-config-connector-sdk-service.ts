import { getPlatformClient } from '@nimiplatform/sdk';
import {
  asNimiError,
  createNimiError,
  Runtime,
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

const CONNECTOR_KIND_REMOTE_MANAGED = 2;
const CONNECTOR_OWNER_TYPE_SYSTEM = 1;

let cachedProviderCatalog: ProviderCatalogEntry[] | null = null;
let cachedProviderCatalogAt = 0;
let anonymousRuntime: Runtime | null = null;

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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function authFailedBecauseOfStaleBearer(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'retry_without_stale_runtime_bearer',
    source: 'runtime',
  });
  return normalizeText(normalized.reasonCode) === ReasonCode.AUTH_TOKEN_INVALID;
}

function getAnonymousRuntime(): Runtime {
  const runtime = getPlatformClient().runtime;
  if (
    anonymousRuntime
    && anonymousRuntime.appId === runtime.appId
    && anonymousRuntime.transport === runtime.transport
  ) {
    return anonymousRuntime;
  }
  anonymousRuntime = new Runtime({
    appId: runtime.appId,
    transport: runtime.transport,
  });
  return anonymousRuntime;
}

async function withAnonymousReadFallback<T>(
  action: () => Promise<T>,
  anonymousAction: (runtime: Runtime) => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!authFailedBecauseOfStaleBearer(error)) {
      throw error;
    }
    return anonymousAction(getAnonymousRuntime());
  }
}

export async function sdkListProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  const now = Date.now();
  if (
    cachedProviderCatalog
    && now - cachedProviderCatalogAt < PROVIDER_CATALOG_CACHE_TTL_MS
  ) {
    return cachedProviderCatalog;
  }
  const response = await withAnonymousReadFallback(
    () => runtimeAdmin().listProviderCatalog({}, CONNECTOR_CALL_OPTIONS),
    (runtime) => runtime.connector.listProviderCatalog({}, CONNECTOR_CALL_OPTIONS),
  );
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
  if (normalized === 'deepseek') return 'deepseek';
  if (normalized === 'dashscope') return 'dashscope';
  if (normalized === 'volcengine' || normalized === 'volcengine_openspeech') return 'volcengine';
  if (normalized === 'gemini') return 'gemini';
  if (normalized === 'kimi') return 'kimi';
  if (normalized === 'openai') return 'gpt';
  if (normalized === 'openai_codex') return 'openai_codex';
  if (normalized === 'openai_compatible') return 'openai_compatible';
  if (normalized === 'anthropic') return 'claude';
  if (normalized === 'openrouter') return 'openrouter';
  return 'custom';
}

export function vendorToProvider(vendor: ApiVendor): string {
  if (vendor === 'dashscope') return 'dashscope';
  if (vendor === 'volcengine') return 'volcengine';
  if (vendor === 'gemini') return 'gemini';
  if (vendor === 'kimi') return 'kimi';
  if (vendor === 'deepseek') return 'deepseek';
  if (vendor === 'gpt') return 'openai';
  if (vendor === 'openai_codex') return 'openai_codex';
  if (vendor === 'openai_compatible') return 'openai_compatible';
  if (vendor === 'claude') return 'anthropic';
  if (vendor === 'openrouter') return 'openrouter';
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
  const providerCatalog = await sdkListProviderCatalog();
  const request = {
    pageSize: 0,
    pageToken: '',
    kindFilter: CONNECTOR_KIND_REMOTE_MANAGED,
    statusFilter: 0,
    providerFilter: '',
  };
  const response = await withAnonymousReadFallback(
    () => runtimeAdmin().listConnectors(request, CONNECTOR_CALL_OPTIONS),
    (runtime) => runtime.connector.listConnectors(request, CONNECTOR_CALL_OPTIONS),
  );
  const connectors = Array.isArray(response.connectors)
    ? (response.connectors as RuntimeConnectorLike[])
    : [];
  const remoteConnectors = connectors.filter(
    (connector: RuntimeConnectorLike) => connector.kind === CONNECTOR_KIND_REMOTE_MANAGED,
  );
  return remoteConnectors.map((connector: RuntimeConnectorLike) => sdkConnectorToApiConnector(connector, providerCatalog));
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
  if (!response.connector) return null;
  const providerCatalog = await sdkListProviderCatalog();
  return sdkConnectorToApiConnector(response.connector, providerCatalog);
}

export async function sdkDeleteConnector(connectorId: string): Promise<void> {
  await runtimeAdmin().deleteConnector(
    { connectorId },
    CONNECTOR_CALL_OPTIONS,
  );
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

export type ConnectorModelInfo = {
  modelId: string;
  capabilities: string[];
};

export async function sdkListConnectorModelDescriptors(
  connectorId: string,
  forceRefresh: boolean = false,
): Promise<ConnectorModelInfo[]> {
  const descriptors: ConnectorModelInfo[] = [];
  const seenModelIds = new Set<string>();
  let pageToken = '';
  for (let pageIndex = 0; pageIndex < CONNECTOR_MODELS_MAX_PAGES; pageIndex += 1) {
    const request = {
      connectorId,
      forceRefresh: pageIndex === 0 ? forceRefresh : false,
      pageSize: CONNECTOR_MODELS_PAGE_SIZE,
      pageToken,
    };
    const response = await withAnonymousReadFallback(
      () => runtimeAdmin().listConnectorModels(request, CONNECTOR_CALL_OPTIONS),
      (runtime) => runtime.connector.listConnectorModels(request, CONNECTOR_CALL_OPTIONS),
    );
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
  return descriptors;
}
