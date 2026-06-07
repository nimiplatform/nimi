import {
  createNimiAIConfigStore,
  createNimiAIConfigSubscriptionRegistry,
  createNimiAIHostSurface,
  createNimiAISnapshotStore,
  createNimiAppAIScopeRef,
  parseNimiAIProfile,
  validateNimiAIConfig,
  validateNimiAIProfile,
  versionNimiAIConfig,
  type NimiAIConfig,
  type NimiAIHostStorage,
  type NimiAIProfile,
  type NimiAIScopeRef,
  type NimiAISnapshot,
} from '@nimiplatform/sdk/ai';
import type {
  SharedAIConfigService,
  SharedAIConfigSubscribeListener,
  SharedAIConfigUnsubscribe,
} from '@nimiplatform/kit/features/model-config/headless';
import { resolveBrowserStorage } from '@nimiplatform/kit/core/storage-json';
import { appId } from '../shell/auth/app-identity.js';

export const TESTER_APP_LAB_AI_SURFACE_ID = 'app-lab';
export const TESTER_AI_CONFIG_STORAGE_KEY = 'nimiapp-tester:app-lab-ai-config:v1';
export const TESTER_AI_SNAPSHOT_INDEX_KEY = 'nimiapp-tester:app-lab-ai-snapshot-index:v1';
export const TESTER_AI_SNAPSHOT_STORAGE_PREFIX = 'nimiapp-tester:app-lab-ai-snapshot:';
export const TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY = 'nimiapp-tester:app-lab-ai-profiles:v1';
export const TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION = 1;

export type TesterAIProfileImportResult =
  | {
      ok: true;
      profile: NimiAIProfile;
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
  profiles: NimiAIProfile[];
};

const configSubscriptions = createNimiAIConfigSubscriptionRegistry();
let ephemeralProfiles: NimiAIProfile[] = [];

export function createTesterAppLabAIScopeRef(): NimiAIScopeRef {
  return createNimiAppAIScopeRef(appId, TESTER_APP_LAB_AI_SURFACE_ID);
}

function getStorage(): Storage | null {
  return resolveBrowserStorage('local');
}

function isTesterEphemeralStoreHarness(): boolean {
  return typeof window === 'undefined';
}

const aiConfigStore = createNimiAIConfigStore({
  storage: () => getStorage() as NimiAIHostStorage | null,
  configKeyForScope: () => TESTER_AI_CONFIG_STORAGE_KEY,
  enableEphemeralStore: isTesterEphemeralStoreHarness(),
});

const aiSnapshotStore = createNimiAISnapshotStore({
  storage: () => getStorage() as NimiAIHostStorage | null,
  indexKey: TESTER_AI_SNAPSHOT_INDEX_KEY,
  snapshotKeyForExecution: (executionId) => `${TESTER_AI_SNAPSHOT_STORAGE_PREFIX}${executionId}`,
  latestKeyForScope: (encodedScopeRef) => `${TESTER_AI_SNAPSHOT_STORAGE_PREFIX}latest:${encodedScopeRef}`,
  enableEphemeralStore: isTesterEphemeralStoreHarness(),
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
  const profiles: NimiAIProfile[] = [];
  for (const profile of parsed.profiles) {
    let parsedProfile: NimiAIProfile;
    try {
      parsedProfile = parseNimiAIProfile(profile);
    } catch (error) {
      throw new Error(`Stored AIProfile is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    const validation = validateNimiAIProfile(parsedProfile);
    if (!validation.valid) {
      throw new Error(`Stored AIProfile is invalid: ${validation.errors.join('; ')}`);
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
    if (!isTesterEphemeralStoreHarness()) {
      throw new Error('Tester AIProfile library requires browser local storage.');
    }
    return {
      schemaVersion: TESTER_AI_PROFILE_LIBRARY_SCHEMA_VERSION,
      profiles: [...ephemeralProfiles],
    };
  }
  const raw = storage.getItem(TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY);
  if (!raw) return defaultProfileStore();
  return parseStoredProfileLibrary(raw);
}

function saveProfileLibraryStore(store: TesterAIProfileLibraryStore, storage: Storage | null = getStorage()): void {
  if (!storage) {
    if (!isTesterEphemeralStoreHarness()) {
      throw new Error('Tester AIProfile library requires browser local storage.');
    }
    ephemeralProfiles = [...store.profiles];
    return;
  }
  storage.setItem(TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY, JSON.stringify(store));
}

export function listTesterAIProfiles(): NimiAIProfile[] {
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

  let profile: NimiAIProfile;
  try {
    profile = parseNimiAIProfile(parsed);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      message: 'AIProfile validation failed.',
    };
  }

  const validation = validateNimiAIProfile(profile);
  if (!validation.valid) {
    return {
      ok: false,
      errors: [...validation.errors],
      message: 'AIProfile validation failed.',
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

export function loadTesterAIConfig(scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef()): NimiAIConfig {
  try {
    return aiConfigStore.load(scopeRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Stored NimiAIConfig is invalid: ')) {
      throw new Error(`Stored ${message}`);
    }
    if (message.includes('Stored NimiAIConfig scopeRef does not match requested scopeRef')) {
      throw new Error('Stored NimiAIConfig scope does not match App Lab.');
    }
    throw error;
  }
}

export function saveTesterAIConfig(
  next: NimiAIConfig,
  scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
  options?: { readonly expectedBaseVersion?: string },
): NimiAIConfig {
  const normalized = { ...next, scopeRef };
  const expectedBaseVersion = options?.expectedBaseVersion?.trim();
  if (expectedBaseVersion) {
    const currentVersion = versionNimiAIConfig(loadTesterAIConfig(scopeRef));
    if (currentVersion !== expectedBaseVersion) {
      throw new Error('NimiAIConfig CAS conflict: baseVersion is stale');
    }
  }
  const validation = validateNimiAIConfig(normalized);
  if (!validation.valid) {
    throw new Error(`NimiAIConfig validation failed: ${validation.errors.join('; ')}`);
  }
  const saved = aiConfigStore.save(normalized);
  configSubscriptions.notify(saved);
  return saved;
}

export function recordTesterAISnapshot(snapshot: NimiAISnapshot): NimiAISnapshot {
  return aiSnapshotStore.record(snapshot);
}

export function getTesterAISnapshot(executionId: string): NimiAISnapshot | null {
  return aiSnapshotStore.get(executionId);
}

export function getLatestTesterAISnapshot(
  scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
): NimiAISnapshot | null {
  return aiSnapshotStore.getLatest(scopeRef);
}

export function createTesterAIConfigService(): SharedAIConfigService {
  const createSurface = () => createNimiAIHostSurface({
    profiles: listTesterAIProfiles(),
    configStore: aiConfigStore,
    snapshotStore: aiSnapshotStore,
    subscriptions: configSubscriptions,
  });
  return {
    aiConfig: {
      get(scopeRef: NimiAIScopeRef) {
        return loadTesterAIConfig(scopeRef);
      },
      update(scopeRef: NimiAIScopeRef, next: NimiAIConfig) {
        saveTesterAIConfig(next, scopeRef);
      },
      subscribe(scopeRef: NimiAIScopeRef, listener: SharedAIConfigSubscribeListener): SharedAIConfigUnsubscribe {
        return configSubscriptions.subscribe(scopeRef, listener);
      },
    },
    aiProfile: {
      async list() {
        return [...await createSurface().aiProfile.list()];
      },
      async previewApply(scopeRef: NimiAIScopeRef, profileId: string, options) {
        return createSurface().aiProfile.previewApply(scopeRef, profileId, options);
      },
      async apply(scopeRef: NimiAIScopeRef, profileId: string, options) {
        return createSurface().aiProfile.apply(scopeRef, profileId, options);
      },
    },
  };
}
