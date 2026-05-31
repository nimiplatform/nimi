import {
  applyAIProfileToConfig,
  aiConfigScopeKeyFromRef,
  cloneAIConfig,
  computeAIConfigDiff,
  computeAIConfigVersion,
  createAppAIScopeRef,
  createAIConfigSubscriptionRegistry,
  createEmptyAIConfig,
  parseAIConfig,
  parseAIProfile,
  validateAIConfigRuntimeBindings,
  validateAIProfileRuntimeBindings,
  type AIConfig,
  type AIProfile,
  type AIProfileApplyResult,
  type AIProfilePreviewResult,
  type AIScopeRef,
} from '@nimiplatform/sdk/ai';
import type {
  SharedAIConfigService,
  SharedAIConfigSubscribeListener,
  SharedAIConfigUnsubscribe,
} from '@nimiplatform/kit/features/model-config/headless';
import { resolveBrowserStorage } from '@nimiplatform/kit/core/storage-json';
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
const configSubscriptions = createAIConfigSubscriptionRegistry({
  resolveScopeKey: (config) => scopeKey(config.scopeRef),
  cloneOnNotify: true,
});
let memoryProfiles: AIProfile[] = [];

export function createTesterAppLabAIScopeRef(): AIScopeRef {
  return createAppAIScopeRef(appId, TESTER_APP_LAB_AI_SURFACE_ID);
}

function scopeKey(scopeRef: AIScopeRef): string {
  return aiConfigScopeKeyFromRef(scopeRef);
}

function getStorage(): Storage | null {
  return resolveBrowserStorage('local');
}

function defaultProfileStore(): TesterAIProfileLibraryStore {
  return {
    schemaVersion: TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION,
    profiles: [],
  };
}

function parseStoredConfig(raw: string, scopeRef: AIScopeRef): AIConfig {
  try {
    return parseAIConfig(JSON.parse(raw), {
      scopeRef,
      validateRuntimeBindings: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('AIConfig binding is invalid: ')) {
      throw new Error(`Stored ${message}`);
    }
    if (message === 'AIConfig schema is invalid.') {
      throw new Error('Stored AIConfig scope does not match App Lab.');
    }
    throw error;
  }
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
    let parsedProfile: AIProfile;
    try {
      parsedProfile = parseAIProfile(profile);
    } catch (error) {
      throw new Error(`Stored AIProfile is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    const bindingErrors = validateAIProfileRuntimeBindings(parsedProfile);
    if (bindingErrors.length > 0) {
      throw new Error(`Stored AIProfile binding is invalid: ${bindingErrors.join('; ')}`);
    }
    profiles.push(parsedProfile);
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

  let profile: AIProfile;
  try {
    profile = parseAIProfile(parsed);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      message: 'AIProfile validation failed.',
    };
  }

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
    if (cached) return cloneAIConfig(cached);
    const empty = createEmptyAIConfig(scopeRef);
    memoryConfigs.set(key, empty);
    return cloneAIConfig(empty);
  }

  const raw = storage.getItem(TESTER_AI_CONFIG_STORAGE_KEY);
  if (!raw) return createEmptyAIConfig(scopeRef);
  return parseStoredConfig(raw, scopeRef);
}

export function saveTesterAIConfig(
  next: AIConfig,
  scopeRef: AIScopeRef = createTesterAppLabAIScopeRef(),
): AIConfig {
  const normalized = {
    ...cloneAIConfig(next),
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
  configSubscriptions.notify(normalized);
  return cloneAIConfig(normalized);
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
  try {
    return parseAIProfile(profile);
  } catch (error) {
    throw new Error(`AIProfile ${profileId} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
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
        return configSubscriptions.subscribe(key, listener);
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
