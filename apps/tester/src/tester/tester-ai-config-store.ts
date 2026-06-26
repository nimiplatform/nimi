import {
  createNimiAIConfigStore,
  createNimiAIConfigSubscriptionRegistry,
  createNimiAIHostSurface,
  createNimiAISnapshotStore,
  createNimiAppAIScopeRef,
  areNimiAIScopeRefsEqual,
  encodeNimiAIScopeRef,
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
export const TESTER_AI_CONFIG_LEGACY_STORAGE_KEY = TESTER_AI_CONFIG_STORAGE_KEY;
export const TESTER_AI_CONFIG_SCOPE_MISMATCH_STORAGE_KEY = `${TESTER_AI_CONFIG_LEGACY_STORAGE_KEY}:scope-mismatch`;
export const TESTER_AI_CONFIG_SCOPE_INDEX_KEY = 'nimi:ai-config:index';
export const TESTER_AI_CONFIG_QUARANTINE_PREFIX = `${TESTER_AI_CONFIG_LEGACY_STORAGE_KEY}:quarantine:`;
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

export type TesterAIConfigStorageRepairResult = {
  readonly scanned: number;
  readonly quarantined: number;
  readonly removedScopeKeys: readonly string[];
  readonly quarantineKeys: readonly string[];
};

type TesterAIConfigStorageRepairOptions = {
  readonly now?: () => string;
};

const configSubscriptions = createNimiAIConfigSubscriptionRegistry();
let ephemeralProfiles: NimiAIProfile[] = [];

export function createTesterAppLabAIScopeRef(): NimiAIScopeRef {
  return createNimiAppAIScopeRef(appId, TESTER_APP_LAB_AI_SURFACE_ID);
}

function isUsableHostStorage(value: unknown): value is Storage {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as Partial<Storage>).getItem === 'function'
      && typeof (value as Partial<Storage>).setItem === 'function',
  );
}

function getStorage(): Storage | null {
  const storage = resolveBrowserStorage('local');
  return isUsableHostStorage(storage) ? storage : null;
}

function isTesterEphemeralStoreHarness(): boolean {
  return typeof window === 'undefined';
}

const aiConfigStore = createNimiAIConfigStore({
  storage: () => getStorage() as NimiAIHostStorage | null,
  configKeyForScope: testerAIConfigStorageKeyForScopeKey,
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
  storage = isUsableHostStorage(storage) ? storage : null;
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
  storage = isUsableHostStorage(storage) ? storage : null;
  if (!storage) {
    if (!isTesterEphemeralStoreHarness()) {
      throw new Error('Tester AIProfile library requires browser local storage.');
    }
    ephemeralProfiles = [...store.profiles];
    return;
  }
  storage.setItem(TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY, JSON.stringify(store));
}

export function testerAIConfigStorageKeyForScopeKey(scopeKey: string): string {
  return `${TESTER_AI_CONFIG_LEGACY_STORAGE_KEY}:${scopeKey}`;
}

function testerAIConfigStorageKeyForScopeRef(scopeRef: NimiAIScopeRef): string {
  return testerAIConfigStorageKeyForScopeKey(encodeNimiAIScopeRef(scopeRef));
}

function localStorageRemove(storage: Storage, key: string): void {
  if (typeof storage.removeItem === 'function') {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, '');
}

function readScopeIndex(storage: Storage): string[] {
  const raw = storage.getItem(TESTER_AI_CONFIG_SCOPE_INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function removeScopeKeyFromIndex(storage: Storage, scopeKey: string): void {
  const next = readScopeIndex(storage).filter((entry) => entry !== scopeKey);
  storage.setItem(TESTER_AI_CONFIG_SCOPE_INDEX_KEY, JSON.stringify([...new Set(next)].sort()));
}

function uniqueTesterAIConfigQuarantineKey(storage: Storage, scopeKey: string, quarantinedAt: string): string {
  const base = `${TESTER_AI_CONFIG_QUARANTINE_PREFIX}${encodeURIComponent(scopeKey)}:${encodeURIComponent(quarantinedAt)}`;
  let candidate = base;
  let index = 1;
  while (storage.getItem(candidate) !== null) {
    candidate = `${base}:${index}`;
    index += 1;
  }
  return candidate;
}

function storedAIConfigInvalidReason(raw: string, scopeRef: NimiAIScopeRef): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return error instanceof Error ? error.message : String(error || 'Invalid stored AIConfig JSON.');
  }
  const validation = validateNimiAIConfig(parsed);
  if (!validation.valid) {
    return validation.errors.join('; ');
  }
  const config = parsed as NimiAIConfig;
  if (!areNimiAIScopeRefsEqual(config.scopeRef, scopeRef)) {
    return 'Stored AIConfig scopeRef does not match App Lab scopeRef.';
  }
  return null;
}

export function repairTesterAIConfigStorageForScope(
  scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
  storage: Storage | null = getStorage(),
  options: TesterAIConfigStorageRepairOptions = {},
): TesterAIConfigStorageRepairResult {
  storage = isUsableHostStorage(storage) ? storage : null;
  if (!storage) {
    return { scanned: 0, quarantined: 0, removedScopeKeys: [], quarantineKeys: [] };
  }
  const scopeKey = encodeNimiAIScopeRef(scopeRef);
  const scopedKey = testerAIConfigStorageKeyForScopeKey(scopeKey);
  const raw = storage.getItem(scopedKey);
  if (!raw) {
    removeScopeKeyFromIndex(storage, scopeKey);
    return { scanned: 0, quarantined: 0, removedScopeKeys: [], quarantineKeys: [] };
  }
  const reason = storedAIConfigInvalidReason(raw, scopeRef);
  if (!reason) {
    return { scanned: 1, quarantined: 0, removedScopeKeys: [], quarantineKeys: [] };
  }

  const quarantinedAt = options.now?.() ?? new Date().toISOString();
  const quarantineKey = uniqueTesterAIConfigQuarantineKey(storage, scopeKey, quarantinedAt);
  storage.setItem(quarantineKey, JSON.stringify({
    schemaVersion: 1,
    reasonCode: 'TESTER_AI_CONFIG_STORE_INVALID',
    reason,
    scopeKey,
    originalKey: scopedKey,
    quarantinedAt,
    raw,
  }));
  localStorageRemove(storage, scopedKey);
  removeScopeKeyFromIndex(storage, scopeKey);
  return {
    scanned: 1,
    quarantined: 1,
    removedScopeKeys: [scopeKey],
    quarantineKeys: [quarantineKey],
  };
}

function migrateLegacyTesterAIConfigIfNeeded(scopeRef: NimiAIScopeRef): void {
  const storage = getStorage();
  if (!storage) return;
  const scopedKey = testerAIConfigStorageKeyForScopeRef(scopeRef);
  if (storage.getItem(scopedKey) !== null) return;
  const legacyRaw = storage.getItem(TESTER_AI_CONFIG_LEGACY_STORAGE_KEY);
  if (!legacyRaw) return;

  try {
    const parsed = JSON.parse(legacyRaw) as NimiAIConfig;
    if (encodeNimiAIScopeRef(parsed.scopeRef) !== encodeNimiAIScopeRef(scopeRef)) {
      storage.setItem(TESTER_AI_CONFIG_SCOPE_MISMATCH_STORAGE_KEY, legacyRaw);
      localStorageRemove(storage, TESTER_AI_CONFIG_LEGACY_STORAGE_KEY);
      return;
    }
    const validation = validateNimiAIConfig(parsed);
    if (!validation.valid) {
      storage.setItem(`${TESTER_AI_CONFIG_LEGACY_STORAGE_KEY}:invalid`, legacyRaw);
      localStorageRemove(storage, TESTER_AI_CONFIG_LEGACY_STORAGE_KEY);
      return;
    }
    storage.setItem(scopedKey, legacyRaw);
    localStorageRemove(storage, TESTER_AI_CONFIG_LEGACY_STORAGE_KEY);
  } catch {
    storage.setItem(`${TESTER_AI_CONFIG_LEGACY_STORAGE_KEY}:invalid`, legacyRaw);
    localStorageRemove(storage, TESTER_AI_CONFIG_LEGACY_STORAGE_KEY);
  }
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
  migrateLegacyTesterAIConfigIfNeeded(scopeRef);
  repairTesterAIConfigStorageForScope(scopeRef);
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
  migrateLegacyTesterAIConfigIfNeeded(scopeRef);
  repairTesterAIConfigStorageForScope(scopeRef);
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
        migrateLegacyTesterAIConfigIfNeeded(scopeRef);
        repairTesterAIConfigStorageForScope(scopeRef);
        return createSurface().aiProfile.previewApply(scopeRef, profileId, options);
      },
      async apply(scopeRef: NimiAIScopeRef, profileId: string, options) {
        migrateLegacyTesterAIConfigIfNeeded(scopeRef);
        repairTesterAIConfigStorageForScope(scopeRef);
        return createSurface().aiProfile.apply(scopeRef, profileId, options);
      },
    },
  };
}
