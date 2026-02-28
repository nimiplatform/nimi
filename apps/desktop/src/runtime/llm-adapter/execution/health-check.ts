import { resolveProviderExecutionPlan } from './provider-plan';
import type { CheckLlmHealthInput, ProviderHealth } from './types';
import { buildAdapter } from './provider-adapter';
import { formatProviderError } from './utils';
import { inferRouteSourceFromEndpoint } from './inference-audit';
import {
  getRuntimeClient,
  resolveProviderApiKeyFromCredentialRef,
} from './runtime-ai-bridge';

const TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY = 1;
const TOKEN_PROVIDER_HEALTH_STATUS_DEGRADED = 2;
const TOKEN_PROVIDER_HEALTH_STATUS_UNREACHABLE = 3;
const TOKEN_PROVIDER_HEALTH_STATUS_UNAUTHORIZED = 4;
const TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED = 5;

function toTokenProviderId(providerRef: string): string {
  const normalized = String(providerRef || '').trim().toLowerCase();
  if (
    normalized.startsWith('dashscope-compatible')
    || normalized.startsWith('aliyun')
    || normalized.startsWith('alibaba')
  ) {
    return 'alibaba';
  }
  if (
    normalized.startsWith('volcengine-compatible')
    || normalized.startsWith('bytedance')
    || normalized.startsWith('byte')
  ) {
    return 'bytedance';
  }
  if (normalized.startsWith('gemini')) return 'gemini';
  if (normalized.startsWith('minimax')) return 'minimax';
  if (normalized.startsWith('moonshot') || normalized.startsWith('kimi')) return 'kimi';
  if (normalized.startsWith('glm') || normalized.startsWith('zhipu') || normalized.startsWith('bigmodel')) return 'glm';
  return 'nimillm';
}

function mapTokenProviderHealthStatus(status: number): ProviderHealth['status'] {
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

export async function checkLocalLlmHealth(input: CheckLlmHealthInput): Promise<ProviderHealth> {
  const plan = resolveProviderExecutionPlan(input);
  const localFetch = input.fetchImpl || fetch;
  if (plan.providerKind === 'FALLBACK') {
    return {
      providerKind: plan.providerKind,
      provider: plan.providerRef,
      endpoint: null,
      model: plan.model,
      status: 'unsupported',
      detail: 'fallback provider has no health endpoint',
      checkedAt: new Date().toISOString(),
    };
  }
  try {
    const source = inferRouteSourceFromEndpoint(plan.endpoint);
    if (source === 'token-api') {
      const apiKey = await resolveProviderApiKeyFromCredentialRef(input.credentialRefId);
      const runtime = getRuntimeClient();
      const response = await runtime.ai.checkTokenProviderHealth({
        appId: 'nimi.desktop',
        subjectUserId: 'runtime-config',
        providerId: toTokenProviderId(plan.providerRef),
        providerEndpoint: plan.endpoint || '',
        modelId: plan.model,
        timeoutMs: 5_000,
      }, {
        timeoutMs: 5_000,
        metadata: {
          callerKind: 'desktop-core',
          callerId: 'runtime.health-check',
          surfaceId: 'runtime.config',
          credentialSource: 'request-injected',
          providerApiKey: apiKey,
          providerEndpoint: plan.endpoint || undefined,
        },
      });
      const checkedAt = response.health?.checkedAt
        ? new Date(Number(response.health.checkedAt.seconds || 0) * 1000).toISOString()
        : new Date().toISOString();
      return {
        providerKind: plan.providerKind,
        provider: plan.providerRef,
        endpoint: plan.endpoint,
        model: plan.model,
        status: mapTokenProviderHealthStatus(Number(response.health?.status || 0)),
        detail: String(response.health?.detail || '').trim() || 'provider health unavailable',
        checkedAt,
      };
    }

    const apiKey = await resolveProviderApiKeyFromCredentialRef(input.credentialRefId);
    const adapter = buildAdapter(plan, localFetch, apiKey);
    const health = await adapter.healthCheck(plan.model);
    return {
      providerKind: plan.providerKind,
      provider: plan.providerRef,
      endpoint: plan.endpoint,
      model: plan.model,
      status: health.status,
      detail: health.detail,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      providerKind: plan.providerKind,
      provider: plan.providerRef,
      endpoint: plan.endpoint,
      model: plan.model,
      status: 'unreachable',
      detail: formatProviderError(error),
      checkedAt: new Date().toISOString(),
    };
  }
}
