import {
  isRuntimeLocalRuntimeAnonymousMethod,
  isRuntimeWriteMethod,
  RuntimeMethodIds,
} from '../method-ids.js';
import { runtimeAiRequestRequiresSubject } from '../runtime-guards.js';
import type {
  RuntimeCallOptions,
  RuntimeClientConfig,
  RuntimeOpenStreamCall,
  RuntimeStreamCallOptions,
  RuntimeUnaryCall,
  RuntimeWireMessage,
} from '../types.js';
import { mergeRuntimeMetadata } from './metadata.js';
import {
  normalizeText,
  type RuntimeAiRouteRequest,
} from './client-validation.js';

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sdk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatAuthorizationHeader(accessToken: string): string {
  const normalized = normalizeText(accessToken);
  if (!normalized) {
    return '';
  }
  if (normalized.toLowerCase().startsWith('bearer ')) {
    const token = normalizeText(normalized.slice(7));
    return token ? `Bearer ${token}` : '';
  }
  return `Bearer ${normalized}`;
}

async function resolveAuthorization(
  config: RuntimeClientConfig,
  methodId: string,
  request: unknown,
  options?: RuntimeCallOptions | RuntimeStreamCallOptions,
): Promise<string | undefined> {
  if (isRuntimeLocalRuntimeAnonymousMethod(methodId)) {
    return undefined;
  }
  if (
    (methodId === RuntimeMethodIds.ai.executeScenario
      || methodId === RuntimeMethodIds.ai.streamScenario
      || methodId === RuntimeMethodIds.ai.submitScenarioJob)
    && !runtimeAiRequestRequiresSubject({
      request: request as RuntimeAiRouteRequest,
      metadata: options?.metadata,
    })
  ) {
    return undefined;
  }

  const accessTokenInput = config.auth?.accessToken;
  if (typeof accessTokenInput === 'function') {
    const resolved = formatAuthorizationHeader(await accessTokenInput());
    return resolved || undefined;
  }
  const resolved = formatAuthorizationHeader(accessTokenInput || '');
  return resolved || undefined;
}

function withIdempotencyKey(
  methodId: string,
  options?: RuntimeCallOptions | RuntimeStreamCallOptions,
): RuntimeCallOptions | RuntimeStreamCallOptions | undefined {
  if (!isRuntimeWriteMethod(methodId)) {
    return options;
  }
  if (options?.idempotencyKey || options?.metadata?.idempotencyKey) {
    return options;
  }
  return {
    ...(options || {}),
    idempotencyKey: createIdempotencyKey(),
  };
}

export async function toUnaryCall(
  config: RuntimeClientConfig,
  methodId: string,
  request: RuntimeWireMessage,
  normalizedRequest: unknown,
  options?: RuntimeCallOptions,
): Promise<RuntimeUnaryCall<RuntimeWireMessage>> {
  const resolvedOptions = withIdempotencyKey(methodId, options) as RuntimeCallOptions | undefined;
  return {
    methodId,
    request,
    metadata: mergeRuntimeMetadata(config, resolvedOptions),
    authorization: await resolveAuthorization(config, methodId, normalizedRequest, resolvedOptions),
    timeoutMs: resolvedOptions?.timeoutMs,
    _responseMetadataObserver: resolvedOptions?._responseMetadataObserver,
  };
}

export async function toStreamCall(
  config: RuntimeClientConfig,
  methodId: string,
  request: RuntimeWireMessage,
  normalizedRequest: unknown,
  options?: RuntimeStreamCallOptions,
): Promise<RuntimeOpenStreamCall<RuntimeWireMessage>> {
  const resolvedOptions = withIdempotencyKey(methodId, options) as RuntimeStreamCallOptions | undefined;
  return {
    methodId,
    request,
    metadata: mergeRuntimeMetadata(config, resolvedOptions),
    authorization: await resolveAuthorization(config, methodId, normalizedRequest, resolvedOptions),
    timeoutMs: resolvedOptions?.timeoutMs,
    signal: resolvedOptions?.signal,
  };
}
