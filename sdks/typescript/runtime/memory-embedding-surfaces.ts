import {
  AppMode,
  AuthorizationPreset,
  ExternalPrincipalType,
  PolicyMode,
  ReasonCode,
  WorldRelation,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import {
  buildNimiMemoryEmbeddingAgentCoreLocator,
  buildNimiMemoryEmbeddingBindingIntentSnapshot,
  projectNimiMemoryEmbeddingBindResult,
  projectNimiMemoryEmbeddingConfigFromRuntimeIntent,
  projectNimiMemoryEmbeddingCutoverResult,
  projectNimiMemoryEmbeddingRuntimeState,
  projectUnavailableNimiMemoryEmbeddingRuntimeState,
} from './memory-embedding-projection';
import type {
  NimiHostMemoryEmbeddingConfigClient,
  NimiHostMemoryEmbeddingConfigSurfaceOptions,
  NimiHostMemoryEmbeddingRuntimeClient,
  NimiHostMemoryEmbeddingRuntimeSurfaceOptions,
  NimiMemoryEmbeddingBindResult,
  NimiMemoryEmbeddingConfig,
  NimiMemoryEmbeddingConfigInput,
  NimiMemoryEmbeddingConfigSurface,
  NimiMemoryEmbeddingCutoverResult,
  NimiMemoryEmbeddingRuntimeInput,
  NimiMemoryEmbeddingRuntimeState,
  NimiMemoryEmbeddingRuntimeSurface,
  NimiProtectedHostMemoryEmbeddingConfigClient,
  NimiProtectedHostMemoryEmbeddingConfigSurfaceOptions,
  NimiProtectedHostMemoryEmbeddingRuntimeClient,
  NimiProtectedHostMemoryEmbeddingRuntimeSurfaceOptions,
} from './memory-embedding-types';

const NIMI_MEMORY_EMBEDDING_SCOPE_CATALOG_VERSION = 'sdk-v2';
const NIMI_MEMORY_EMBEDDING_TOKEN_TTL_SECONDS = 3600;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampFromDate(date: Date): { seconds: string; nanos: number } {
  const millis = date.getTime();
  return {
    seconds: String(Math.floor(millis / 1000)),
    nanos: (millis % 1000) * 1_000_000,
  };
}

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => normalizeText(scope)).filter(Boolean))].sort();
}

async function callWithNimiMemoryEmbeddingScopes<T>(
  input: {
    readonly withScopes?: <R>(
      scopes: readonly string[],
      operation: (options: RuntimeTypedCallOptions) => Promise<R>,
    ) => Promise<R>;
  },
  scopes: readonly string[],
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  return input.withScopes ? input.withScopes(scopes, operation) : operation({});
}

async function issueNimiMemoryEmbeddingCallOptions(input: {
  readonly runtime: NimiProtectedHostMemoryEmbeddingRuntimeClient | NimiProtectedHostMemoryEmbeddingConfigClient;
  readonly subjectUserId: string;
  readonly scopes: readonly string[];
}): Promise<RuntimeTypedCallOptions> {
  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0) {
    return {};
  }
  const issuedAt = new Date();
  const appInstanceId = `${input.runtime.appId}.memory-embedding`;
  const registration = await input.runtime.auth.registerApp({
    appId: input.runtime.appId,
    appInstanceId,
    deviceId: 'memory-embedding',
    appVersion: '1',
    capabilities: [],
    developerRegistration: false,
    modeManifest: {
      appMode: AppMode.FULL,
      runtimeRequired: true,
      realmRequired: true,
      worldRelation: WorldRelation.NONE,
    },
  });
  if (!registration.accepted) {
    throw createNimiError({
      message: 'Runtime memory embedding protected access registration was rejected.',
      reasonCode: 'SDK_MEMORY_EMBEDDING_PROTECTED_ACCESS_REJECTED',
      actionHint: 'register_runtime_app_first',
      source: 'runtime',
    });
  }
  const token = await input.runtime.appAuth.authorizeExternalPrincipal({
    domain: 'app-auth',
    appId: input.runtime.appId,
    externalPrincipalId: input.runtime.appId,
    externalPrincipalType: ExternalPrincipalType.APP,
    subjectUserId: input.subjectUserId,
    consentId: 'memory-embedding',
    consentVersion: 'v1',
    decisionAt: timestampFromDate(issuedAt),
    policyVersion: 'memory-embedding-v1',
    policyMode: PolicyMode.CUSTOM,
    preset: AuthorizationPreset.UNSPECIFIED,
    scopes,
    resourceSelectors: { conversationIds: [], messageIds: [], documentIds: [], labels: {} },
    canDelegate: false,
    maxDelegationDepth: 0,
    ttlSeconds: NIMI_MEMORY_EMBEDDING_TOKEN_TTL_SECONDS,
    scopeCatalogVersion: NIMI_MEMORY_EMBEDDING_SCOPE_CATALOG_VERSION,
    policyOverride: false,
  }, {
    metadata: { domain: 'app-auth' },
  });
  const tokenId = normalizeText(token.tokenId);
  const secret = normalizeText(token.secret);
  if (!tokenId || !secret) {
    throw createNimiError({
      message: 'Runtime memory embedding protected access token response is missing credentials.',
      reasonCode: 'SDK_MEMORY_EMBEDDING_PROTECTED_ACCESS_INVALID',
      actionHint: 'check_runtime_app_auth_response',
      source: 'runtime',
    });
  }
  return {
    metadata: {
      'x-nimi-access-token-id': tokenId,
      'x-nimi-access-token-secret': secret,
    },
  };
}

async function resolveRuntimeContext<T extends NimiHostMemoryEmbeddingRuntimeClient | NimiHostMemoryEmbeddingConfigClient>(
  runtime: () => T | Promise<T>,
  getSubjectUserId: () => string | Promise<string>,
): Promise<{ readonly runtime: T; readonly subjectUserId: string }> {
  const subjectUserId = normalizeText(await getSubjectUserId());
  if (!subjectUserId) {
    throw createNimiError({
      message: 'Runtime memory embedding surface requires subject user id.',
      reasonCode: 'SDK_MEMORY_EMBEDDING_SUBJECT_REQUIRED',
      actionHint: 'provide_subject_user_id',
      source: 'sdk',
    });
  }
  return { runtime: await runtime(), subjectUserId };
}

export function createNimiHostMemoryEmbeddingRuntimeSurface(
  options: NimiHostMemoryEmbeddingRuntimeSurfaceOptions,
): NimiMemoryEmbeddingRuntimeSurface {
  async function contextOrUnavailable(): Promise<
    | { readonly ok: true; readonly runtime: NimiHostMemoryEmbeddingRuntimeClient; readonly subjectUserId: string }
    | { readonly ok: false; readonly blockedReasonCode: string }
  > {
    const subjectUserId = normalizeText(await options.getSubjectUserId());
    if (!subjectUserId) {
      return { ok: false, blockedReasonCode: options.unavailableReasonCode || 'RUNTIME_UNAVAILABLE' };
    }
    return { ok: true, runtime: await options.runtime(), subjectUserId };
  }

  return {
    async inspect(input: NimiMemoryEmbeddingRuntimeInput): Promise<NimiMemoryEmbeddingRuntimeState> {
      const context = await contextOrUnavailable();
      if (!context.ok) return projectUnavailableNimiMemoryEmbeddingRuntimeState(context.blockedReasonCode);
      const result = await callWithNimiMemoryEmbeddingScopes(options, ['runtime.memory.read'], (callOptions) => (
        context.runtime.memory.inspectMemoryEmbeddingRuntime({
          context: { appId: context.runtime.appId, subjectUserId: context.subjectUserId },
          locator: buildNimiMemoryEmbeddingAgentCoreLocator(input.targetRef),
        }, callOptions)
      ));
      return projectNimiMemoryEmbeddingRuntimeState(result);
    },
    async requestBind(input: NimiMemoryEmbeddingRuntimeInput): Promise<NimiMemoryEmbeddingBindResult> {
      const context = await contextOrUnavailable();
      if (!context.ok) {
        return {
          outcome: 'rejected',
          blockedReasonCode: context.blockedReasonCode,
          canonicalBankStatusAfter: 'unbound',
          pendingCutover: false,
        };
      }
      const result = await callWithNimiMemoryEmbeddingScopes(options, ['runtime.memory.write'], (callOptions) => (
        context.runtime.memory.requestMemoryEmbeddingRuntimeBind({
          context: { appId: context.runtime.appId, subjectUserId: context.subjectUserId },
          locator: buildNimiMemoryEmbeddingAgentCoreLocator(input.targetRef),
        }, callOptions)
      ));
      return projectNimiMemoryEmbeddingBindResult(result);
    },
    async requestCutover(input: NimiMemoryEmbeddingRuntimeInput): Promise<NimiMemoryEmbeddingCutoverResult> {
      const context = await contextOrUnavailable();
      if (!context.ok) {
        return {
          outcome: 'not_ready',
          blockedReasonCode: context.blockedReasonCode,
          canonicalBankStatusAfter: 'unbound',
        };
      }
      const result = await callWithNimiMemoryEmbeddingScopes(options, ['runtime.memory.write'], (callOptions) => (
        context.runtime.memory.requestMemoryEmbeddingRuntimeCutover({
          context: { appId: context.runtime.appId, subjectUserId: context.subjectUserId },
          locator: buildNimiMemoryEmbeddingAgentCoreLocator(input.targetRef),
        }, callOptions)
      ));
      return projectNimiMemoryEmbeddingCutoverResult(result);
    },
  };
}

export function createNimiHostMemoryEmbeddingConfigSurface(
  options: NimiHostMemoryEmbeddingConfigSurfaceOptions,
): NimiMemoryEmbeddingConfigSurface {
  const subscriptions = new Map<string, Set<(config: NimiMemoryEmbeddingConfig) => void>>();

  function subscriptionKey(input: NimiMemoryEmbeddingConfigInput): string {
    return `${input.scopeRef.kind}:${input.scopeRef.ownerId}:${input.scopeRef.surfaceId || ''}:${input.targetRef.kind}:${input.targetRef.localAgentRef}`;
  }

  function notify(input: NimiMemoryEmbeddingConfigInput, config: NimiMemoryEmbeddingConfig): void {
    for (const callback of subscriptions.get(subscriptionKey(input)) || []) {
      callback(config);
    }
  }

  return {
    async get(input) {
      const context = await resolveRuntimeContext(options.runtime, options.getSubjectUserId);
      const result = await callWithNimiMemoryEmbeddingScopes(options, ['runtime.memory.read'], (callOptions) => (
        context.runtime.memory.getMemoryEmbeddingRuntimeIntent({
          context: { appId: context.runtime.appId, subjectUserId: context.subjectUserId },
          locator: buildNimiMemoryEmbeddingAgentCoreLocator(input.targetRef),
        }, callOptions)
      ));
      return projectNimiMemoryEmbeddingConfigFromRuntimeIntent(input, result);
    },
    async update(input, config) {
      const context = await resolveRuntimeContext(options.runtime, options.getSubjectUserId);
      const result = await callWithNimiMemoryEmbeddingScopes(options, ['runtime.memory.write'], (callOptions) => (
        context.runtime.memory.setMemoryEmbeddingRuntimeIntent({
          context: { appId: context.runtime.appId, subjectUserId: context.subjectUserId },
          locator: buildNimiMemoryEmbeddingAgentCoreLocator(input.targetRef),
          bindingIntent: buildNimiMemoryEmbeddingBindingIntentSnapshot(config),
        }, callOptions)
      ));
      const projected = projectNimiMemoryEmbeddingConfigFromRuntimeIntent(input, result);
      notify(input, projected);
      return projected;
    },
    subscribe(input, callback) {
      const key = subscriptionKey(input);
      const callbacks = subscriptions.get(key) || new Set<(config: NimiMemoryEmbeddingConfig) => void>();
      callbacks.add(callback);
      subscriptions.set(key, callbacks);
      return () => {
        callbacks.delete(callback);
        if (callbacks.size === 0) subscriptions.delete(key);
      };
    },
  };
}

export function createNimiProtectedHostMemoryEmbeddingRuntimeSurface(
  options: NimiProtectedHostMemoryEmbeddingRuntimeSurfaceOptions,
): NimiMemoryEmbeddingRuntimeSurface {
  let protectedRuntime: NimiProtectedHostMemoryEmbeddingRuntimeClient | null = null;
  async function runtime() {
    protectedRuntime ||= await options.runtime();
    return protectedRuntime;
  }
  return createNimiHostMemoryEmbeddingRuntimeSurface({
    ...options,
    runtime,
    withScopes: async (scopes, operation) => {
      const context = await resolveRuntimeContext(runtime, options.getSubjectUserId);
      return operation(await issueNimiMemoryEmbeddingCallOptions({ ...context, scopes }));
    },
  });
}

export function createNimiProtectedHostMemoryEmbeddingConfigSurface(
  options: NimiProtectedHostMemoryEmbeddingConfigSurfaceOptions,
): NimiMemoryEmbeddingConfigSurface {
  let protectedRuntime: NimiProtectedHostMemoryEmbeddingConfigClient | null = null;
  async function runtime() {
    protectedRuntime ||= await options.runtime();
    return protectedRuntime;
  }
  return createNimiHostMemoryEmbeddingConfigSurface({
    ...options,
    runtime,
    withScopes: async (scopes, operation) => {
      const context = await resolveRuntimeContext(runtime, options.getSubjectUserId);
      return operation(await issueNimiMemoryEmbeddingCallOptions({ ...context, scopes }));
    },
  });
}
