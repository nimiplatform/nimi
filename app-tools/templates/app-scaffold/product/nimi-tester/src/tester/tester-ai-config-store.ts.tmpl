import type {
  AIConfig,
  AIProfile,
  AIProfileApplyResult,
  AIProfilePreviewResult,
  AIScopeRef,
  RuntimeRouteBinding,
} from '@nimiplatform/sdk/ai';
import {
  applyAIProfileToConfig,
  computeAIConfigDiff,
  computeAIConfigVersion,
  createAppAIScopeRef,
  createEmptyAIConfig,
  validateAIProfile,
} from '@nimiplatform/sdk/ai';
import type {
  SharedAIConfigService,
  SharedAIConfigSubscribeListener,
  SharedAIConfigUnsubscribe,
} from '@nimiplatform/kit/features/model-config';
import { appId } from '../shell/auth/runtime-platform.js';

export const TESTER_APP_LAB_AI_SURFACE_ID = 'app-lab';
export const TESTER_AI_CONFIG_STORAGE_KEY = 'nimiapp-tester:app-lab-ai-config:v1';
export const TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY = 'nimiapp-tester:app-lab-ai-profiles:v1';
export const TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION = 1;

export type TesterAIProfileImportResult =
  | {
      ok: true;
      profile: AIProfile;
      profileCount: number;
      message: string;
    }
  | {
      ok: false;
      errors: string[];
      message: string;
    };

type TesterAIProfileLibraryStore = {
  schemaVersion: typeof TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION;
  profiles: AIProfile[];
};

const memoryConfigs = new Map<string, AIConfig>();
const listeners = new Map<string, Set<SharedAIConfigSubscribeListener>>();
let memoryProfiles: AIProfile[] = [];

export function createTesterAppLabAIScopeRef(): AIScopeRef {
  return createAppAIScopeRef(appId, TESTER_APP_LAB_AI_SURFACE_ID);
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

function validateRuntimeRouteBinding(value: unknown, path: string): string[] {
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

function validateAIProfileRuntimeBindings(profile: AIProfile): string[] {
  const errors: string[] = [];
  for (const [capabilityId, intent] of Object.entries(profile.capabilities || {})) {
    if (!intent || intent.binding === undefined || intent.binding === null) continue;
    errors.push(...validateRuntimeRouteBinding(intent.binding, `capabilities.${capabilityId}.binding`));
  }
  return errors;
}

function validateAIConfigRuntimeBindings(config: AIConfig): string[] {
  const errors: string[] = [];
  for (const [capabilityId, binding] of Object.entries(config.capabilities?.selectedBindings || {})) {
    if (binding === undefined || binding === null) continue;
    errors.push(...validateRuntimeRouteBinding(binding, `capabilities.selectedBindings.${capabilityId}`));
  }
  return errors;
}

function defaultProfileStore(): TesterAIProfileLibraryStore {
  return {
    schemaVersion: TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION,
    profiles: [],
  };
}

function parseStoredConfig(raw: string, scopeRef: AIScopeRef): AIConfig {
  const parsed = JSON.parse(raw) as AIConfig;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Stored AIConfig is not an object.');
  }
  if (scopeKey(parsed.scopeRef) !== scopeKey(scopeRef)) {
    throw new Error('Stored AIConfig scope does not match App Lab.');
  }
  const normalized = {
    scopeRef,
    capabilities: {
      selectedBindings: { ...(parsed.capabilities?.selectedBindings || {}) },
      localProfileRefs: { ...(parsed.capabilities?.localProfileRefs || {}) },
      selectedParams: { ...(parsed.capabilities?.selectedParams || {}) },
    },
    profileOrigin: parsed.profileOrigin ? { ...parsed.profileOrigin } : null,
  };
  const bindingErrors = validateAIConfigRuntimeBindings(normalized);
  if (bindingErrors.length > 0) {
    throw new Error(`Stored AIConfig binding is invalid: ${bindingErrors.join('; ')}`);
  }
  return normalized;
}

function parseStoredProfileLibrary(raw: string): TesterAIProfileLibraryStore {
  const parsed = JSON.parse(raw) as Partial<TesterAIProfileLibraryStore>;
  if (
    parsed.schemaVersion !== TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION
    || !Array.isArray(parsed.profiles)
  ) {
    throw new Error('Stored AIProfile library schema is invalid.');
  }
  const profiles: AIProfile[] = [];
  for (const profile of parsed.profiles) {
    const validation = validateAIProfile(profile);
    if (!validation.valid) {
      throw new Error(`Stored AIProfile is invalid: ${validation.errors.join('; ')}`);
    }
    const bindingErrors = validateAIProfileRuntimeBindings(profile as AIProfile);
    if (bindingErrors.length > 0) {
      throw new Error(`Stored AIProfile binding is invalid: ${bindingErrors.join('; ')}`);
    }
    profiles.push(profile as AIProfile);
  }
  return {
    schemaVersion: TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION,
    profiles,
  };
}

function loadProfileLibraryStore(storage: Storage | null = getStorage()): TesterAIProfileLibraryStore {
  if (!storage) {
    return {
      schemaVersion: TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION,
      profiles: [...memoryProfiles],
    };
  }
  const raw = storage.getItem(TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY);
  if (!raw) return defaultProfileStore();
  return parseStoredProfileLibrary(raw);
}

function saveProfileLibraryStore(store: TesterAIProfileLibraryStore, storage: Storage | null = getStorage()): void {
  if (!storage) {
    memoryProfiles = [...store.profiles];
    return;
  }
  storage.setItem(TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY, JSON.stringify(store));
}

export function listTesterAIProfiles(): AIProfile[] {
  return [...loadProfileLibraryStore().profiles];
}

export function importTesterAIProfileJson(rawJson: string): TesterAIProfileImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error || 'Invalid JSON.')],
      message: 'AIProfile JSON could not be parsed.',
    };
  }

  const validation = validateAIProfile(parsed);
  if (!validation.valid) {
    return {
      ok: false,
      errors: validation.errors,
      message: 'AIProfile validation failed.',
    };
  }

  const profile = parsed as AIProfile;
  const bindingErrors = validateAIProfileRuntimeBindings(profile);
  if (bindingErrors.length > 0) {
    return {
      ok: false,
      errors: bindingErrors,
      message: 'AIProfile binding validation failed.',
    };
  }
  const store = loadProfileLibraryStore();
  const profiles = [
    profile,
    ...store.profiles.filter((existing) => existing.profileId !== profile.profileId),
  ];
  const nextStore: TesterAIProfileLibraryStore = {
    schemaVersion: TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION,
    profiles,
  };
  saveProfileLibraryStore(nextStore);
  return {
    ok: true,
    profile,
    profileCount: profiles.length,
    message: `Imported AIProfile ${profile.title || profile.profileId}.`,
  };
}

export function loadTesterAIConfig(scopeRef: AIScopeRef = createTesterAppLabAIScopeRef()): AIConfig {
  const key = scopeKey(scopeRef);
  const storage = getStorage();
  if (!storage) {
    const cached = memoryConfigs.get(key);
    if (cached) return cloneConfig(cached);
    const empty = createEmptyAIConfig(scopeRef);
    memoryConfigs.set(key, empty);
    return cloneConfig(empty);
  }

  const raw = storage.getItem(TESTER_AI_CONFIG_STORAGE_KEY);
  if (!raw) return createEmptyAIConfig(scopeRef);
  return parseStoredConfig(raw, scopeRef);
}

function notifyConfig(scopeRef: AIScopeRef, next: AIConfig): void {
  const set = listeners.get(scopeKey(scopeRef));
  if (!set) return;
  for (const listener of set) {
    listener(cloneConfig(next));
  }
}

export function saveTesterAIConfig(
  next: AIConfig,
  scopeRef: AIScopeRef = createTesterAppLabAIScopeRef(),
): AIConfig {
  const normalized = {
    ...cloneConfig(next),
    scopeRef,
  };
  const bindingErrors = validateAIConfigRuntimeBindings(normalized);
  if (bindingErrors.length > 0) {
    throw new Error(`AIConfig binding validation failed: ${bindingErrors.join('; ')}`);
  }
  const key = scopeKey(scopeRef);
  const storage = getStorage();
  if (storage) {
    storage.setItem(TESTER_AI_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  } else {
    memoryConfigs.set(key, normalized);
  }
  notifyConfig(scopeRef, normalized);
  return cloneConfig(normalized);
}

function profileById(profileId: string): AIProfile | null {
  const normalized = String(profileId || '').trim();
  if (!normalized) return null;
  return listTesterAIProfiles().find((profile) => profile.profileId === normalized) || null;
}

function requireProfile(profileId: string): AIProfile {
  const profile = profileById(profileId);
  if (!profile) {
    throw new Error(`AIProfile ${profileId} is not in the App Lab profile library.`);
  }
  const validation = validateAIProfile(profile);
  if (!validation.valid) {
    throw new Error(`AIProfile ${profileId} is invalid: ${validation.errors.join('; ')}`);
  }
  return profile;
}

export function createTesterAIConfigService(): SharedAIConfigService {
  return {
    aiConfig: {
      get(scopeRef: AIScopeRef) {
        return loadTesterAIConfig(scopeRef);
      },
      update(scopeRef: AIScopeRef, next: AIConfig) {
        saveTesterAIConfig(next, scopeRef);
      },
      subscribe(scopeRef: AIScopeRef, listener: SharedAIConfigSubscribeListener): SharedAIConfigUnsubscribe {
        const key = scopeKey(scopeRef);
        const set = listeners.get(key) ?? new Set<SharedAIConfigSubscribeListener>();
        set.add(listener);
        listeners.set(key, set);
        return () => {
          set.delete(listener);
          if (set.size === 0) listeners.delete(key);
        };
      },
    },
    aiProfile: {
      async list() {
        return listTesterAIProfiles();
      },
      async previewApply(scopeRef: AIScopeRef, profileId: string): Promise<AIProfilePreviewResult> {
        const profile = requireProfile(profileId);
        const before = loadTesterAIConfig(scopeRef);
        const after = applyAIProfileToConfig(before, profile);
        return {
          before,
          after,
          diff: computeAIConfigDiff(before, after),
          baseVersion: computeAIConfigVersion(before),
          probeWarnings: [],
        };
      },
      async apply(scopeRef: AIScopeRef, profileId: string): Promise<AIProfileApplyResult> {
        const profile = requireProfile(profileId);
        const current = loadTesterAIConfig(scopeRef);
        const next = applyAIProfileToConfig(current, profile);
        const committed = saveTesterAIConfig(next, scopeRef);
        return {
          success: true,
          config: committed,
          failureReason: null,
          probeWarnings: [],
        };
      },
    },
  };
}
