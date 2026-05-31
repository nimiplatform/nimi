import {
  ModelHealthStatus,
  type CheckModelHealthRequest,
  type CheckModelHealthResponse,
} from './generated/runtime/v1/model.js';
import type {
  TestConnectorResponse,
} from './generated/runtime/v1/connector.js';
import type {
  RuntimeRouteHostHealthInput,
  RuntimeRouteHostProviderHealth,
} from './runtime-route-host-facade.js';

export type RuntimeRouteProviderHealthCheckInput = RuntimeRouteHostHealthInput & {
  appId: string;
  checkModelHealth: (request: CheckModelHealthRequest) => Promise<CheckModelHealthResponse>;
  testConnector?: (request: { connectorId: string }) => Promise<TestConnectorResponse>;
  nowIso?: () => string;
};

export type RuntimeRouteProviderHealthProjection = Omit<
  RuntimeRouteHostProviderHealth,
  'provider' | 'endpoint' | 'model' | 'status' | 'detail'
> & {
  provider: string;
  endpoint: string | null;
  model: string;
  status: NonNullable<RuntimeRouteHostProviderHealth['status']>;
  detail: string;
  checkedAt: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatProviderError(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return String((error as { message?: unknown }).message || '');
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || '');
}

function modelHealthStatusToProviderStatus(
  status: ModelHealthStatus,
  healthy: boolean,
): NonNullable<RuntimeRouteProviderHealthProjection['status']> {
  switch (status) {
    case ModelHealthStatus.HEALTHY:
      return 'healthy';
    case ModelHealthStatus.DEGRADED:
      return 'degraded';
    case ModelHealthStatus.UNSUPPORTED:
      return 'unsupported';
    case ModelHealthStatus.UNREACHABLE:
      return 'unreachable';
    default:
      return healthy ? 'healthy' : 'unreachable';
  }
}

function buildRuntimeModelHealthRequest(
  input: RuntimeRouteProviderHealthCheckInput,
  endpoint: string,
  model: string,
  provider: string,
): CheckModelHealthRequest {
  const runtimeModelId = normalizeText(input.goRuntimeLocalModelId || input.localModelId);
  return {
    appId: normalizeText(input.appId),
    modelId: model || runtimeModelId,
    localAssetId: runtimeModelId,
    capability: normalizeText(input.capability),
    provider,
    endpoint,
  };
}

function toProviderHealth(
  input: RuntimeRouteProviderHealthCheckInput,
  response: CheckModelHealthResponse,
  endpoint: string,
  model: string,
  provider: string,
): RuntimeRouteProviderHealthProjection {
  return {
    provider,
    endpoint: normalizeText(response.endpoint || endpoint) || null,
    model: normalizeText(response.modelId || model || input.goRuntimeLocalModelId || input.localModelId),
    status: modelHealthStatusToProviderStatus(response.status, response.healthy),
    detail: normalizeText(response.detail || response.actionHint),
    checkedAt: (input.nowIso || (() => new Date().toISOString()))(),
  };
}

async function checkRuntimeModelHealth(
  input: RuntimeRouteProviderHealthCheckInput,
  endpoint: string,
  model: string,
  provider: string,
): Promise<RuntimeRouteProviderHealthProjection> {
  const request = buildRuntimeModelHealthRequest(input, endpoint, model, provider);
  const response = await input.checkModelHealth(request);
  return toProviderHealth(input, response, endpoint, model, provider);
}

export async function checkRuntimeRouteProviderHealth(
  input: RuntimeRouteProviderHealthCheckInput,
): Promise<RuntimeRouteProviderHealthProjection> {
  const endpoint = normalizeText(input.localProviderEndpoint || input.localOpenAiEndpoint);
  const model = normalizeText(input.localProviderModel || input.goRuntimeLocalModelId || input.localModelId);
  const provider = normalizeText(input.provider);
  const checkedAt = (input.nowIso || (() => new Date().toISOString()))();

  if (input.connectorId) {
    try {
      if (!input.testConnector) {
        throw new Error('Runtime connector health checker is unavailable');
      }
      const result = await input.testConnector({ connectorId: input.connectorId });
      const ok = result?.ack?.ok !== false;
      return {
        provider,
        endpoint,
        model,
        status: ok ? 'healthy' : 'degraded',
        detail: ok ? '' : (result?.ack?.actionHint || 'connector test failed'),
        checkedAt,
      };
    } catch (error) {
      return {
        provider,
        endpoint,
        model,
        status: 'unreachable',
        detail: formatProviderError(error),
        checkedAt,
      };
    }
  }

  if (endpoint || model || input.goRuntimeLocalModelId || input.localModelId) {
    try {
      return await checkRuntimeModelHealth(input, endpoint, model, provider);
    } catch (error) {
      return {
        provider,
        endpoint,
        model,
        status: 'unreachable',
        detail: formatProviderError(error),
        checkedAt,
      };
    }
  }

  return {
    provider,
    endpoint: null,
    model,
    status: 'unsupported',
    detail: 'no endpoint or connector available for health check',
    checkedAt,
  };
}
