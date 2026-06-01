// App-owned AIConfig store for Storybook. Provider/model selection is Runtime/
// platform configuration and provenance — NOT Storybook truth. Storybook holds
// only the user's chosen route binding for each capability and validates it
// fail-closed. There is no hardcoded provider/model list anywhere in this module.

import type { AIConfig, AIScopeRef } from '@nimiplatform/sdk/ai';
// RuntimeRouteBinding is owned by the runtime route surface (SDK refactor moved it
// off the /ai subpath). Type-only import: erased at compile time, no runtime graph.
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/runtime';
import { createAppAIScopeRef, createEmptyAIConfig } from '@nimiplatform/sdk/ai';
import { appId } from '../../shell/auth/runtime-platform.js';

export const STORYBOOK_STUDIO_AI_SURFACE_ID = 'studio';
export const STORYBOOK_AI_CONFIG_STORAGE_KEY = 'nimiapp-storybook:studio-ai-config:v1';

const memoryConfigs = new Map<string, AIConfig>();

export function createStorybookAIScopeRef(): AIScopeRef {
  return createAppAIScopeRef(appId, STORYBOOK_STUDIO_AI_SURFACE_ID);
}

function scopeKey(scopeRef: AIScopeRef): string {
  return `${scopeRef.kind}:${scopeRef.ownerId}:${scopeRef.surfaceId || ''}`;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function cloneConfig(config: AIConfig): AIConfig {
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
  return errors;
}

function validateConfigBindings(config: AIConfig): string[] {
  const errors: string[] = [];
  for (const [capabilityId, binding] of Object.entries(config.capabilities?.selectedBindings || {})) {
    if (binding === undefined || binding === null) continue;
    errors.push(...validateRuntimeRouteBinding(binding, `capabilities.selectedBindings.${capabilityId}`));
  }
  return errors;
}

function parseStoredConfig(raw: string, scopeRef: AIScopeRef): AIConfig {
  const parsed = JSON.parse(raw) as AIConfig;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Stored AIConfig is not an object.');
  }
  const normalized: AIConfig = {
    scopeRef,
    capabilities: {
      selectedBindings: { ...(parsed.capabilities?.selectedBindings || {}) },
      localProfileRefs: { ...(parsed.capabilities?.localProfileRefs || {}) },
      selectedParams: { ...(parsed.capabilities?.selectedParams || {}) },
    },
    profileOrigin: parsed.profileOrigin ? { ...parsed.profileOrigin } : null,
  };
  const errors = validateConfigBindings(normalized);
  if (errors.length > 0) {
    throw new Error(`Stored AIConfig binding is invalid: ${errors.join('; ')}`);
  }
  return normalized;
}

export function loadStorybookAIConfig(scopeRef: AIScopeRef = createStorybookAIScopeRef()): AIConfig {
  const key = scopeKey(scopeRef);
  const storage = getStorage();
  if (!storage) {
    const cached = memoryConfigs.get(key);
    if (cached) return cloneConfig(cached);
    const empty = createEmptyAIConfig(scopeRef);
    memoryConfigs.set(key, empty);
    return cloneConfig(empty);
  }
  const raw = storage.getItem(STORYBOOK_AI_CONFIG_STORAGE_KEY);
  if (!raw) return createEmptyAIConfig(scopeRef);
  return parseStoredConfig(raw, scopeRef);
}

export function saveStorybookAIConfig(next: AIConfig, scopeRef: AIScopeRef = createStorybookAIScopeRef()): AIConfig {
  const normalized: AIConfig = { ...cloneConfig(next), scopeRef };
  const errors = validateConfigBindings(normalized);
  if (errors.length > 0) {
    throw new Error(`AIConfig binding validation failed: ${errors.join('; ')}`);
  }
  const storage = getStorage();
  if (storage) {
    storage.setItem(STORYBOOK_AI_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  } else {
    memoryConfigs.set(scopeKey(scopeRef), normalized);
  }
  return cloneConfig(normalized);
}
