/**
 * Shared Desktop host memory-embedding adjacent config service.
 *
 * This service owns the host-local adjacent config truth and exposes a
 * fail-closed runtime-facing logical surface. The runtime methods are temporary
 * skeletons for the first coding wave; they intentionally do not invent
 * resolved-profile truth in the host.
 */

import {
  createEmptyMemoryEmbeddingConfig,
  type AIScopeRef,
  type MemoryEmbeddingBindResult,
  type MemoryEmbeddingCanonicalBankStatus,
  type MemoryEmbeddingConfig,
  type MemoryEmbeddingConfigSurface,
  type MemoryEmbeddingCutoverResult,
  type MemoryEmbeddingCutoverOutcome,
  type MemoryEmbeddingResolutionState,
  type MemoryEmbeddingRuntimeInput,
  type MemoryEmbeddingRuntimeState,
  type MemoryEmbeddingRuntimeSurface,
  type MemoryEmbeddingBindOutcome,
} from '@nimiplatform/sdk/mod';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import {
  inspectMemoryEmbeddingRuntime,
  requestMemoryEmbeddingRuntimeBind,
  requestMemoryEmbeddingRuntimeCutover,
} from '@renderer/bridge/runtime-bridge/memory-embedding';
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

function toBridgeScopeRef(scopeRef: AIScopeRef): {
  kind: string;
  ownerId: string;
  surfaceId?: string;
} {
  return {
    kind: scopeRef.kind,
    ownerId: scopeRef.ownerId,
    surfaceId: scopeRef.surfaceId,
  };
}

function toBridgeTargetRef(targetRef: MemoryEmbeddingRuntimeInput['targetRef']): {
  kind: 'agent-core';
  agentId: string;
} {
  return {
    kind: 'agent-core',
    agentId: String(targetRef.agentId || '').trim(),
  };
}

function toBindingIntentSnapshot(config: MemoryEmbeddingConfig): {
  sourceKind?: 'cloud' | 'local';
  cloudBinding?: { connectorId: string; modelId: string };
  localBinding?: { targetId: string };
  revisionToken?: string;
} | undefined {
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
      if (!hasTauriInvoke()) {
        return inspectFromConfig(config);
      }
      const result = await inspectMemoryEmbeddingRuntime({
        scopeRef: toBridgeScopeRef(input.scopeRef),
        targetRef: toBridgeTargetRef(input.targetRef),
        bindingIntentSnapshot: toBindingIntentSnapshot(config),
      });
      return {
        bindingIntentPresent: result.bindingIntentPresent,
        bindingSourceKind: result.bindingSourceKind || null,
        resolutionState: normalizeResolutionState(result.resolutionState),
        resolvedProfileIdentity: result.resolvedProfileIdentity || null,
        canonicalBankStatus: normalizeCanonicalBankStatus(result.canonicalBankStatus),
        blockedReasonCode: result.blockedReasonCode || null,
        operationReadiness: {
          bindAllowed: result.operationReadiness.bindAllowed,
          cutoverAllowed: result.operationReadiness.cutoverAllowed,
        },
        traceId: result.traceId,
      };
    },

    async requestBind(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingBindResult> {
      const config = getConfigForScope(input.scopeRef);
      if (!hasTauriInvoke()) {
        const state = inspectFromConfig(config);
        return {
          outcome: 'rejected',
          blockedReasonCode: state.blockedReasonCode || ReasonCode.RUNTIME_UNAVAILABLE,
          canonicalBankStatusAfter: state.canonicalBankStatus,
          pendingCutover: false,
        };
      }
      const result = await requestMemoryEmbeddingRuntimeBind({
        scopeRef: toBridgeScopeRef(input.scopeRef),
        targetRef: toBridgeTargetRef(input.targetRef),
        bindingIntentSnapshot: toBindingIntentSnapshot(config),
      });
      return {
        outcome: normalizeBindOutcome(result.outcome),
        blockedReasonCode: result.blockedReasonCode || null,
        canonicalBankStatusAfter: normalizeCanonicalBankStatus(result.canonicalBankStatusAfter),
        pendingCutover: result.pendingCutover,
        traceId: result.traceId,
      };
    },

    async requestCutover(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingCutoverResult> {
      const config = getConfigForScope(input.scopeRef);
      if (!hasTauriInvoke()) {
        const state = inspectFromConfig(config);
        return {
          outcome: 'not_ready',
          blockedReasonCode: state.blockedReasonCode || ReasonCode.RUNTIME_UNAVAILABLE,
          canonicalBankStatusAfter: state.canonicalBankStatus,
        };
      }
      const result = await requestMemoryEmbeddingRuntimeCutover({
        scopeRef: toBridgeScopeRef(input.scopeRef),
        targetRef: toBridgeTargetRef(input.targetRef),
        bindingIntentSnapshot: toBindingIntentSnapshot(config),
      });
      return {
        outcome: normalizeCutoverOutcome(result.outcome),
        blockedReasonCode: result.blockedReasonCode || null,
        canonicalBankStatusAfter: normalizeCanonicalBankStatus(result.canonicalBankStatusAfter),
        traceId: result.traceId,
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
