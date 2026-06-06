// App-owned NimiAIConfig store for Storybook. Provider/model selection is Runtime/
// platform configuration and provenance — NOT Storybook truth. Storybook holds
// only the user's chosen route binding for each capability and validates it
// fail-closed. There is no hardcoded provider/model list anywhere in this module.

import type { NimiAIConfig, NimiAIConfigTargetRef, NimiAIScopeRef } from '@nimiplatform/sdk/ai';
import { createNimiAppAIScopeRef, createEmptyNimiAIConfig } from '@nimiplatform/sdk/ai';
import { appId } from '../../shell/auth/runtime-platform.js';

export const STORYBOOK_STUDIO_AI_SURFACE_ID = 'studio';
export const STORYBOOK_AI_CONFIG_STORAGE_KEY = 'nimiapp-storybook:studio-ai-config:v1';

const memoryConfigs = new Map<string, NimiAIConfig>();

export function createStorybookAIScopeRef(): NimiAIScopeRef {
  return createNimiAppAIScopeRef(appId, STORYBOOK_STUDIO_AI_SURFACE_ID);
}

function scopeKey(scopeRef: NimiAIScopeRef): string {
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

function cloneConfig(config: NimiAIConfig): NimiAIConfig {
  return {
    scopeRef: { ...config.scopeRef },
    capabilities: {
      targetRefs: { ...config.capabilities.targetRefs },
      selectedParams: { ...config.capabilities.selectedParams },
    },
    profileOrigin: config.profileOrigin ? { ...config.profileOrigin } : null,
  };
}

export function validateRuntimeTargetRef(value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} targetRef must be a non-null object`];
  }
  const targetRef = value as Partial<NimiAIConfigTargetRef>;
  if (targetRef.kind === 'cloud-connector') {
    if (typeof targetRef.connectorId !== 'string' || !targetRef.connectorId.trim()) {
      errors.push(`${path}.connectorId is required for cloud connector targets`);
    }
    if (typeof targetRef.providerModelId !== 'string' || !targetRef.providerModelId.trim()) {
      errors.push(`${path}.providerModelId is required for cloud connector targets`);
    }
    return errors;
  }
  if (targetRef.kind === 'local-runtime') {
    if (!String(targetRef.targetId || targetRef.profileId || targetRef.readinessRef || '').trim()) {
      errors.push(`${path} local runtime target requires targetId, profileId, or readinessRef`);
    }
    return errors;
  }
  if (targetRef.kind === 'profile-slice') {
    errors.push(`${path} profile-slice target is not a live Runtime dispatch binding`);
    return errors;
  }
  errors.push(`${path}.kind must be cloud-connector or local-runtime`);
  return errors;
}

function validateConfigBindings(config: NimiAIConfig): string[] {
  const errors: string[] = [];
  for (const [capabilityId, targetRef] of Object.entries(config.capabilities?.targetRefs || {})) {
    if (targetRef === undefined || targetRef === null) continue;
    errors.push(...validateRuntimeTargetRef(targetRef, `capabilities.targetRefs.${capabilityId}`));
  }
  return errors;
}

function parseStoredConfig(raw: string, scopeRef: NimiAIScopeRef): NimiAIConfig {
  const parsed = JSON.parse(raw) as NimiAIConfig;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Stored NimiAIConfig is not an object.');
  }
  const normalized: NimiAIConfig = {
    scopeRef,
    capabilities: {
      targetRefs: { ...(parsed.capabilities?.targetRefs || {}) },
      selectedParams: { ...(parsed.capabilities?.selectedParams || {}) },
    },
    profileOrigin: parsed.profileOrigin ? { ...parsed.profileOrigin } : null,
  };
  const errors = validateConfigBindings(normalized);
  if (errors.length > 0) {
    throw new Error(`Stored NimiAIConfig binding is invalid: ${errors.join('; ')}`);
  }
  return normalized;
}

export function loadStorybookAIConfig(scopeRef: NimiAIScopeRef = createStorybookAIScopeRef()): NimiAIConfig {
  const key = scopeKey(scopeRef);
  const storage = getStorage();
  if (!storage) {
    const cached = memoryConfigs.get(key);
    if (cached) return cloneConfig(cached);
    const empty = createEmptyNimiAIConfig(scopeRef);
    memoryConfigs.set(key, empty);
    return cloneConfig(empty);
  }
  const raw = storage.getItem(STORYBOOK_AI_CONFIG_STORAGE_KEY);
  if (!raw) return createEmptyNimiAIConfig(scopeRef);
  return parseStoredConfig(raw, scopeRef);
}

export function saveStorybookAIConfig(next: NimiAIConfig, scopeRef: NimiAIScopeRef = createStorybookAIScopeRef()): NimiAIConfig {
  const normalized: NimiAIConfig = { ...cloneConfig(next), scopeRef };
  const errors = validateConfigBindings(normalized);
  if (errors.length > 0) {
    throw new Error(`NimiAIConfig binding validation failed: ${errors.join('; ')}`);
  }
  const storage = getStorage();
  if (storage) {
    storage.setItem(STORYBOOK_AI_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  } else {
    memoryConfigs.set(scopeKey(scopeRef), normalized);
  }
  return cloneConfig(normalized);
}
