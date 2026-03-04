import { getPlatformClient } from '@runtime/platform-client';
import { createNimiError, RuntimeReasonCode, type ProviderCatalogEntry } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  VENDOR_CATALOGS_V11,
  type ApiConnector,
  type ApiVendor,
} from '@renderer/features/runtime-config/state/types';

const CONNECTOR_CALL_OPTIONS = {
  timeoutMs: 5000,
  metadata: {
    callerKind: 'desktop-core' as const,
    callerId: 'runtime-config.connector',
    surfaceId: 'runtime.config',
  },
};

const CONNECTOR_KIND_REMOTE_MANAGED = 2;
const CONNECTOR_OWNER_TYPE_SYSTEM = 1;

let cachedProviderCatalog: ProviderCatalogEntry[] | null = null;

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

export async function sdkListProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  if (cachedProviderCatalog) return cachedProviderCatalog;
  const runtime = getPlatformClient().runtime;
  const response = await runtime.connector.listProviderCatalog({}, CONNECTOR_CALL_OPTIONS);
  cachedProviderCatalog = response.providers || [];
  return cachedProviderCatalog;
}

export function resolveProviderEndpoint(
  provider: string,
  catalog: ProviderCatalogEntry[],
): string {
  const entry = catalog.find((e) => e.provider === provider);
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
  models?: string[],
): ApiConnector {
  const vendor = providerToVendor(connector.provider);
  const catalog = VENDOR_CATALOGS_V11[vendor];
  return {
    id: connector.connectorId,
    label: connector.label || `${catalog.label} Connector`,
    vendor,
    provider: connector.provider,
    endpoint: connector.endpoint || catalog.defaultEndpoint,
    hasCredential: connector.hasCredential,
    isSystemOwned: connector.ownerType === CONNECTOR_OWNER_TYPE_SYSTEM,
    models: models && models.length > 0 ? models : [],
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  };
}

export async function sdkListConnectors(): Promise<ApiConnector[]> {
  const runtime = getPlatformClient().runtime;
  const response = await runtime.connector.listConnectors(
    { pageSize: 0, pageToken: '', kindFilter: 0, statusFilter: 0, providerFilter: '' },
    CONNECTOR_CALL_OPTIONS,
  );
  const remoteConnectors = (response.connectors || []).filter(
    (c) => c.kind === CONNECTOR_KIND_REMOTE_MANAGED,
  );
  return remoteConnectors.map((c) => sdkConnectorToApiConnector(c));
}

export async function sdkCreateConnector(input: {
  provider: string;
  endpoint: string;
  label: string;
  apiKey: string;
}): Promise<ApiConnector | null> {
  const runtime = getPlatformClient().runtime;
  const response = await runtime.connector.createConnector({
    provider: input.provider,
    endpoint: input.endpoint,
    label: input.label,
    apiKey: input.apiKey,
  }, CONNECTOR_CALL_OPTIONS);
  if (!response.connector) return null;
  return sdkConnectorToApiConnector(response.connector);
}

export async function sdkUpdateConnector(input: {
  connectorId: string;
  label?: string;
  endpoint?: string;
  apiKey?: string;
}): Promise<ApiConnector | null> {
  const runtime = getPlatformClient().runtime;
  const response = await runtime.connector.updateConnector({
    connectorId: input.connectorId,
    label: input.label || '',
    endpoint: input.endpoint || '',
    apiKey: input.apiKey || '',
    status: 0,
  }, CONNECTOR_CALL_OPTIONS);
  if (!response.connector) return null;
  return sdkConnectorToApiConnector(response.connector);
}

export async function sdkDeleteConnector(connectorId: string): Promise<void> {
  const runtime = getPlatformClient().runtime;
  await runtime.connector.deleteConnector(
    { connectorId },
    CONNECTOR_CALL_OPTIONS,
  );
}

export async function sdkTestConnector(connectorId: string): Promise<void> {
  const runtime = getPlatformClient().runtime;
  const response = await runtime.connector.testConnector(
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
  const runtime = getPlatformClient().runtime;
  const response = await runtime.connector.listConnectorModels(
    { connectorId, forceRefresh, pageSize: 0, pageToken: '' },
    CONNECTOR_CALL_OPTIONS,
  );
  return (response.models || [])
    .filter((m) => m.available)
    .map((m) => m.modelId)
    .filter(Boolean);
}

export type ConnectorModelInfo = {
  modelId: string;
  capabilities: string[];
};

export async function sdkListConnectorModelDescriptors(
  connectorId: string,
  forceRefresh: boolean = false,
): Promise<ConnectorModelInfo[]> {
  const runtime = getPlatformClient().runtime;
  const response = await runtime.connector.listConnectorModels(
    { connectorId, forceRefresh, pageSize: 0, pageToken: '' },
    CONNECTOR_CALL_OPTIONS,
  );
  return (response.models || [])
    .filter((m) => m.available)
    .map((m) => ({ modelId: m.modelId, capabilities: m.capabilities || [] }))
    .filter((m) => Boolean(m.modelId));
}
