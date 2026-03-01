import { localAiRuntime } from '@runtime/local-ai-runtime';
import { getPlatformClient } from '@runtime/platform-client';
import { desktopBridge } from '@renderer/bridge';
import {
  DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
  dedupeStringsV11,
  normalizeEndpointV11,
  normalizeStatusV11,
  type NodeCapabilityV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/v11/types';
import {
  sdkTestConnector,
  sdkListConnectorModelDescriptors,
} from './connector-sdk-service';

type LocalRuntimeHealthSummary = {
  status: 'healthy' | 'degraded' | 'unreachable' | 'unsupported' | 'idle';
  detail: string;
  checkedAt: string;
};

const RUNTIME_HEALTH_CALL_OPTIONS = {
  timeoutMs: 2500,
  metadata: {
    callerKind: 'desktop-core' as const,
    callerId: 'runtime-config.health',
    surfaceId: 'runtime.config',
  },
};

const RUNTIME_HEALTH_STATUS_STOPPED = 1;
const RUNTIME_HEALTH_STATUS_STARTING = 2;
const RUNTIME_HEALTH_STATUS_READY = 3;
const RUNTIME_HEALTH_STATUS_DEGRADED = 4;
const RUNTIME_HEALTH_STATUS_STOPPING = 5;
function statusFromRuntimeHealth(status: number): LocalRuntimeHealthSummary['status'] {
  switch (status) {
    case RUNTIME_HEALTH_STATUS_READY:
      return 'healthy';
    case RUNTIME_HEALTH_STATUS_DEGRADED:
      return 'degraded';
    case RUNTIME_HEALTH_STATUS_STARTING:
    case RUNTIME_HEALTH_STATUS_STOPPING:
      return 'idle';
    case RUNTIME_HEALTH_STATUS_STOPPED:
    default:
      return 'unreachable';
  }
}

function defaultRuntimeDetail(status: LocalRuntimeHealthSummary['status']): string {
  switch (status) {
    case 'healthy':
      return 'runtime ready';
    case 'degraded':
      return 'runtime degraded';
    case 'idle':
      return 'runtime state changing';
    case 'unsupported':
      return 'runtime unsupported';
    case 'unreachable':
    default:
      return 'runtime unreachable';
  }
}

function parseProviderHealthIssue(
  providers: Array<{ providerName: string; state: string; reason: string; consecutiveFailures: number }>,
): string | null {
  const unhealthy = providers.find(
    (provider) => String(provider.state || '').trim().toLowerCase() === 'unhealthy',
  );
  if (!unhealthy) {
    return null;
  }
  const providerName = String(unhealthy.providerName || '').trim() || 'unknown';
  const reason = String(unhealthy.reason || '').trim();
  return reason
    ? `provider ${providerName} unhealthy: ${reason}`
    : `provider ${providerName} unhealthy`;
}

function normalizeAdapter(
  value: string | undefined,
): 'openai_compat_adapter' | 'localai_native_adapter' {
  return String(value || '').trim().toLowerCase() === 'localai_native_adapter'
    ? 'localai_native_adapter'
    : 'openai_compat_adapter';
}

function normalizeLocalRuntimeCapabilities(
  input: string[],
): Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding'> {
  const capabilities = Array.from(new Set(
    input
      .map((item) => String(item || '').trim())
      .filter((item): item is 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' => (
        item === 'chat'
        || item === 'image'
        || item === 'video'
        || item === 'tts'
        || item === 'stt'
        || item === 'embedding'
      )),
  ));
  return capabilities.length > 0 ? capabilities : ['chat'];
}

export async function discoverLocalRuntimeModelsFromEndpoint(state: RuntimeConfigStateV11) {
  const endpoint = normalizeEndpointV11(state.localRuntime.endpoint, DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11);
  const [models, nodes] = await Promise.all([
    localAiRuntime.list(),
    localAiRuntime.listNodesCatalog(),
  ]);
  const discovered = dedupeStringsV11(models.map((model) => String(model.modelId || '').trim()));
  const normalizedModels = models
    .filter((model) => model.status !== 'removed')
    .map((model) => ({
      localModelId: model.localModelId,
      engine: model.engine,
      model: model.modelId,
      endpoint: normalizeEndpointV11(model.endpoint || endpoint, endpoint),
      capabilities: normalizeLocalRuntimeCapabilities(model.capabilities),
      status: model.status,
      installedAt: model.installedAt,
      updatedAt: model.updatedAt,
    }));
  const nodeMatrix = nodes.map((node) => ({
    nodeId: node.nodeId,
    capability: String(node.capabilities[0] || 'chat') as NodeCapabilityV11,
    serviceId: node.serviceId,
    provider: String(node.provider || (String(node.serviceId || '').toLowerCase().includes('nexa') ? 'nexa' : 'localai')).toLowerCase(),
    adapter: normalizeAdapter(node.adapter),
    backend: node.backend,
    backendSource: node.backendSource,
    available: Boolean(node.available),
    reasonCode: node.reasonCode,
    policyGate: node.policyGate,
    providerHints: node.providerHints,
  }));
  return {
    endpoint,
    discovered,
    models: normalizedModels,
    nodeMatrix,
  };
}

export async function checkLocalRuntimeHealth(): Promise<{
  health: LocalRuntimeHealthSummary;
  normalizedStatus: RuntimeConfigStateV11['localRuntime']['status'];
}> {
  const checkedAt = new Date().toISOString();
  try {
    const runtime = getPlatformClient().runtime;
    if (!runtime) {
      const health = {
        status: 'unreachable' as const,
        detail: 'runtime sdk client unavailable',
        checkedAt,
      };
      return {
        health,
        normalizedStatus: normalizeStatusV11(health.status),
      };
    }

    const [runtimeHealth, providerHealth] = await Promise.all([
      runtime.audit.getRuntimeHealth({}, RUNTIME_HEALTH_CALL_OPTIONS),
      runtime.audit.listAIProviderHealth({}, RUNTIME_HEALTH_CALL_OPTIONS),
    ]);

    let status = statusFromRuntimeHealth(runtimeHealth.status);
    let detail = String(runtimeHealth.reason || '').trim() || defaultRuntimeDetail(status);

    const providerIssue = parseProviderHealthIssue(providerHealth.providers || []);
    if (providerIssue) {
      if (status === 'healthy') {
        status = 'degraded';
      }
      detail = `${detail}; ${providerIssue}`;
    }

    const health = { status, detail, checkedAt };
    return {
      health,
      normalizedStatus: normalizeStatusV11(health.status),
    };
  } catch (error) {
    const bridgeStatus = await desktopBridge.getRuntimeBridgeStatus().catch(() => null);
    const detail = bridgeStatus
      ? bridgeStatus.running
        ? `runtime health rpc failed while daemon is running (${bridgeStatus.grpcAddr})`
        : `runtime daemon is stopped (${bridgeStatus.grpcAddr})`
      : `runtime health check failed: ${error instanceof Error ? error.message : String(error || '')}`;
    const health = {
      status: 'unreachable' as const,
      detail,
      checkedAt,
    };
    return {
      health,
      normalizedStatus: normalizeStatusV11(health.status),
    };
  }
}

/**
 * Test a connector and discover its models via SDK.
 * Replaces the old HTTP-based approach.
 */
export async function discoverConnectorModelsAndHealth(input: {
  connector: RuntimeConfigStateV11['connectors'][number];
}) {
  const checkedAt = new Date().toISOString();

  const [testResult, descriptors] = await Promise.all([
    sdkTestConnector(input.connector.id),
    sdkListConnectorModelDescriptors(input.connector.id, true).catch(() => []),
  ]);

  const modelIds = descriptors.map((d) => d.modelId);
  const discovered = dedupeStringsV11([
    ...modelIds,
    ...input.connector.models,
  ]);

  const modelCapabilities: Record<string, string[]> = {};
  for (const d of descriptors) {
    if (d.modelId && d.capabilities.length > 0) {
      modelCapabilities[d.modelId] = d.capabilities;
    }
  }

  const health = {
    status: testResult.ok ? 'healthy' as const : 'unreachable' as const,
    detail: testResult.message,
    checkedAt,
  };

  return {
    endpoint: input.connector.endpoint,
    discovered,
    modelCapabilities,
    health,
    normalizedStatus: normalizeStatusV11(health.status),
  };
}
