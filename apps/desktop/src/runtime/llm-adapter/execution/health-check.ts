import {
  ModelHealthStatus,
  type CheckModelHealthRequest,
  type CheckModelHealthResponse,
} from '@nimiplatform/sdk/runtime';
import type { CheckLlmHealthInput, ProviderHealth } from './types';
import { formatProviderError } from './utils';
import { getRuntimeClient } from './runtime-ai-bridge';

const DESKTOP_RUNTIME_APP_ID = 'nimi.desktop';

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function modelHealthStatusToProviderStatus(
  status: ModelHealthStatus,
  healthy: boolean,
): ProviderHealth['status'] {
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
  input: CheckLlmHealthInput,
  endpoint: string,
  model: string,
  provider: string,
): CheckModelHealthRequest {
  const runtimeModelId = normalizeText(input.goRuntimeLocalModelId || input.localModelId);
  return {
    appId: DESKTOP_RUNTIME_APP_ID,
    modelId: model || runtimeModelId,
    localAssetId: runtimeModelId,
    capability: normalizeText(input.capability),
    provider,
    endpoint,
  };
}

function toProviderHealth(
  input: CheckLlmHealthInput,
  response: CheckModelHealthResponse,
  endpoint: string,
  model: string,
  provider: string,
): ProviderHealth {
  return {
    provider,
    endpoint: normalizeText(response.endpoint || endpoint) || null,
    model: normalizeText(response.modelId || model || input.goRuntimeLocalModelId || input.localModelId),
    status: modelHealthStatusToProviderStatus(response.status, response.healthy),
    detail: normalizeText(response.detail || response.actionHint),
    checkedAt: new Date().toISOString(),
  };
}

async function checkRuntimeModelHealth(
  input: CheckLlmHealthInput,
  endpoint: string,
  model: string,
  provider: string,
): Promise<ProviderHealth> {
  const request = buildRuntimeModelHealthRequest(input, endpoint, model, provider);
  const modelHealth = input.runtimeModelHealth
    || (async (nextRequest: CheckModelHealthRequest) => getRuntimeClient().model.checkHealth(nextRequest));
  const response = await modelHealth(request);
  return toProviderHealth(input, response, endpoint, model, provider);
}

export async function checkLocalLlmHealth(input: CheckLlmHealthInput): Promise<ProviderHealth> {
  const endpoint = normalizeText(input.localProviderEndpoint || input.localOpenAiEndpoint);
  const model = normalizeText(input.localProviderModel || input.goRuntimeLocalModelId || input.localModelId);
  const provider = normalizeText(input.provider);

  if (input.connectorId) {
    try {
      const runtime = getRuntimeClient();
      const result = await runtime.connector.testConnector({
        connectorId: input.connectorId,
      });
      const ok = result?.ack?.ok !== false;
      return {
        provider,
        endpoint,
        model,
        status: ok ? 'healthy' : 'degraded',
        detail: ok ? '' : (result?.ack?.actionHint || 'connector test failed'),
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider,
        endpoint,
        model,
        status: 'unreachable',
        detail: formatProviderError(error),
        checkedAt: new Date().toISOString(),
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
        checkedAt: new Date().toISOString(),
      };
    }
  }

  return {
    provider,
    endpoint: null,
    model,
    status: 'unsupported',
    detail: 'no endpoint or connector available for health check',
    checkedAt: new Date().toISOString(),
  };
}
