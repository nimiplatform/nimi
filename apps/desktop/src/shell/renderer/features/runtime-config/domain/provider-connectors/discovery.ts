import { localAiRuntime } from '@runtime/local-ai-runtime';
import { getPlatformClient } from '@runtime/platform-client';
import { desktopBridge } from '@renderer/bridge';
import { TauriCredentialVault } from '@runtime/llm-adapter/credential-vault.js';
import {
  DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
  VENDOR_CATALOGS_V11,
  catalogModelsV11,
  dedupeStringsV11,
  normalizeEndpointV11,
  normalizeStatusV11,
  type NodeCapabilityV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/v11/types';

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
const TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY = 1;
const TOKEN_PROVIDER_HEALTH_STATUS_DEGRADED = 2;
const TOKEN_PROVIDER_HEALTH_STATUS_UNREACHABLE = 3;
const TOKEN_PROVIDER_HEALTH_STATUS_UNAUTHORIZED = 4;
const TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED = 5;

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

function tokenProviderIdForVendor(vendor: RuntimeConfigStateV11['connectors'][number]['vendor']): string {
  switch (vendor) {
    case 'dashscope':
      return 'alibaba';
    case 'volcengine':
      return 'bytedance';
    case 'gemini':
      return 'gemini';
    case 'kimi':
      return 'kimi';
    case 'custom':
      return 'nimillm';
    case 'openrouter':
    case 'gpt':
    case 'claude':
    case 'deepseek':
    default:
      return 'nimillm';
  }
}

function statusFromTokenProviderHealth(status: number): RuntimeConfigStateV11['connectors'][number]['status'] {
  switch (status) {
    case TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY:
      return 'healthy';
    case TOKEN_PROVIDER_HEALTH_STATUS_DEGRADED:
      return 'degraded';
    case TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED:
      return 'unsupported';
    case TOKEN_PROVIDER_HEALTH_STATUS_UNREACHABLE:
    case TOKEN_PROVIDER_HEALTH_STATUS_UNAUTHORIZED:
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

export async function discoverConnectorModelsAndHealth(input: {
  state: RuntimeConfigStateV11;
  connector: RuntimeConfigStateV11['connectors'][number];
}) {
  void input.state;
  const vault = new TauriCredentialVault();
  let token = '';
  try { token = (await vault.getCredentialSecret(input.connector.id)).trim(); }
  catch { token = ''; }
  if (!token) {
    throw new Error('token_api_key is required');
  }

  const endpoint = normalizeEndpointV11(
    input.connector.endpoint,
    VENDOR_CATALOGS_V11[input.connector.vendor].defaultEndpoint,
  );
  const runtime = getPlatformClient().runtime;
  const providerId = tokenProviderIdForVendor(input.connector.vendor);
  const callOptions = {
    timeoutMs: 5_000,
    metadata: {
      callerKind: 'desktop-core' as const,
      callerId: 'runtime-config.connector-probe',
      surfaceId: 'runtime.config',
      keySource: 'inline' as const,
      providerApiKey: token,
      providerEndpoint: endpoint,
    },
  };

  const listedResponse = await runtime.ai.listTokenProviderModels({
    appId: 'nimi.desktop',
    subjectUserId: 'runtime-config',
    providerId,
    providerEndpoint: endpoint,
    timeoutMs: 5_000,
  }, callOptions);

  const listed = (listedResponse.models || [])
    .map((item) => String(item.modelId || '').trim())
    .filter(Boolean);
  const discovered = dedupeStringsV11([
    ...input.connector.models,
    ...catalogModelsV11(input.connector.vendor),
    ...listed,
  ]);
  const firstModel = discovered[0] || 'model';
  const checkedAt = new Date().toISOString();
  const healthResponse = await runtime.ai.checkTokenProviderHealth({
    appId: 'nimi.desktop',
    subjectUserId: 'runtime-config',
    providerId,
    providerEndpoint: endpoint,
    modelId: firstModel,
    timeoutMs: 5_000,
  }, callOptions);
  const health = {
    status: statusFromTokenProviderHealth(Number(healthResponse.health?.status || 0)),
    detail: String(healthResponse.health?.detail || '').trim() || 'provider health unavailable',
    checkedAt,
  };

  return {
    endpoint,
    discovered,
    health,
    normalizedStatus: normalizeStatusV11(health.status),
  };
}
