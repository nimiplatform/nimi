import type {
  RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { ProviderStatusV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { localRuntime } from '@runtime/local-runtime';
import type {
  GetRuntimeHealthResponse,
  LocalRuntimeRunnableAssetKindId,
  } from '@nimiplatform/sdk/runtime';
import {
  normalizeLocalProviderAdapterId,
  type LocalProviderAdapterId,
  asNimiError,
  isLocalRuntimeRunnableAssetKindId,
  normalizeLocalRuntimeRunnableAssetKindId,
  projectRuntimeHealthSummary,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  sdkTestConnector,
  sdkListConnectorModelDescriptors,
} from './runtime-config-connector-sdk-service';
import { getRuntimeHealthCoordinator } from './runtime-health-coordinator';

type HealthResult = {
  status: 'healthy' | 'degraded' | 'unreachable' | 'unsupported';
  detail: string;
  checkedAt: string;
};

type RuntimeNodeCapability = LocalRuntimeRunnableAssetKindId;

function normalizeRuntimeNodeCapability(value: unknown): RuntimeNodeCapability {
  return normalizeLocalRuntimeRunnableAssetKindId(value);
}

function normalizeRuntimeNodeAdapter(value: unknown): LocalProviderAdapterId | undefined {
  return normalizeLocalProviderAdapterId(value);
}

export function normalizeRuntimeHealthResult(result: GetRuntimeHealthResponse): {
  health: HealthResult;
  normalizedStatus: ProviderStatusV11;
} {
  const projection = projectRuntimeHealthSummary(result);
  const normalizedStatus = projection.normalizedStatus as ProviderStatusV11;
  return {
    health: projection.health,
    normalizedStatus,
  };
}

export async function discoverLocalModelsFromEndpoint(state: RuntimeConfigStateV11) {
  const endpoint = String(state.local.endpoint || '').trim();
  const [models, nodes] = await Promise.all([
    localRuntime.listAssets(),
    localRuntime.listNodesCatalog(),
  ]);
  const activeModels = models.filter((m) => m.status !== 'removed');
  const discovered = activeModels.map((m) => m.assetId);
  const normalizedModels = activeModels.map((m) => ({
    localModelId: m.localAssetId || m.assetId,
    engine: m.engine || '',
    model: m.assetId,
    endpoint: endpoint,
    capabilities: (m.capabilities || []).filter(isLocalRuntimeRunnableAssetKindId),
    status: m.status as 'installed' | 'active' | 'unhealthy',
  }));
  const nodeMatrix = (nodes || []).map((n) => ({
    nodeId: n.nodeId || '',
    capability: normalizeRuntimeNodeCapability((n.capabilities || [])[0]),
    serviceId: n.serviceId || '',
    provider: n.provider || '',
    adapter: normalizeRuntimeNodeAdapter(n.adapter),
    available: n.available !== false,
    providerHints: n.providerHints,
    reasonCode: n.reasonCode,
}));
  return { endpoint, discovered, models: normalizedModels, nodeMatrix, rawModels: models };
}

export async function checkLocalHealth(): Promise<{
  health: HealthResult;
  normalizedStatus: ProviderStatusV11;
}> {
  try {
    const snapshot = await getRuntimeHealthCoordinator().forceRefresh('local-health-check');
    if (!snapshot.runtimeHealth) {
      throw new Error(snapshot.error || snapshot.streamError || 'runtime health unavailable');
    }
    return normalizeRuntimeHealthResult(snapshot.runtimeHealth);
  } catch (error) {
    throw asNimiError(error, {
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_health',
      source: 'runtime',
    });
  }
}

export async function discoverConnectorModelsAndHealth(input: {
  connector: RuntimeConfigStateV11['connectors'][number];
}): Promise<{
  endpoint: string;
  discovered: string[];
  modelCapabilities: Record<string, string[]>;
  health: HealthResult;
  normalizedStatus: ProviderStatusV11;
}> {
  const endpoint = input.connector.endpoint;
  await sdkTestConnector(input.connector.id);
  const descriptors = await sdkListConnectorModelDescriptors(input.connector.id, true);
  const discovered = descriptors.map((d) => d.modelId);
  const modelCapabilities: Record<string, string[]> = {};
  for (const d of descriptors) {
    if (d.capabilities.length > 0) {
      modelCapabilities[d.modelId] = d.capabilities;
    }
  }
  return {
    endpoint,
    discovered,
    modelCapabilities,
    health: {
      status: 'healthy',
      detail: '',
      checkedAt: new Date().toISOString(),
    },
    normalizedStatus: 'healthy',
  };
}
