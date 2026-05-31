import {
  aiConfigScopeKeyFromRef,
  createAppAIScopeRef,
  createHostAIProfileSurface,
  createAIConfigSubscriptionRegistry,
  createScopedAIConfigStore,
  parseAIProfile,
  validateAIConfigRuntimeBindings,
  validateAIProfileRuntimeBindings,
  type AIConfig,
  type AIConfigStorageLike,
  type AIProfile,
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

const aiConfigStore = createScopedAIConfigStore({
  storage: () => getStorage() as AIConfigStorageLike | null,
  configKeyForScope: () => TESTER_AI_CONFIG_STORAGE_KEY,
  validateRuntimeBindings: true,
  memoryFallback: true,
});

function defaultProfileStore(): TesterAIProfileLibraryStore {
  return {
    schemaVersion: TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION,
    profiles: [],
  };
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
  try {
    return aiConfigStore.load(scopeRef);
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

export function saveTesterAIConfig(
  next: AIConfig,
  scopeRef: AIScopeRef = createTesterAppLabAIScopeRef(),
): AIConfig {
  const normalized = { ...next, scopeRef };
  const bindingErrors = validateAIConfigRuntimeBindings(normalized);
  if (bindingErrors.length > 0) {
    throw new Error(`AIConfig binding validation failed: ${bindingErrors.join('; ')}`);
  }
  const saved = aiConfigStore.save(normalized);
  configSubscriptions.notify(saved);
  return saved;
}

export function createTesterAIConfigService(): SharedAIConfigService {
  const aiProfile = createHostAIProfileSurface({
    listProfiles: () => listTesterAIProfiles(),
    loadConfig: (scopeRef) => loadTesterAIConfig(scopeRef),
    saveConfig: (scopeRef, next) => saveTesterAIConfig(next, scopeRef),
    missingProfileMessage: (profileId) =>
      `AIProfile ${profileId} is not in the App Lab profile library.`,
  });
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
        return aiProfile.list();
      },
      async previewApply(scopeRef: AIScopeRef, profileId: string) {
        return aiProfile.previewApply(scopeRef, profileId);
      },
      async apply(scopeRef: AIScopeRef, profileId: string) {
        return aiProfile.apply(scopeRef, profileId);
      },
    },
  };
}
