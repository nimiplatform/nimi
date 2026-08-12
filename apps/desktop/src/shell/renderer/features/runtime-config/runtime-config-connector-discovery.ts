import type {
  RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { ProviderStatusV11 } from './runtime-config-state-types';
import type { NimiRuntimeLocalRunnableAssetKindId } from '@nimiplatform/sdk/runtime';
import type { GetRuntimeHealthResponse } from '@nimiplatform/sdk/runtime/wire-types';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { normalizeNimiRuntimeLocalProviderAdapterId, type NimiRuntimeLocalProviderAdapterId, normalizeNimiRuntimeLocalRunnableAssetKindId, parseNimiRuntimeLocalAssetStatusId, parseNimiRuntimeLocalRunnableAssetKindId, projectNimiRuntimeHealthSummary } from '@nimiplatform/sdk/runtime';
import { LocalAssetKind, LocalAssetStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { asNimiError } from '@nimiplatform/sdk/types';
import { NIMI_RUNTIME_REASON_CODES } from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigConnectorSdkService } from './runtime-config-connector-sdk-service';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

type HealthResult = {
  status: 'healthy' | 'degraded' | 'unreachable' | 'unsupported';
  detail: string;
  checkedAt: string;
};

type RuntimeNodeCapability = NimiRuntimeLocalRunnableAssetKindId;

type ActiveLocalModelStatus = 'installed' | 'active' | 'unhealthy';

function normalizeRuntimeNodeCapability(value: unknown): RuntimeNodeCapability {
  return normalizeNimiRuntimeLocalRunnableAssetKindId(value);
}

function normalizeRuntimeNodeAdapter(value: unknown): NimiRuntimeLocalProviderAdapterId | undefined {
  return normalizeNimiRuntimeLocalProviderAdapterId(value);
}

function normalizeActiveLocalModelStatus(value: unknown): ActiveLocalModelStatus {
  const status = parseNimiRuntimeLocalAssetStatusId(value);
  return status === 'active' || status === 'unhealthy' ? status : 'installed';
}

function normalizeProviderHints(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return { ...(value as JsonObject) };
}

export function normalizeRuntimeHealthResult(result: GetRuntimeHealthResponse): {
  health: HealthResult;
  normalizedStatus: ProviderStatusV11;
} {
  const projection = projectNimiRuntimeHealthSummary(result);
  const normalizedStatus = projection.normalizedStatus as ProviderStatusV11;
  return {
    health: projection.health,
    normalizedStatus,
  };
}

async function listRuntimeLocalAssets(sdk: DesktopRendererSdkPort) {
  const assets = [];
  let pageToken = '';
  do {
    const response = await sdk.localAssetAdmin().listLocalAssets({
      statusFilter: LocalAssetStatus.UNSPECIFIED,
      kindFilter: LocalAssetKind.UNSPECIFIED,
      engineFilter: '',
      pageSize: 200,
      pageToken,
    });
    assets.push(...response.assets);
    pageToken = String(response.nextPageToken || '').trim();
  } while (pageToken);
  return assets;
}

async function listRuntimeLocalNodes(sdk: DesktopRendererSdkPort) {
  const nodes = [];
  let pageToken = '';
  do {
    const response = await sdk.localAssetAdmin().listNodeCatalog({
      capability: '',
      serviceId: '',
      provider: '',
      typeFilter: '',
      pageSize: 200,
      pageToken,
    });
    nodes.push(...response.nodes);
    pageToken = String(response.nextPageToken || '').trim();
  } while (pageToken);
  return nodes;
}

export async function discoverLocalModelsFromEndpoint(
  state: RuntimeConfigStateV11,
  sdk: DesktopRendererSdkPort,
) {
  const endpoint = String(state.local.endpoint || '').trim();
  const [models, nodes] = await Promise.all([
    listRuntimeLocalAssets(sdk),
    listRuntimeLocalNodes(sdk),
  ]);
  const activeModels = models.filter((m) => parseNimiRuntimeLocalAssetStatusId(m.status) !== 'removed');
  const discovered = activeModels.map((m) => m.assetId);
  const normalizedModels = activeModels.map((m) => ({
    localModelId: m.localAssetId || m.assetId,
    engine: m.engine || '',
    model: m.assetId,
    endpoint: endpoint,
    capabilities: [
      ...new Set([
        parseNimiRuntimeLocalRunnableAssetKindId(m.kind),
        ...(m.capabilities || []).map(parseNimiRuntimeLocalRunnableAssetKindId),
      ].filter((capability): capability is NimiRuntimeLocalRunnableAssetKindId => Boolean(capability))),
    ],
    status: normalizeActiveLocalModelStatus(m.status),
  }));
  const nodeMatrix = (nodes || []).map((n) => ({
    nodeId: n.nodeId || '',
    capability: normalizeRuntimeNodeCapability((n.capabilities || [])[0]),
    serviceId: n.serviceId || '',
    provider: n.provider || '',
    adapter: normalizeRuntimeNodeAdapter(n.adapter),
    available: n.available !== false,
    providerHints: normalizeProviderHints(n.providerHints),
    reasonCode: n.reasonCode,
}));
  return { endpoint, discovered, models: normalizedModels, nodeMatrix };
}

export async function checkLocalHealth(sdk: DesktopRendererSdkPort): Promise<{
  health: HealthResult;
  normalizedStatus: ProviderStatusV11;
}> {
  try {
    const snapshot = await sdk.runtimeHealthCoordinator().forceRefresh('local-health-check');
    if (!snapshot.runtimeHealth) {
      throw new Error(snapshot.error || snapshot.streamError || 'runtime health unavailable');
    }
    return normalizeRuntimeHealthResult(snapshot.runtimeHealth);
  } catch (error) {
    throw asNimiError(error, {
      reasonCode: NIMI_RUNTIME_REASON_CODES.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_health',
      source: 'runtime',
    });
  }
}

export async function discoverConnectorModelsAndHealth(input: {
  connector: RuntimeConfigStateV11['connectors'][number];
  connectorSdk: RuntimeConfigConnectorSdkService;
  now: () => number;
}): Promise<{
  endpoint: string;
  discovered: string[];
  modelCapabilities: Record<string, string[]>;
  health: HealthResult;
  normalizedStatus: ProviderStatusV11;
}> {
  const endpoint = input.connector.endpoint;
  await input.connectorSdk.sdkTestConnector(input.connector.id);
  const descriptors = await input.connectorSdk.sdkListConnectorModelDescriptors(
    input.connector.id,
    true,
  );
  const discovered = descriptors.map((d) => d.providerModelId);
  const modelCapabilities: Record<string, string[]> = {};
  for (const d of descriptors) {
    if (d.capabilities.length > 0) {
      modelCapabilities[d.providerModelId] = [...d.capabilities];
    }
  }
  return {
    endpoint,
    discovered,
    modelCapabilities,
    health: {
      status: 'healthy',
      detail: '',
      checkedAt: new Date(input.now()).toISOString(),
    },
    normalizedStatus: 'healthy',
  };
}
