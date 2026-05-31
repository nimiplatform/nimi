import type { RuntimeRouteBinding } from '../runtime/index.js';
import {
  areAIScopeRefsEqual,
  encodeAIScopeRefKey,
  parseAIScopeRefKey,
  type AIScopeRef,
} from '../scope/ai-scope.js';
import type { AIConfig, AIProfile } from './ai-config.js';

export {
  encodeAIScopeRefKey as aiConfigScopeKeyFromRef,
  parseAIScopeRefKey as parseAIConfigScopeKey,
};

export type AIConfigSubscriptionListener = (config: AIConfig) => void;

export type AIConfigSubscriptionRegistry = {
  notify(config: AIConfig): void;
  subscribe(scopeKey: string, callback: AIConfigSubscriptionListener): () => void;
};

export type AIConfigParseOptions = {
  readonly scopeRef?: AIScopeRef;
  readonly validateRuntimeBindings?: boolean;
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
