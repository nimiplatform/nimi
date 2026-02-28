import type { HealthResult, ModelProfile, ProviderType } from '../types';
import type { ProviderAdapter } from '../providers';
import { getRuntimeClient } from '../execution/runtime-ai-bridge';

const TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY = 1;
const TOKEN_PROVIDER_HEALTH_STATUS_DEGRADED = 2;
const TOKEN_PROVIDER_HEALTH_STATUS_UNREACHABLE = 3;
const TOKEN_PROVIDER_HEALTH_STATUS_UNAUTHORIZED = 4;
const TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED = 5;

function isLoopbackHost(hostname: string): boolean {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'localhost') return true;
  if (normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]') return true;
  return normalized.startsWith('127.');
}

function isTokenApiEndpoint(endpoint: string): boolean {
  const normalized = String(endpoint || '').trim();
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return !isLoopbackHost(parsed.hostname);
  } catch {
    const lowered = normalized.toLowerCase();
    return !(
      lowered.includes('localhost')
      || lowered.includes('127.0.0.1')
      || lowered.includes('[::1]')
    );
  }
}

function tokenProviderIdFromAdapterType(type: ProviderType): string {
  switch (type) {
    case 'DASHSCOPE_COMPATIBLE':
      return 'alibaba';
    case 'VOLCENGINE_COMPATIBLE':
      return 'bytedance';
    case 'OPENAI_COMPATIBLE':
    case 'CLOUD_API':
    default:
      return 'nimillm';
  }
}

function extractBearerToken(headers?: Record<string, string>): string {
  const authValue = String(headers?.Authorization || headers?.authorization || '').trim();
  if (!authValue) return '';
  if (authValue.toLowerCase().startsWith('bearer ')) {
    return authValue.slice('bearer '.length).trim();
  }
  return authValue;
}

function toRuntimeProbeMetadata(adapter: ProviderAdapter): {
  callerKind: 'desktop-core';
  callerId: string;
  surfaceId: string;
  credentialSource: 'request-injected';
  providerApiKey: string;
  providerEndpoint: string;
} {
  const providerApiKey = extractBearerToken(adapter.config.headers);
  if (!providerApiKey) {
    throw new Error('token provider probe requires Authorization bearer token');
  }
  return {
    callerKind: 'desktop-core',
    callerId: 'runtime.llm-adapter.probe',
    surfaceId: 'desktop.renderer',
    credentialSource: 'request-injected',
    providerApiKey,
    providerEndpoint: adapter.config.endpoint,
  };
}

function mapRuntimeHealthStatus(status: number): HealthResult['status'] {
  switch (status) {
    case TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY:
      return 'healthy';
    case TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED:
      return 'unsupported';
    case TOKEN_PROVIDER_HEALTH_STATUS_DEGRADED:
    case TOKEN_PROVIDER_HEALTH_STATUS_UNREACHABLE:
    case TOKEN_PROVIDER_HEALTH_STATUS_UNAUTHORIZED:
    default:
      return 'unreachable';
  }
}

function toDiscoveredProfile(
  adapter: ProviderAdapter,
  modelId: string,
  _modelLabel: string,
): ModelProfile {
  const normalizedModel = String(modelId || '').trim();
  const profileIdPrefix = String(adapter.type || '').trim().toLowerCase() || 'openai_compatible';
  return {
    id: `${profileIdPrefix}:${normalizedModel}`,
    providerType: adapter.type,
    model: normalizedModel,
    endpoint: adapter.config.endpoint,
    capabilities: ['chat'],
    constraints: {
      allowStreaming: true,
      allowToolUse: true,
    },
    fingerprint: {
      supportsStreaming: true,
      supportsToolUse: true,
      discoveredFrom: 'provider-api',
    },
    healthStatus: 'unknown',
    lastCheckedAt: undefined,
  };
}

export async function listModelsWithRuntimeProbe(adapter: ProviderAdapter): Promise<ModelProfile[]> {
  if (!isTokenApiEndpoint(adapter.config.endpoint)) {
    return adapter.listModels();
  }

  const runtime = getRuntimeClient();
  const metadata = toRuntimeProbeMetadata(adapter);
  const response = await runtime.ai.listTokenProviderModels({
    appId: 'nimi.desktop',
    subjectUserId: 'runtime-adapter',
    providerId: tokenProviderIdFromAdapterType(adapter.type),
    providerEndpoint: adapter.config.endpoint,
    timeoutMs: 5_000,
  }, {
    timeoutMs: 5_000,
    metadata,
  });

  return (response.models || [])
    .map((item) => toDiscoveredProfile(adapter, item.modelId, item.modelLabel))
    .filter((profile) => String(profile.model || '').trim().length > 0);
}

export async function checkModelHealthWithRuntimeProbe(
  adapter: ProviderAdapter,
  model: string,
): Promise<HealthResult> {
  if (!isTokenApiEndpoint(adapter.config.endpoint)) {
    return adapter.healthCheck(model);
  }

  const runtime = getRuntimeClient();
  const metadata = toRuntimeProbeMetadata(adapter);
  const response = await runtime.ai.checkTokenProviderHealth({
    appId: 'nimi.desktop',
    subjectUserId: 'runtime-adapter',
    providerId: tokenProviderIdFromAdapterType(adapter.type),
    providerEndpoint: adapter.config.endpoint,
    modelId: String(model || '').trim(),
    timeoutMs: 5_000,
  }, {
    timeoutMs: 5_000,
    metadata,
  });

  return {
    status: mapRuntimeHealthStatus(Number(response.health?.status || 0)),
    detail: String(response.health?.detail || '').trim() || 'provider health unavailable',
    checkedAt: new Date().toISOString(),
    latencyMs: undefined,
  };
}
