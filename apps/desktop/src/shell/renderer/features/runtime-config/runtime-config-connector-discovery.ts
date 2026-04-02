import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { ProviderStatusV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { localRuntime } from '@runtime/local-runtime';
import type { GetRuntimeHealthResponse } from '@nimiplatform/sdk/runtime';
import { asNimiError } from '@nimiplatform/sdk/runtime';
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

type RuntimeNodeCapability = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding';
type RuntimeNodeAdapter = 'openai_compat_adapter' | 'llama_native_adapter' | 'media_native_adapter' | 'speech_native_adapter' | 'sidecar_music_adapter';

function normalizeRuntimeNodeCapability(value: unknown): RuntimeNodeCapability {
  switch (String(value || '').trim()) {
    case 'image':
    case 'video':
    case 'tts':
    case 'stt':
    case 'embedding':
      return String(value) as RuntimeNodeCapability;
    case 'chat':
    default:
      return 'chat';
  }
}

function normalizeRuntimeNodeAdapter(value: unknown): RuntimeNodeAdapter | undefined {
  const adapter = String(value || '').trim().toLowerCase();
  if (
    adapter === 'openai_compat_adapter'
    || adapter === 'llama_native_adapter'
    || adapter === 'media_native_adapter'
    || adapter === 'speech_native_adapter'
    || adapter === 'sidecar_music_adapter'
  ) {
    return adapter;
  }
  return undefined;
}

function statusFromRuntimeHealth(status: number): ProviderStatusV11 {
  // RuntimeHealthStatus enum: 0=UNSPECIFIED, 1=STOPPED, 2=STARTING, 3=READY, 4=DEGRADED, 5=STOPPING
  if (status === 3) return 'healthy';
  if (status === 4) return 'degraded';
  if (status === 1 || status === 5) return 'unreachable';
  return 'idle';
}

function timestampToIsoString(ts?: { seconds: string; nanos: number }): string {
  if (!ts) {
    return new Date().toISOString();
  }
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  if (Number.isNaN(ms)) {
    return new Date().toISOString();
  }
  return new Date(ms).toISOString();
}

export function normalizeRuntimeHealthResult(result: GetRuntimeHealthResponse): {
  health: HealthResult;
  normalizedStatus: ProviderStatusV11;
} {
  const normalizedStatus = statusFromRuntimeHealth(result.status);
  return {
    health: {
      status: normalizedStatus === 'idle' ? 'healthy' : normalizedStatus as HealthResult['status'],
      detail: String(result.reason || '').trim() || `runtime health ${normalizedStatus}`,
      checkedAt: timestampToIsoString(result.sampledAt),
    },
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
    engine: m.engine || 'llama',
    model: m.assetId,
    endpoint: endpoint,
    capabilities: (m.capabilities || ['chat']) as Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding'>,
    status: m.status as 'installed' | 'active' | 'unhealthy',
  }));
  const nodeMatrix = (nodes || []).map((n) => ({
    nodeId: n.nodeId || '',
    capability: normalizeRuntimeNodeCapability((n.capabilities || [])[0]),
    serviceId: n.serviceId || '',
    provider: n.provider || 'llama',
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
