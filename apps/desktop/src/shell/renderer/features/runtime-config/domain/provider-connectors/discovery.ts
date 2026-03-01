import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/v11/types';
import type { ProviderStatusV11 } from '@renderer/features/runtime-config/state/v11/types/modality';
import { localAiRuntime } from '@runtime/local-ai-runtime';
import { getPlatformClient } from '@runtime/platform-client';
import {
  sdkTestConnector,
  sdkListConnectorModelDescriptors,
} from './connector-sdk-service';

type HealthResult = {
  status: 'healthy' | 'degraded' | 'unreachable' | 'unsupported';
  detail: string;
  checkedAt: string;
};

function statusFromRuntimeHealth(status: number): ProviderStatusV11 {
  // RuntimeHealthStatus enum: 0=UNSPECIFIED, 1=STOPPED, 2=STARTING, 3=READY, 4=DEGRADED, 5=STOPPING
  if (status === 3) return 'healthy';
  if (status === 4) return 'degraded';
  if (status === 1 || status === 5) return 'unreachable';
  return 'idle';
}

export async function discoverLocalRuntimeModelsFromEndpoint(state: RuntimeConfigStateV11) {
  const endpoint = state.localRuntime.endpoint || 'http://127.0.0.1:1234/v1';
  const models = await localAiRuntime.list();
  const nodes = await localAiRuntime.listNodesCatalog();
  const discovered = models.map((m) => m.modelId);
  const normalizedModels = models.map((m) => ({
    localModelId: m.localModelId || m.modelId,
    engine: m.engine || 'localai',
    model: m.modelId,
    endpoint: m.endpoint || endpoint,
    capabilities: (m.capabilities || ['chat']) as Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding'>,
    status: m.status as 'installed' | 'active' | 'unhealthy' | 'removed',
  }));
  const nodeMatrix = (nodes || []).map((n) => ({
    nodeId: n.nodeId || '',
    capability: ((n.capabilities || [])[0] || 'chat') as any,
    serviceId: n.serviceId || '',
    provider: n.provider || 'localai',
    adapter: (n.adapter || 'openai_compat_adapter') as 'openai_compat_adapter' | 'localai_native_adapter',
    available: n.available !== false,
  }));
  return { endpoint, discovered, models: normalizedModels, nodeMatrix };
}

export async function checkLocalRuntimeHealth(): Promise<{
  health: HealthResult;
  normalizedStatus: ProviderStatusV11;
}> {
  try {
    const runtime = getPlatformClient().runtime;
    const result = await runtime.audit.getRuntimeHealth({}, { timeoutMs: 5000 });
    const status = statusFromRuntimeHealth(result.status);
    return {
      health: {
        status: status === 'idle' ? 'healthy' : status as HealthResult['status'],
        detail: '',
        checkedAt: new Date().toISOString(),
      },
      normalizedStatus: status,
    };
  } catch (error) {
    return {
      health: {
        status: 'unreachable',
        detail: error instanceof Error ? error.message : String(error || ''),
        checkedAt: new Date().toISOString(),
      },
      normalizedStatus: 'unreachable',
    };
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
  const testResult = await sdkTestConnector(input.connector.id);
  const descriptors = await sdkListConnectorModelDescriptors(input.connector.id, true);
  const discovered = descriptors.map((d) => d.modelId);
  const modelCapabilities: Record<string, string[]> = {};
  for (const d of descriptors) {
    if (d.capabilities.length > 0) {
      modelCapabilities[d.modelId] = d.capabilities;
    }
  }
  const status: HealthResult['status'] = testResult.ok ? 'healthy' : 'degraded';
  return {
    endpoint,
    discovered,
    modelCapabilities,
    health: {
      status,
      detail: testResult.ok ? '' : testResult.message,
      checkedAt: new Date().toISOString(),
    },
    normalizedStatus: status,
  };
}
