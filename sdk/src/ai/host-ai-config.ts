import type { RuntimeRouteBinding } from '../runtime/index.js';
import {
  areAIScopeRefsEqual,
  encodeAIScopeRefKey,
  parseAIScopeRefKey,
  type AIScopeRef,
} from '../scope/ai-scope.js';
import { createEmptyAIConfig, type AIConfig, type AIProfile } from './ai-config.js';

export {
  encodeAIScopeRefKey as aiConfigScopeKeyFromRef,
  parseAIScopeRefKey as parseAIConfigScopeKey,
};

export type AIConfigSubscriptionListener = (config: AIConfig) => void;

export type AIConfigSubscriptionRegistry = {
  notify(config: AIConfig): void;
  subscribe(scopeKey: string, callback: AIConfigSubscriptionListener): () => void;
};

export type AIConfigStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type AIConfigParseOptions = {
  readonly scopeRef?: AIScopeRef;
  readonly validateRuntimeBindings?: boolean;
};

export type ScopedAIConfigStoreOptions = {
  readonly storage: () => AIConfigStorageLike | null | undefined;
  readonly indexKey?: string;
  readonly configKeyForScope?: (scopeKey: string) => string;
  readonly validateRuntimeBindings?: boolean;
  readonly memoryFallback?: boolean;
};

export type ScopedAIConfigStore = {
  readonly scopeKeyFromRef: (scopeRef: AIScopeRef) => string;
  readonly parseScopeKey: (scopeKey: string) => AIScopeRef | null;
  readonly has: (scopeRef: AIScopeRef) => boolean;
  readonly load: (scopeRef: AIScopeRef) => AIConfig;
  readonly save: (config: AIConfig) => AIConfig;
  readonly listScopeKeys: () => string[];
};

export function cloneAIConfig(config: AIConfig): AIConfig {
  return {
    scopeRef: { ...config.scopeRef },
    capabilities: {
      selectedBindings: { ...config.capabilities.selectedBindings },
      localProfileRefs: { ...config.capabilities.localProfileRefs },
      selectedParams: { ...config.capabilities.selectedParams },
    },
    profileOrigin: config.profileOrigin ? { ...config.profileOrigin } : null,
  };
}

export function validateRuntimeRouteBinding(value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} binding must be a non-null object`];
  }
  const binding = value as Partial<RuntimeRouteBinding>;
  if (binding.source !== 'local' && binding.source !== 'cloud') {
    errors.push(`${path}.source must be "local" or "cloud"`);
  }
  if (typeof binding.connectorId !== 'string') {
    errors.push(`${path}.connectorId must be a string`);
  } else if (binding.source === 'local' && binding.connectorId.trim()) {
    errors.push(`${path}.connectorId must be empty for local Runtime bindings`);
  } else if (binding.source === 'cloud' && !binding.connectorId.trim()) {
    errors.push(`${path}.connectorId is required for cloud Runtime bindings`);
  }
  if (typeof binding.model !== 'string' || !binding.model.trim()) {
    errors.push(`${path}.model is required`);
  }
  if (binding.modelLabel !== undefined && typeof binding.modelLabel !== 'string') {
    errors.push(`${path}.modelLabel must be a string when provided`);
  }
  if (binding.modelId !== undefined && typeof binding.modelId !== 'string') {
    errors.push(`${path}.modelId must be a string when provided`);
  }
  if (binding.provider !== undefined && typeof binding.provider !== 'string') {
    errors.push(`${path}.provider must be a string when provided`);
  }
  if (binding.localModelId !== undefined && typeof binding.localModelId !== 'string') {
    errors.push(`${path}.localModelId must be a string when provided`);
  }
  return errors;
}

export function validateAIProfileRuntimeBindings(profile: AIProfile): string[] {
  const errors: string[] = [];
  for (const [capabilityId, intent] of Object.entries(profile.capabilities || {})) {
    if (!intent || intent.binding === undefined || intent.binding === null) {
      continue;
    }
    errors.push(
      ...validateRuntimeRouteBinding(intent.binding, `capabilities.${capabilityId}.binding`),
    );
  }
  return errors;
}

export function validateAIConfigRuntimeBindings(config: AIConfig): string[] {
  const errors: string[] = [];
  for (const [capabilityId, binding] of Object.entries(
    config.capabilities?.selectedBindings || {},
  )) {
    if (binding === undefined || binding === null) {
      continue;
    }
    errors.push(
      ...validateRuntimeRouteBinding(
        binding,
        `capabilities.selectedBindings.${capabilityId}`,
      ),
    );
  }
  return errors;
}

export function normalizeAIConfig(raw: unknown, options: AIConfigParseOptions = {}): AIConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const scopeRef = record.scopeRef;
  if (!scopeRef || typeof scopeRef !== 'object' || Array.isArray(scopeRef)) {
    return null;
  }
  const sr = scopeRef as Record<string, unknown>;
  const kind = String(sr.kind || '').trim();
  const ownerId = String(sr.ownerId || '').trim();
  if (!kind || !ownerId) {
    return null;
  }
  const surfaceId = sr.surfaceId ? String(sr.surfaceId).trim() : '';
  const parsedScopeRef: AIScopeRef = surfaceId
    ? { kind: kind as AIScopeRef['kind'], ownerId, surfaceId }
    : { kind: kind as AIScopeRef['kind'], ownerId };
  const resolvedScopeRef = options.scopeRef ?? parsedScopeRef;
  if (options.scopeRef && !areAIScopeRefsEqual(parsedScopeRef, options.scopeRef)) {
    return null;
  }

  const caps = record.capabilities;
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
    return null;
  }
  const c = caps as Record<string, unknown>;
  const normalized: AIConfig = {
    scopeRef: resolvedScopeRef,
    capabilities: {
      selectedBindings: (c.selectedBindings && typeof c.selectedBindings === 'object'
        && !Array.isArray(c.selectedBindings)
        ? c.selectedBindings
        : {}) as AIConfig['capabilities']['selectedBindings'],
      localProfileRefs: (c.localProfileRefs && typeof c.localProfileRefs === 'object'
        && !Array.isArray(c.localProfileRefs)
        ? c.localProfileRefs
        : {}) as AIConfig['capabilities']['localProfileRefs'],
      selectedParams: (c.selectedParams && typeof c.selectedParams === 'object'
        && !Array.isArray(c.selectedParams)
        ? c.selectedParams
        : {}) as AIConfig['capabilities']['selectedParams'],
    },
    profileOrigin: record.profileOrigin as AIConfig['profileOrigin'] ?? null,
  };
  if (options.validateRuntimeBindings && validateAIConfigRuntimeBindings(normalized).length > 0) {
    return null;
  }
  return normalized;
}

export function parseAIConfig(raw: unknown, options: AIConfigParseOptions = {}): AIConfig {
  const config = normalizeAIConfig(raw, {
    ...options,
    validateRuntimeBindings: false,
  });
  if (!config) {
    throw new Error('AIConfig schema is invalid.');
  }
  if (options.validateRuntimeBindings) {
    const errors = validateAIConfigRuntimeBindings(config);
    if (errors.length > 0) {
      throw new Error(`AIConfig binding is invalid: ${errors.join('; ')}`);
    }
  }
  return config;
}

function parseStorageJson(raw: string | null): unknown {
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

function readStorageStringList(storage: AIConfigStorageLike, key: string): string[] {
  const parsed = parseStorageJson(storage.getItem(key));
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function writeStorageJson(storage: AIConfigStorageLike, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

function createDefaultConfigKeyForScope(scopeKey: string): string {
  return `nimi.ai-config.scope.${scopeKey}.v2`;
}

export function createScopedAIConfigStore(
  options: ScopedAIConfigStoreOptions,
): ScopedAIConfigStore {
  const indexKey = options.indexKey || 'nimi.ai-config.scope-index.v2';
  const configKeyForScope = options.configKeyForScope || createDefaultConfigKeyForScope;
  const memoryConfigs = new Map<string, AIConfig>();
  const memoryScopeKeys = new Set<string>();

  const getStorage = () => options.storage() || null;
  const shouldUseMemory = () => options.memoryFallback === true;
  const parseStoredConfig = (raw: string | null, scopeRef: AIScopeRef): AIConfig | null => {
    const parsed = parseStorageJson(raw);
    if (!parsed) {
      return null;
    }
    return parseAIConfig(parsed, {
      scopeRef,
      validateRuntimeBindings: options.validateRuntimeBindings,
    });
  };
  const loadScopeIndex = (storage: AIConfigStorageLike): string[] =>
    readStorageStringList(storage, indexKey);
  const persistScopeIndex = (storage: AIConfigStorageLike, scopeKeys: string[]) => {
    writeStorageJson(storage, indexKey, scopeKeys);
  };
  const ensureScopeInIndex = (storage: AIConfigStorageLike, scopeKey: string) => {
    const index = loadScopeIndex(storage);
    if (!index.includes(scopeKey)) {
      persistScopeIndex(storage, [...index, scopeKey]);
    }
  };

  return {
    scopeKeyFromRef(scopeRef: AIScopeRef): string {
      return encodeAIScopeRefKey(scopeRef);
    },
    parseScopeKey(scopeKey: string): AIScopeRef | null {
      return parseAIScopeRefKey(scopeKey);
    },
    has(scopeRef: AIScopeRef): boolean {
      const scopeKey = encodeAIScopeRefKey(scopeRef);
      const storage = getStorage();
      if (storage) {
        return storage.getItem(configKeyForScope(scopeKey)) !== null
          || loadScopeIndex(storage).includes(scopeKey);
      }
      return shouldUseMemory() && memoryScopeKeys.has(scopeKey);
    },
    load(scopeRef: AIScopeRef): AIConfig {
      const scopeKey = encodeAIScopeRefKey(scopeRef);
      const storage = getStorage();
      if (storage) {
        const parsed = parseStoredConfig(storage.getItem(configKeyForScope(scopeKey)), scopeRef);
        return parsed || createEmptyAIConfig(scopeRef);
      }
      if (shouldUseMemory()) {
        const cached = memoryConfigs.get(scopeKey);
        if (cached) {
          return cloneAIConfig(cached);
        }
        const empty = createEmptyAIConfig(scopeRef);
        memoryConfigs.set(scopeKey, empty);
        return cloneAIConfig(empty);
      }
      return createEmptyAIConfig(scopeRef);
    },
    save(config: AIConfig): AIConfig {
      const normalized = cloneAIConfig(config);
      const scopeKey = encodeAIScopeRefKey(normalized.scopeRef);
      if (options.validateRuntimeBindings) {
        const errors = validateAIConfigRuntimeBindings(normalized);
        if (errors.length > 0) {
          throw new Error(`AIConfig binding is invalid: ${errors.join('; ')}`);
        }
      }
      const storage = getStorage();
      if (storage) {
        writeStorageJson(storage, configKeyForScope(scopeKey), normalized);
        ensureScopeInIndex(storage, scopeKey);
      } else if (shouldUseMemory()) {
        memoryConfigs.set(scopeKey, normalized);
        memoryScopeKeys.add(scopeKey);
      }
      return cloneAIConfig(normalized);
    },
    listScopeKeys(): string[] {
      const storage = getStorage();
      if (storage) {
        return loadScopeIndex(storage);
      }
      return shouldUseMemory() ? [...memoryScopeKeys] : [];
    },
  };
}

export function createAIConfigSubscriptionRegistry(input: {
  readonly resolveScopeKey?: (config: AIConfig) => string;
  readonly cloneOnNotify?: boolean;
} = {}): AIConfigSubscriptionRegistry {
  const resolveScopeKey = input.resolveScopeKey ?? ((config: AIConfig) =>
    encodeAIScopeRefKey(config.scopeRef));
  const cloneOnNotify = input.cloneOnNotify === true;
  let subscriptionIdCounter = 0;
  const subscriptions = new Map<number, {
    scopeKey: string;
    callback: AIConfigSubscriptionListener;
  }>();

  return {
    notify(config: AIConfig): void {
      const key = resolveScopeKey(config);
      for (const sub of subscriptions.values()) {
        if (sub.scopeKey === key) {
          try {
            sub.callback(cloneOnNotify ? cloneAIConfig(config) : config);
          } catch {
            // Subscriber errors must not break the host AIConfig surface.
          }
        }
      }
    },
    subscribe(scopeKey: string, callback: AIConfigSubscriptionListener): () => void {
      const id = ++subscriptionIdCounter;
      subscriptions.set(id, { scopeKey, callback });
      return () => {
        subscriptions.delete(id);
      };
    },
  };
}
