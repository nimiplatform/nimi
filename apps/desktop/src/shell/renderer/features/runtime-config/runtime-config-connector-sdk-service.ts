import { getPlatformClient } from '@nimiplatform/sdk';
import { createNimiError, RuntimeReasonCode, type ProviderCatalogEntry } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  getVendorLabelV11,
  type ApiConnector,
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

type RuntimeConnectorLike = {
  connectorId: string;
  provider: string;
  endpoint: string;
  label: string;
  hasCredential: boolean;
  ownerType: number;
  kind: number;
  status: number;
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
  if (normalized === 'deepseek') return 'deepseek';
  if (normalized === 'dashscope') return 'dashscope';
  if (normalized === 'volcengine' || normalized === 'volcengine_openspeech') return 'volcengine';
  if (normalized === 'gemini') return 'gemini';
  if (normalized === 'kimi') return 'kimi';
  if (normalized === 'openai') return 'gpt';
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
  if (vendor === 'claude') return 'anthropic';
  if (vendor === 'openrouter') return 'openrouter';
  return 'custom';
}

export function sdkConnectorToApiConnector(
  connector: {
    connectorId: string;
    provider: string;
    endpoint: string;
    label: string;
    hasCredential: boolean;
    ownerType: number;
    kind: number;
    status: number;
  },
  providerCatalog: ProviderCatalogEntry[],
  models?: string[],
): ApiConnector {
  const vendor = providerToVendor(connector.provider);
  const defaultEndpoint = resolveProviderEndpoint(connector.provider, providerCatalog);
  return {
    id: connector.connectorId,
    label: connector.label || `${getVendorLabelV11(vendor)} Connector`,
    vendor,
    provider: connector.provider,
    endpoint: connector.endpoint || defaultEndpoint,
    hasCredential: connector.hasCredential,
    isSystemOwned: connector.ownerType === CONNECTOR_OWNER_TYPE_SYSTEM,
    models: models && models.length > 0 ? models : [],
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  };
}

export async function sdkListConnectors(): Promise<ApiConnector[]> {
  const providerCatalog = await sdkListProviderCatalog();
  const response = await runtimeAdmin().listConnectors(
    { pageSize: 0, pageToken: '', kindFilter: 0, statusFilter: 0, providerFilter: '' },
    CONNECTOR_CALL_OPTIONS,
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
  apiKey: string;
}): Promise<ApiConnector | null> {
  const response = await runtimeAdmin().createConnector({
    provider: input.provider,
    endpoint: input.endpoint,
    label: input.label,
    apiKey: input.apiKey,
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
}): Promise<ApiConnector | null> {
  const response = await runtimeAdmin().updateConnector({
    connectorId: input.connectorId,
    label: input.label || '',
    endpoint: input.endpoint || '',
    apiKey: input.apiKey || '',
    status: 0,
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
    const response = await runtimeAdmin().listConnectorModels(
      {
        connectorId,
        forceRefresh: pageIndex === 0 ? forceRefresh : false,
        pageSize: CONNECTOR_MODELS_PAGE_SIZE,
        pageToken,
      },
      CONNECTOR_CALL_OPTIONS,
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
