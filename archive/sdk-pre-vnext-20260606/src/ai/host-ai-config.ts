import {
  areAIScopeRefsEqual,
  encodeAIScopeRefKey,
  parseAIScopeRefKey,
  type AIScopeRef,
} from '../scope/ai-scope.js';
import {
  createEmptyAIConfig,
  validateAIConfigCompactRefs,
  validateAIProfileCompactRefs,
  type AIConfig,
  type AIProfile,
} from './ai-config.js';

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
  readonly validateCompactRefs?: boolean;
};

export type ScopedAIConfigStoreOptions = {
  readonly storage: () => AIConfigStorageLike | null | undefined;
  readonly indexKey?: string;
  readonly configKeyForScope?: (scopeKey: string) => string;
  readonly validateCompactRefs?: boolean;
  readonly enableEphemeralStore?: boolean;
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
      targetRefs: { ...config.capabilities.targetRefs },
      selectedParams: { ...config.capabilities.selectedParams },
    },
    profileOrigin: config.profileOrigin ? { ...config.profileOrigin } : null,
  };
}

export function validateAIProfileCompactRefsForHost(profile: AIProfile): string[] {
  return validateAIProfileCompactRefs(profile);
}

export function validateAIConfigCompactRefsForHost(config: AIConfig): string[] {
  return validateAIConfigCompactRefs(config);
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
  if ('selectedBindings' in c || 'localProfileRefs' in c) {
    return null;
  }
  const normalized: AIConfig = {
    scopeRef: resolvedScopeRef,
    capabilities: {
      targetRefs: (c.targetRefs && typeof c.targetRefs === 'object'
        && !Array.isArray(c.targetRefs)
        ? c.targetRefs
        : {}) as AIConfig['capabilities']['targetRefs'],
      selectedParams: (c.selectedParams && typeof c.selectedParams === 'object'
        && !Array.isArray(c.selectedParams)
        ? c.selectedParams
        : {}) as AIConfig['capabilities']['selectedParams'],
    },
    profileOrigin: record.profileOrigin as AIConfig['profileOrigin'] ?? null,
  };
  if (options.validateCompactRefs && validateAIConfigCompactRefsForHost(normalized).length > 0) {
    return null;
  }
  return normalized;
}

export function parseAIConfig(raw: unknown, options: AIConfigParseOptions = {}): AIConfig {
  const config = normalizeAIConfig(raw, {
    ...options,
    validateCompactRefs: false,
  });
  if (!config) {
    throw new Error('AIConfig schema is invalid.');
  }
  if (options.validateCompactRefs) {
    const errors = validateAIConfigCompactRefsForHost(config);
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
  const ephemeralConfigs = new Map<string, AIConfig>();
  const ephemeralScopeKeys = new Set<string>();

  const getStorage = () => options.storage() || null;
  const shouldUseEphemeralStore = () => options.enableEphemeralStore === true;
  const requireStorageOrEphemeralStore = (
    operation: 'has' | 'load' | 'save' | 'listScopeKeys',
  ): AIConfigStorageLike | null => {
    const storage = getStorage();
    if (storage) {
      return storage;
    }
    if (shouldUseEphemeralStore()) {
      return null;
    }
    throw new Error(
      `AIConfig store ${operation} requires host storage or explicit enableEphemeralStore=true`,
    );
  };
  const parseStoredConfig = (raw: string | null, scopeRef: AIScopeRef): AIConfig | null => {
    const parsed = parseStorageJson(raw);
    if (!parsed) {
      return null;
    }
    return parseAIConfig(parsed, {
      scopeRef,
      validateCompactRefs: options.validateCompactRefs,
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
      const storage = requireStorageOrEphemeralStore('has');
      if (storage) {
        return storage.getItem(configKeyForScope(scopeKey)) !== null
          || loadScopeIndex(storage).includes(scopeKey);
      }
      return ephemeralScopeKeys.has(scopeKey);
    },
    load(scopeRef: AIScopeRef): AIConfig {
      const scopeKey = encodeAIScopeRefKey(scopeRef);
      const storage = requireStorageOrEphemeralStore('load');
      if (storage) {
        const parsed = parseStoredConfig(storage.getItem(configKeyForScope(scopeKey)), scopeRef);
        return parsed || createEmptyAIConfig(scopeRef);
      }
      const cached = ephemeralConfigs.get(scopeKey);
      if (cached) {
        return cloneAIConfig(cached);
      }
      const empty = createEmptyAIConfig(scopeRef);
      ephemeralConfigs.set(scopeKey, empty);
      return cloneAIConfig(empty);
    },
    save(config: AIConfig): AIConfig {
      const normalized = cloneAIConfig(config);
      const scopeKey = encodeAIScopeRefKey(normalized.scopeRef);
      if (options.validateCompactRefs) {
        const errors = validateAIConfigCompactRefsForHost(normalized);
        if (errors.length > 0) {
          throw new Error(`AIConfig binding is invalid: ${errors.join('; ')}`);
        }
      }
      const storage = requireStorageOrEphemeralStore('save');
      if (storage) {
        writeStorageJson(storage, configKeyForScope(scopeKey), normalized);
        ensureScopeInIndex(storage, scopeKey);
      } else {
        ephemeralConfigs.set(scopeKey, normalized);
        ephemeralScopeKeys.add(scopeKey);
      }
      return cloneAIConfig(normalized);
    },
    listScopeKeys(): string[] {
      const storage = requireStorageOrEphemeralStore('listScopeKeys');
      if (storage) {
        return loadScopeIndex(storage);
      }
      return [...ephemeralScopeKeys];
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
