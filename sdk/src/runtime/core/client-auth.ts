import {
  isRuntimeLocalAnonymousMethod,
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
import type {
  RuntimeCallOptionsInternal,
  RuntimeClientConfigInternal,
  RuntimeStreamCallOptionsInternal,
} from '../types-internal.js';
import { mergeRuntimeMetadata } from './metadata.js';
import {
  normalizeText,
  type RuntimeAiRouteRequest,
} from './client-validation.js';

let idempotencyCounter = 0;

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `sdk-${Date.now().toString(36)}-${suffix}`;
  }
  idempotencyCounter += 1;
  return `sdk-${Date.now().toString(36)}-${idempotencyCounter.toString(36)}`;
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
  config: RuntimeClientConfig | RuntimeClientConfigInternal,
  methodId: string,
  request: unknown,
  options?: RuntimeCallOptions | RuntimeStreamCallOptions,
): Promise<string | undefined> {
  if (isRuntimeLocalAnonymousMethod(methodId)) {
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
  options?:
    | RuntimeCallOptions
    | RuntimeStreamCallOptions
    | RuntimeCallOptionsInternal
    | RuntimeStreamCallOptionsInternal,
):
  | RuntimeCallOptions
  | RuntimeStreamCallOptions
  | RuntimeCallOptionsInternal
  | RuntimeStreamCallOptionsInternal
  | undefined {
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
  config: RuntimeClientConfig | RuntimeClientConfigInternal,
  methodId: string,
  request: RuntimeWireMessage,
  normalizedRequest: unknown,
  options?: RuntimeCallOptions | RuntimeCallOptionsInternal,
): Promise<RuntimeUnaryCall<RuntimeWireMessage>> {
  const resolvedOptions = withIdempotencyKey(methodId, options) as RuntimeCallOptionsInternal | undefined;
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
  config: RuntimeClientConfig | RuntimeClientConfigInternal,
  methodId: string,
  request: RuntimeWireMessage,
  normalizedRequest: unknown,
  options?: RuntimeStreamCallOptions | RuntimeStreamCallOptionsInternal,
): Promise<RuntimeOpenStreamCall<RuntimeWireMessage>> {
  const resolvedOptions = withIdempotencyKey(methodId, options) as RuntimeStreamCallOptionsInternal | undefined;
  return {
    methodId,
    request,
    metadata: mergeRuntimeMetadata(config, resolvedOptions),
    authorization: await resolveAuthorization(config, methodId, normalizedRequest, resolvedOptions),
    timeoutMs: resolvedOptions?.timeoutMs,
    signal: resolvedOptions?.signal,
  };
}
