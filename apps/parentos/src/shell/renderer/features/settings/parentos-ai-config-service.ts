import {
  createEmptyAIConfig,
  type AIConfig,
  type AIConfigProbeResult,
  type AIConfigSDKSurface,
  type AIProfileApplyResult,
  type AIProbeStatus,
  type AISchedulingEvaluationTarget,
  type AISchedulingJudgement,
  type AIScopeRef,
  type AISnapshot,
} from '@nimiplatform/sdk/mod';
import { useAppStore } from '../../app-shell/app-store.js';
import {
  PARENTOS_AI_SCOPE_REF,
  createEmptyParentosAIConfig,
  isParentosAIScopeRef,
  savePersistedParentosAIConfig,
} from './parentos-ai-config.js';
type ConfigSubscription = (config: AIConfig) => void;

const configSubscriptions = new Set<ConfigSubscription>();
const snapshotsByExecutionId = new Map<string, AISnapshot>();
const latestSnapshotByScopeKey = new Map<string, AISnapshot>();
function scopeKey(scopeRef: AIScopeRef): string {
  return [scopeRef.kind, scopeRef.ownerId, scopeRef.surfaceId || ''].join(':');
}

function notifyConfigSubscribers(config: AIConfig): void {
  for (const callback of configSubscriptions) {
    try {
      callback(config);
    } catch {
      // Subscriber failures must not break config writes.
    }
  }
}

function getConfigForScope(scopeRef: AIScopeRef): AIConfig {
  if (!isParentosAIScopeRef(scopeRef)) {
    return createEmptyAIConfig(scopeRef);
  }
  return useAppStore.getState().aiConfig || createEmptyParentosAIConfig();
}

function commitConfig(config: AIConfig): void {
  const resolvedConfig = {
    ...config,
    scopeRef: { ...PARENTOS_AI_SCOPE_REF },
  } satisfies AIConfig;
  useAppStore.getState().setAIConfig(resolvedConfig);
  notifyConfigSubscribers(resolvedConfig);
  void savePersistedParentosAIConfig(resolvedConfig).catch(() => {});
}

function createAIProfileSurface() {
  const applyProfile = async (scopeRef: AIScopeRef, profileId: string): Promise<AIProfileApplyResult> => {
    void scopeRef;
    return {
      success: false,
      config: null,
      failureReason: `Profile not found: ${profileId}`,
      probeWarnings: [],
    };
  };

  return {
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    validate() {
      return {
        valid: true,
        errors: [],
      };
    },
    apply: applyProfile,

    async resolveLocalDependencies(): Promise<unknown[]> {
      return [];
    },
  };
}

function createAIConfigSurface() {
  const probeScope = async (scopeRef: AIScopeRef): Promise<AIConfigProbeResult> => {
    if (!isParentosAIScopeRef(scopeRef)) {
      return { status: 'unknown', capabilityStatuses: {} };
    }
    const config = getConfigForScope(scopeRef);
    const selectedBindings = config.capabilities.selectedBindings || {};
    const capabilityStatuses: AIConfigProbeResult['capabilityStatuses'] = {};
    let allConfigured = true;
    for (const capability of Object.keys(selectedBindings)) {
      const binding = selectedBindings[capability];
      const status: AIProbeStatus = binding?.model ? 'available' : 'unknown';
      capabilityStatuses[capability] = status;
      allConfigured = allConfigured && status === 'available';
    }
    return {
      status: allConfigured ? 'available' : 'unknown',
      capabilityStatuses,
    };
  };

  return {
    get(scopeRef: AIScopeRef): AIConfig {
      return getConfigForScope(scopeRef);
    },

    update(scopeRef: AIScopeRef, config: AIConfig): void {
      if (!isParentosAIScopeRef(scopeRef)) {
        return;
      }
      commitConfig({
        ...config,
        scopeRef: { ...PARENTOS_AI_SCOPE_REF },
      });
    },

    listScopes(): AIScopeRef[] {
      return useAppStore.getState().aiConfig ? [{ ...PARENTOS_AI_SCOPE_REF }] : [];
    },

    probe: probeScope,
    probeFeasibility: probeScope,

    async probeSchedulingTarget(
      _scopeRef: AIScopeRef,
      _target: AISchedulingEvaluationTarget,
    ): Promise<AISchedulingJudgement | null> {
      return null;
    },

    subscribe(scopeRef: AIScopeRef, callback: (config: AIConfig) => void): () => void {
      if (!isParentosAIScopeRef(scopeRef)) {
        return () => {};
      }
      configSubscriptions.add(callback);
      return () => {
        configSubscriptions.delete(callback);
      };
    },
  };
}

function createAISnapshotSurface() {
  return {
    record(scopeRef: AIScopeRef, snapshot: AISnapshot): void {
      const resolvedScopeRef = isParentosAIScopeRef(scopeRef) ? { ...PARENTOS_AI_SCOPE_REF } : scopeRef;
      const normalizedSnapshot = {
        ...snapshot,
        scopeRef: resolvedScopeRef,
      };
      snapshotsByExecutionId.set(normalizedSnapshot.executionId, normalizedSnapshot);
      latestSnapshotByScopeKey.set(scopeKey(resolvedScopeRef), normalizedSnapshot);
    },

    get(executionId: string): AISnapshot | null {
      return snapshotsByExecutionId.get(executionId) || null;
    },

    getLatest(scopeRef: AIScopeRef): AISnapshot | null {
      return latestSnapshotByScopeKey.get(scopeKey(scopeRef)) || null;
    },
  };
}

let parentosAIConfigServiceSingleton: AIConfigSDKSurface | null = null;

export function getParentosAIConfigService(): AIConfigSDKSurface {
  if (!parentosAIConfigServiceSingleton) {
    parentosAIConfigServiceSingleton = {
      aiProfile: createAIProfileSurface(),
      aiConfig: createAIConfigSurface(),
      aiSnapshot: createAISnapshotSurface(),
    };
  }
  return parentosAIConfigServiceSingleton;
}
