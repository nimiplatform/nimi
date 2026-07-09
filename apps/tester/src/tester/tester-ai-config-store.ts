import {
  createEmptyNimiAIConfig,
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
  type NimiAIConfigStore,
  type NimiAIProfile,
  type NimiAIProfileApplyResult,
  type NimiAIScopeRef,
  type NimiAISnapshot,
} from '@nimiplatform/sdk/ai';
import type {
  SharedAIConfigService,
  SharedAIConfigSubscribeListener,
  SharedAIConfigUnsubscribe,
} from '@nimiplatform/kit/features/model-config/headless';
import {
  createInstalledNimiAppStandardShellSurface,
  extractShellBridgeErrorCode,
  toShellBridgeNimiError,
  type JsonObject,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { appId } from '../shell/auth/app-identity.js';

export const TESTER_APP_LAB_AI_SURFACE_ID = 'app-lab';
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

const standardShellSurface = createInstalledNimiAppStandardShellSurface();
const configSubscriptions = createNimiAIConfigSubscriptionRegistry();
const aiConfigCache = new Map<string, NimiAIConfig>();
const aiConfigHydration = new Map<string, Promise<NimiAIConfig>>();
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
  const storage = typeof window !== 'undefined'
    ? window.localStorage
    : (globalThis as { localStorage?: Storage }).localStorage;
  return isUsableHostStorage(storage) ? storage : null;
}

function isTesterEphemeralStoreHarness(): boolean {
  return getStorage() === null;
}

const aiConfigStore: NimiAIConfigStore = {
  has(scopeRef) {
    return aiConfigCache.has(encodeNimiAIScopeRef(scopeRef));
  },
  load(scopeRef) {
    return loadTesterAIConfig(scopeRef);
  },
  loadOrNull(scopeRef) {
    return cloneTesterAIConfig(aiConfigCache.get(encodeNimiAIScopeRef(scopeRef)) ?? null);
  },
  save(config) {
    return cacheTesterAIConfig(validateTesterAIConfigForScope(config.scopeRef, config, 'Tester AIConfig cache'));
  },
  listScopeRefs() {
    return [...aiConfigCache.values()].map((config) => cloneTesterAIConfig(config).scopeRef);
  },
};

const aiSnapshotStore = createNimiAISnapshotStore({
  storage: () => getStorage(),
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

export async function hydrateTesterAIConfigFromStandardShell(
  scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
): Promise<NimiAIConfig> {
  const scopeKey = encodeNimiAIScopeRef(scopeRef);
  const inflight = aiConfigHydration.get(scopeKey);
  if (inflight) return cloneTesterAIConfig(await inflight);
  const next = hydrateTesterAIConfigUncached(scopeRef);
  aiConfigHydration.set(scopeKey, next);
  try {
    return cloneTesterAIConfig(await next);
  } finally {
    aiConfigHydration.delete(scopeKey);
  }
}

export async function ensureTesterAIConfigLoaded(
  scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
): Promise<NimiAIConfig> {
  return hydrateTesterAIConfigFromStandardShell(scopeRef);
}

async function hydrateTesterAIConfigUncached(scopeRef: NimiAIScopeRef): Promise<NimiAIConfig> {
  const shellScopeRef = encodeNimiAIScopeRef(scopeRef);
  try {
    const loaded = await standardShellSurface.aiConfig.get(shellScopeRef);
    return cacheTesterAIConfig(validateTesterAIConfigForScope(
      scopeRef,
      loaded,
      'Standard shell AIConfig get',
    ));
  } catch (error) {
    if (isStandardShellNotFound(error)) {
      return saveTesterAIConfig(createEmptyNimiAIConfig(scopeRef), scopeRef);
    }
    throw toShellBridgeNimiError(error);
  }
}

export function loadTesterAIConfig(scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef()): NimiAIConfig {
  const cached = aiConfigCache.get(encodeNimiAIScopeRef(scopeRef));
  if (!cached) {
    throw new Error(
      `Tester AIConfig scope ${encodeNimiAIScopeRef(scopeRef)} has not been hydrated from installed app standard shell.`,
    );
  }
  return cloneTesterAIConfig(cached);
}

export async function saveTesterAIConfig(
  next: NimiAIConfig,
  scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
  options?: { readonly expectedBaseVersion?: string },
): Promise<NimiAIConfig> {
  const normalized = validateTesterAIConfigForScope(
    scopeRef,
    { ...next, scopeRef },
    'Tester AIConfig save',
  );
  const expectedBaseVersion = options?.expectedBaseVersion?.trim();
  if (expectedBaseVersion) {
    const currentVersion = versionNimiAIConfig(await hydrateTesterAIConfigFromStandardShell(scopeRef));
    if (currentVersion !== expectedBaseVersion) {
      throw new Error('NimiAIConfig CAS conflict: baseVersion is stale');
    }
  }
  const saved = await standardShellSurface.aiConfig.set(
    encodeNimiAIScopeRef(scopeRef),
    normalized as unknown as JsonObject,
  );
  const cached = cacheTesterAIConfig(validateTesterAIConfigForScope(scopeRef, saved, 'Standard shell AIConfig set'));
  configSubscriptions.notify(cached);
  return cached;
}

function cacheTesterAIConfig(config: NimiAIConfig): NimiAIConfig {
  const saved = cloneTesterAIConfig(config);
  aiConfigCache.set(encodeNimiAIScopeRef(saved.scopeRef), saved);
  return cloneTesterAIConfig(saved);
}

function validateTesterAIConfigForScope(
  scopeRef: NimiAIScopeRef,
  value: unknown,
  label: string,
): NimiAIConfig {
  const config = cloneTesterAIConfig(value as NimiAIConfig);
  const validation = validateNimiAIConfig(config);
  if (!validation.valid) {
    throw new Error(`${label} validation failed: ${validation.errors.join('; ')}`);
  }
  if (!areNimiAIScopeRefsEqual(config.scopeRef, scopeRef)) {
    throw new Error(`${label} scopeRef does not match App Lab scopeRef.`);
  }
  return config;
}

function cloneTesterAIConfig(config: NimiAIConfig): NimiAIConfig;
function cloneTesterAIConfig(config: NimiAIConfig | null): NimiAIConfig | null;
function cloneTesterAIConfig(config: NimiAIConfig | null): NimiAIConfig | null {
  return config ? JSON.parse(JSON.stringify(config)) as NimiAIConfig : null;
}

function isStandardShellNotFound(error: unknown): boolean {
  const normalized = toShellBridgeNimiError(error);
  return normalized.code === 'not-found'
    || normalized.reasonCode === 'electron-ai-config-scope-not-found'
    || normalized.reasonCode === 'tauri-ai-config-scope-not-found'
    || extractShellBridgeErrorCode(normalized.message) === 'not-found';
}

async function applyTesterAIProfile(
  scopeRef: NimiAIScopeRef,
  profileId: string,
  options: Parameters<SharedAIConfigService['aiProfile']['apply']>[2],
): Promise<NimiAIProfileApplyResult> {
  await hydrateTesterAIConfigFromStandardShell(scopeRef);
  const preview = await createSurface().aiProfile.previewApply(scopeRef, profileId, {
    requirementDeclarations: options.requirementDeclarations,
  });
  if (preview.outcome !== 'ready_to_apply' || !preview.after) {
    return {
      success: false,
      config: null,
      failureReason: preview.outcome,
      outcome: preview.outcome,
      setupProjection: preview.setupProjection,
      probeWarnings: preview.probeWarnings,
    };
  }
  if (options.expectedBaseVersion && options.expectedBaseVersion !== preview.baseVersion) {
    return {
      success: false,
      config: null,
      failureReason: 'stale_base',
      outcome: 'stale_base',
      probeWarnings: [],
    };
  }
  const saved = await saveTesterAIConfig(preview.after, scopeRef, {
    ...(options.expectedBaseVersion ? { expectedBaseVersion: options.expectedBaseVersion } : {}),
  });
  return {
    success: true,
    config: saved,
    failureReason: null,
    outcome: 'ready_to_apply',
    probeWarnings: [],
  };
}

function createSurface() {
  return createNimiAIHostSurface({
    profiles: listTesterAIProfiles(),
    configStore: aiConfigStore,
    snapshotStore: aiSnapshotStore,
    subscriptions: configSubscriptions,
  });
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
  return {
    aiConfig: {
      get(scopeRef: NimiAIScopeRef) {
        return loadTesterAIConfig(scopeRef);
      },
      async update(scopeRef: NimiAIScopeRef, next: NimiAIConfig) {
        await saveTesterAIConfig(next, scopeRef);
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
        await hydrateTesterAIConfigFromStandardShell(scopeRef);
        return createSurface().aiProfile.previewApply(scopeRef, profileId, options);
      },
      async apply(scopeRef: NimiAIScopeRef, profileId: string, options) {
        return applyTesterAIProfile(scopeRef, profileId, options);
      },
    },
  };
}
