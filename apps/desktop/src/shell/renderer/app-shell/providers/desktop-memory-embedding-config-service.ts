/**
 * Shared Desktop host memory-embedding adjacent config service.
 *
 * This service owns the host-local adjacent config truth and exposes a
 * fail-closed runtime-facing logical surface. Runtime readiness, bind, and
 * cutover facts are projected through SDK runtime.memory methods backed by
 * RuntimeCognitionService.
 */

import {
  getPlatformClient,
} from '@nimiplatform/sdk';
import {
  createRuntimeProtectedScopeHelper,
  MemoryBankScope,
  RuntimeReasonCode,
  type MemoryEmbeddingBindOutcome,
  type MemoryEmbeddingBindResult,
  type MemoryEmbeddingBindingIntentSnapshot,
  type MemoryEmbeddingCanonicalBankStatus,
  type MemoryEmbeddingCutoverOutcome,
  type MemoryEmbeddingCutoverResult,
  type MemoryEmbeddingProfile,
  type MemoryEmbeddingResolutionState,
  type MemoryEmbeddingRuntimeInput,
  type MemoryEmbeddingRuntimeState,
  type MemoryEmbeddingRuntimeSurface,
  type RuntimeCallOptions,
} from '@nimiplatform/sdk/runtime';
import {
  createEmptyMemoryEmbeddingConfig,
  type AIScopeRef,
  type MemoryEmbeddingConfig,
  type MemoryEmbeddingConfigSurface,
  type MemoryEmbeddingSourceKind,
} from '@nimiplatform/sdk/ai';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from './app-store.js';
import {
  listPersistedMemoryEmbeddingScopeKeys,
  loadMemoryEmbeddingConfigForScope,
  parseMemoryEmbeddingScopeKey,
  persistMemoryEmbeddingConfigForScope,
  scopeKeyFromRef,
} from './desktop-memory-embedding-config-storage.js';

export type DesktopMemoryEmbeddingConfigService = {
  memoryEmbeddingConfig: MemoryEmbeddingConfigSurface;
  memoryEmbeddingRuntime: MemoryEmbeddingRuntimeSurface;
};

type MemoryEmbeddingSubscription = {
  scopeKey: string;
  callback: (config: MemoryEmbeddingConfig) => void;
};

let subscriptionIDCounter = 0;
const subscriptions = new Map<number, MemoryEmbeddingSubscription>();
const configByScope = new Map<string, MemoryEmbeddingConfig>();
let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

function ensureHydrated(): void {
  if (configByScope.size > 0) {
    return;
  }
  const keys = listPersistedMemoryEmbeddingScopeKeys();
  for (const key of keys) {
    const ref = parseMemoryEmbeddingScopeKey(key);
    if (!ref) {
      continue;
    }
    configByScope.set(key, loadMemoryEmbeddingConfigForScope(ref));
  }
}

function getConfigForScope(scopeRef: AIScopeRef): MemoryEmbeddingConfig {
  ensureHydrated();
  const key = scopeKeyFromRef(scopeRef);
  const existing = configByScope.get(key);
  if (existing) {
    return existing;
  }
  const loaded = loadMemoryEmbeddingConfigForScope(scopeRef);
  configByScope.set(key, loaded);
  return loaded;
}

function notifySubscribers(config: MemoryEmbeddingConfig): void {
  const key = scopeKeyFromRef(config.scopeRef);
  for (const subscription of subscriptions.values()) {
    if (subscription.scopeKey !== key) {
      continue;
    }
    try {
      subscription.callback(config);
    } catch {
      // Subscriber failures must not break host-local owner behavior.
    }
  }
}

function commitConfig(config: MemoryEmbeddingConfig): void {
  const committed: MemoryEmbeddingConfig = {
    ...config,
    revisionToken: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  configByScope.set(scopeKeyFromRef(committed.scopeRef), committed);
  persistMemoryEmbeddingConfigForScope(committed);
  notifySubscribers(committed);
}

function inspectFromConfig(config: MemoryEmbeddingConfig): MemoryEmbeddingRuntimeState {
  const bindingIntentPresent = Boolean(config.sourceKind && config.bindingRef);
  if (!bindingIntentPresent) {
    return {
      bindingIntentPresent: false,
      bindingSourceKind: null,
      resolutionState: 'missing',
      resolvedProfileIdentity: null,
      canonicalBankStatus: 'unbound',
      blockedReasonCode: null,
      operationReadiness: {
        bindAllowed: false,
        cutoverAllowed: false,
      },
    };
  }

  return {
    bindingIntentPresent: true,
    bindingSourceKind: config.sourceKind,
    resolutionState: 'unavailable',
    resolvedProfileIdentity: null,
    canonicalBankStatus: 'unbound',
    blockedReasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    operationReadiness: {
      bindAllowed: false,
      cutoverAllowed: false,
    },
  };
}

function toBindingIntentSnapshot(config: MemoryEmbeddingConfig): MemoryEmbeddingBindingIntentSnapshot | undefined {
  if (!config.sourceKind || !config.bindingRef) {
    return undefined;
  }
  if (config.sourceKind === 'cloud' && config.bindingRef.kind === 'cloud') {
    return {
      sourceKind: 'cloud',
      cloudBinding: {
        connectorId: config.bindingRef.connectorId,
        modelId: config.bindingRef.modelId,
      },
      revisionToken: config.revisionToken,
    };
  }
  if (config.sourceKind === 'local' && config.bindingRef.kind === 'local') {
    return {
      sourceKind: 'local',
      localBinding: {
        targetId: config.bindingRef.targetId,
      },
      revisionToken: config.revisionToken,
    };
  }
  return undefined;
}

function currentSubjectUserId(): string {
  const user = useAppStore.getState().auth.user as Record<string, unknown> | null;
  return String(user?.id || '').trim();
}

function getProtectedAccess() {
  if (protectedAccess) {
    return protectedAccess;
  }
  const runtime = getPlatformClient().runtime;
  protectedAccess = createRuntimeProtectedScopeHelper({
    runtime,
    getSubjectUserId: async () => {
      const subjectUserId = currentSubjectUserId();
      if (!subjectUserId) {
        throw new Error('desktop memory embedding runtime requires authenticated subject user id');
      }
      return subjectUserId;
    },
  });
  return protectedAccess;
}

function toRuntimeRequestContext() {
  return {
    appId: getPlatformClient().runtime.appId,
    subjectUserId: currentSubjectUserId(),
  };
}

function toRuntimeAgentCoreLocator(targetRef: MemoryEmbeddingRuntimeInput['targetRef']) {
  return {
    scope: MemoryBankScope.AGENT_CORE,
    owner: {
      oneofKind: 'agentCore' as const,
      agentCore: {
        agentId: String(targetRef.agentId || '').trim(),
      },
    },
  };
}

function runtimeReasonCodeName(value: RuntimeReasonCode | undefined): string | null {
  const numeric = Number(value ?? RuntimeReasonCode.REASON_CODE_UNSPECIFIED);
  if (!Number.isFinite(numeric) || numeric === RuntimeReasonCode.REASON_CODE_UNSPECIFIED) {
    return null;
  }
  return RuntimeReasonCode[numeric as RuntimeReasonCode] || null;
}

function memoryEmbeddingProfileIdentity(profile: MemoryEmbeddingProfile | undefined): string | null {
  if (!profile) {
    return null;
  }
  const parts = [profile.provider, profile.modelId, profile.version]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(':') : null;
}

async function withRuntimeMemoryScopes<T>(
  scopes: readonly string[],
  operation: (options: RuntimeCallOptions) => Promise<T>,
): Promise<T> {
  return getProtectedAccess().withScopes(scopes, operation);
}

function normalizeResolutionState(value: string): MemoryEmbeddingResolutionState {
  switch (value) {
    case 'missing':
    case 'resolved':
    case 'unresolved':
    case 'unavailable':
      return value;
    default:
      return 'unavailable';
  }
}

function normalizeBindingSourceKind(value: string): MemoryEmbeddingSourceKind | null {
  switch (value) {
    case 'cloud':
    case 'local':
      return value;
    default:
      return null;
  }
}

function normalizeCanonicalBankStatus(value: string): MemoryEmbeddingCanonicalBankStatus {
  switch (value) {
    case 'unbound':
    case 'bound_equivalent':
    case 'bound_profile_mismatch':
    case 'rebuild_pending':
    case 'cutover_ready':
      return value;
    default:
      return 'unbound';
  }
}

function normalizeBindOutcome(value: string): MemoryEmbeddingBindOutcome {
  switch (value) {
    case 'bound':
    case 'already_bound':
    case 'staged_rebuild':
    case 'rejected':
      return value;
    default:
      return 'rejected';
  }
}

function normalizeCutoverOutcome(value: string): MemoryEmbeddingCutoverOutcome {
  switch (value) {
    case 'cutover_committed':
    case 'already_current':
    case 'not_ready':
    case 'rejected':
      return value;
    default:
      return 'rejected';
  }
}

function createMemoryEmbeddingConfigSurface(): MemoryEmbeddingConfigSurface {
  return {
    get(scopeRef: AIScopeRef): MemoryEmbeddingConfig {
      return getConfigForScope(scopeRef);
    },

    update(scopeRef: AIScopeRef, config: MemoryEmbeddingConfig): void {
      commitConfig({
        ...config,
        scopeRef,
      });
    },

    subscribe(scopeRef: AIScopeRef, callback: (config: MemoryEmbeddingConfig) => void): () => void {
      const id = ++subscriptionIDCounter;
      subscriptions.set(id, {
        scopeKey: scopeKeyFromRef(scopeRef),
        callback,
      });
      return () => {
        subscriptions.delete(id);
      };
    },
  };
}

function createMemoryEmbeddingRuntimeSurface(): MemoryEmbeddingRuntimeSurface {
  return {
    async inspect(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingRuntimeState> {
      const config = getConfigForScope(input.scopeRef);
      if (!currentSubjectUserId()) {
        return inspectFromConfig(config);
      }
      const runtime = getPlatformClient().runtime;
      const result = await withRuntimeMemoryScopes(['runtime.memory.read'], (options) => runtime.memory.inspectMemoryEmbeddingRuntime({
        context: toRuntimeRequestContext(),
        locator: toRuntimeAgentCoreLocator(input.targetRef),
        bindingIntentSnapshot: toBindingIntentSnapshot(config),
      }, options));
      return {
        bindingIntentPresent: result.bindingIntentPresent,
        bindingSourceKind: normalizeBindingSourceKind(result.bindingSourceKind),
        resolutionState: normalizeResolutionState(result.resolutionState),
        resolvedProfileIdentity: memoryEmbeddingProfileIdentity(result.resolvedProfile),
        canonicalBankStatus: normalizeCanonicalBankStatus(result.canonicalBankStatus),
        blockedReasonCode: runtimeReasonCodeName(result.blockedReasonCode),
        operationReadiness: {
          bindAllowed: Boolean(result.operationReadiness?.bindAllowed),
          cutoverAllowed: Boolean(result.operationReadiness?.cutoverAllowed),
        },
      };
    },

    async requestBind(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingBindResult> {
      const config = getConfigForScope(input.scopeRef);
      if (!currentSubjectUserId()) {
        const state = inspectFromConfig(config);
        return {
          outcome: 'rejected',
          blockedReasonCode: state.blockedReasonCode || ReasonCode.RUNTIME_UNAVAILABLE,
          canonicalBankStatusAfter: state.canonicalBankStatus,
          pendingCutover: false,
        };
      }
      const runtime = getPlatformClient().runtime;
      const result = await withRuntimeMemoryScopes(['runtime.memory.write'], (options) => runtime.memory.requestMemoryEmbeddingRuntimeBind({
        context: toRuntimeRequestContext(),
        locator: toRuntimeAgentCoreLocator(input.targetRef),
        bindingIntentSnapshot: toBindingIntentSnapshot(config),
      }, options));
      return {
        outcome: normalizeBindOutcome(result.outcome),
        blockedReasonCode: runtimeReasonCodeName(result.blockedReasonCode),
        canonicalBankStatusAfter: normalizeCanonicalBankStatus(result.canonicalBankStatusAfter),
        pendingCutover: result.pendingCutover,
      };
    },

    async requestCutover(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingCutoverResult> {
      const config = getConfigForScope(input.scopeRef);
      if (!currentSubjectUserId()) {
        const state = inspectFromConfig(config);
        return {
          outcome: 'not_ready',
          blockedReasonCode: state.blockedReasonCode || ReasonCode.RUNTIME_UNAVAILABLE,
          canonicalBankStatusAfter: state.canonicalBankStatus,
        };
      }
      const runtime = getPlatformClient().runtime;
      const result = await withRuntimeMemoryScopes(['runtime.memory.write'], (options) => runtime.memory.requestMemoryEmbeddingRuntimeCutover({
        context: toRuntimeRequestContext(),
        locator: toRuntimeAgentCoreLocator(input.targetRef),
        bindingIntentSnapshot: toBindingIntentSnapshot(config),
      }, options));
      return {
        outcome: normalizeCutoverOutcome(result.outcome),
        blockedReasonCode: runtimeReasonCodeName(result.blockedReasonCode),
        canonicalBankStatusAfter: normalizeCanonicalBankStatus(result.canonicalBankStatusAfter),
      };
    },
  };
}

let singleton: DesktopMemoryEmbeddingConfigService | null = null;

export function getDesktopMemoryEmbeddingConfigService(): DesktopMemoryEmbeddingConfigService {
  if (!singleton) {
    singleton = {
      memoryEmbeddingConfig: createMemoryEmbeddingConfigSurface(),
      memoryEmbeddingRuntime: createMemoryEmbeddingRuntimeSurface(),
    };
  }
  return singleton;
}

export function seedEmptyDesktopMemoryEmbeddingConfig(scopeRef: AIScopeRef): MemoryEmbeddingConfig {
  const current = getConfigForScope(scopeRef);
  if (current.sourceKind || current.bindingRef) {
    return current;
  }
  const empty = createEmptyMemoryEmbeddingConfig(scopeRef);
  configByScope.set(scopeKeyFromRef(scopeRef), empty);
  return empty;
}
