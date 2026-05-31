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
  createHostMemoryEmbeddingRuntimeSurface,
  createRuntimeProtectedScopeHelper,
  type MemoryEmbeddingRuntimeSurface,
  createEmptyMemoryEmbeddingConfig,
  type MemoryEmbeddingConfig,
  type MemoryEmbeddingConfigSurface,
  type RuntimeCallOptions,
} from '@nimiplatform/sdk/runtime';
import {
  type AIScopeRef,
} from '@nimiplatform/sdk/scope';
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

async function withRuntimeMemoryScopes<T>(
  scopes: readonly string[],
  operation: (options: RuntimeCallOptions) => Promise<T>,
): Promise<T> {
  return getProtectedAccess().withScopes(scopes, operation);
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
  return createHostMemoryEmbeddingRuntimeSurface({
    runtime: () => getPlatformClient().runtime,
    getConfig: (scopeRef) => getConfigForScope(scopeRef),
    getSubjectUserId: () => currentSubjectUserId(),
    withScopes: (scopes, operation) => withRuntimeMemoryScopes(scopes, operation),
  });
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
