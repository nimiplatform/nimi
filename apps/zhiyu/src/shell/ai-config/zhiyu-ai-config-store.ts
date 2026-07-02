import {
  areNimiAIScopeRefsEqual,
  createNimiAIConfigStore,
  createNimiAIConfigSubscriptionRegistry,
  createNimiAIHostSurface,
  createNimiAISnapshotStore,
  createNimiAppAIScopeRef,
  encodeNimiAIScopeRef,
  validateNimiAIConfig,
  versionNimiAIConfig,
  type NimiAIConfig,
  type NimiAIHostStorage,
  type NimiAIScopeRef,
  type NimiAISnapshot,
} from '@nimiplatform/sdk/ai';
import type {
  SharedAIConfigService,
  SharedAIConfigSubscribeListener,
  SharedAIConfigUnsubscribe,
} from '@nimiplatform/kit/features/model-config/headless';
import { resolveBrowserStorage } from '@nimiplatform/kit/core/storage-json';
import { appId } from '../auth/runtime-platform';

export const ZHIYU_AGENT_HOME_AI_SURFACE_ID = 'zhiyu-agent-home';
export const ZHIYU_AI_CONFIG_STORAGE_KEY = 'nimiapp-zhiyu:agent-home-ai-config:v1';
export const ZHIYU_AI_CONFIG_SCOPE_INDEX_KEY = 'nimiapp-zhiyu:ai-config:index:v1';
export const ZHIYU_AI_CONFIG_QUARANTINE_PREFIX = `${ZHIYU_AI_CONFIG_STORAGE_KEY}:quarantine:`;
export const ZHIYU_AI_SNAPSHOT_INDEX_KEY = 'nimiapp-zhiyu:agent-home-ai-snapshot-index:v1';
export const ZHIYU_AI_SNAPSHOT_STORAGE_PREFIX = 'nimiapp-zhiyu:agent-home-ai-snapshot:';

export type ZhiyuAIConfigStorageRepairResult = {
  readonly scanned: number;
  readonly quarantined: number;
  readonly removedScopeKeys: readonly string[];
  readonly quarantineKeys: readonly string[];
};

type ZhiyuAIConfigStorageRepairOptions = {
  readonly now?: () => string;
};

const configSubscriptions = createNimiAIConfigSubscriptionRegistry();

export function createZhiyuAgentHomeAIScopeRef(): NimiAIScopeRef {
  return createNimiAppAIScopeRef(appId, ZHIYU_AGENT_HOME_AI_SURFACE_ID);
}

export function zhiyuAIConfigStorageKeyForScopeKey(scopeKey: string): string {
  return `${ZHIYU_AI_CONFIG_STORAGE_KEY}:${scopeKey}`;
}

export function zhiyuAIConfigStorageKeyForScopeRef(scopeRef: NimiAIScopeRef): string {
  return zhiyuAIConfigStorageKeyForScopeKey(encodeNimiAIScopeRef(scopeRef));
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

function isZhiyuEphemeralStoreHarness(): boolean {
  return typeof window === 'undefined';
}

const aiConfigStore = createNimiAIConfigStore({
  storage: () => getStorage() as NimiAIHostStorage | null,
  indexKey: ZHIYU_AI_CONFIG_SCOPE_INDEX_KEY,
  configKeyForScope: zhiyuAIConfigStorageKeyForScopeKey,
  enableEphemeralStore: isZhiyuEphemeralStoreHarness(),
});

const aiSnapshotStore = createNimiAISnapshotStore({
  storage: () => getStorage() as NimiAIHostStorage | null,
  indexKey: ZHIYU_AI_SNAPSHOT_INDEX_KEY,
  snapshotKeyForExecution: (executionId) => `${ZHIYU_AI_SNAPSHOT_STORAGE_PREFIX}${executionId}`,
  latestKeyForScope: (encodedScopeRef) => `${ZHIYU_AI_SNAPSHOT_STORAGE_PREFIX}latest:${encodedScopeRef}`,
  enableEphemeralStore: isZhiyuEphemeralStoreHarness(),
});

function localStorageRemove(storage: Storage, key: string): void {
  if (typeof storage.removeItem === 'function') {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, '');
}

function readScopeIndex(storage: Storage): string[] {
  const raw = storage.getItem(ZHIYU_AI_CONFIG_SCOPE_INDEX_KEY);
  if (!raw) {
    return [];
  }
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
  storage.setItem(ZHIYU_AI_CONFIG_SCOPE_INDEX_KEY, JSON.stringify([...new Set(next)].sort()));
}

function uniqueZhiyuAIConfigQuarantineKey(storage: Storage, scopeKey: string, quarantinedAt: string): string {
  const base = `${ZHIYU_AI_CONFIG_QUARANTINE_PREFIX}${encodeURIComponent(scopeKey)}:${encodeURIComponent(quarantinedAt)}`;
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
    return 'Stored AIConfig scopeRef does not match Zhiyu agent home scopeRef.';
  }
  return null;
}

export function repairZhiyuAIConfigStorageForScope(
  scopeRef: NimiAIScopeRef = createZhiyuAgentHomeAIScopeRef(),
  storage: Storage | null = getStorage(),
  options: ZhiyuAIConfigStorageRepairOptions = {},
): ZhiyuAIConfigStorageRepairResult {
  storage = isUsableHostStorage(storage) ? storage : null;
  if (!storage) {
    return { scanned: 0, quarantined: 0, removedScopeKeys: [], quarantineKeys: [] };
  }
  const scopeKey = encodeNimiAIScopeRef(scopeRef);
  const scopedKey = zhiyuAIConfigStorageKeyForScopeKey(scopeKey);
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
  const quarantineKey = uniqueZhiyuAIConfigQuarantineKey(storage, scopeKey, quarantinedAt);
  storage.setItem(quarantineKey, JSON.stringify({
    schemaVersion: 1,
    reasonCode: 'ZHIYU_AI_CONFIG_STORE_INVALID',
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

export function loadZhiyuAIConfig(scopeRef: NimiAIScopeRef = createZhiyuAgentHomeAIScopeRef()): NimiAIConfig {
  repairZhiyuAIConfigStorageForScope(scopeRef);
  return aiConfigStore.load(scopeRef);
}

export function saveZhiyuAIConfig(
  next: NimiAIConfig,
  scopeRef: NimiAIScopeRef = createZhiyuAgentHomeAIScopeRef(),
  options?: { readonly expectedBaseVersion?: string },
): NimiAIConfig {
  repairZhiyuAIConfigStorageForScope(scopeRef);
  if (!areNimiAIScopeRefsEqual(next.scopeRef, scopeRef)) {
    throw new Error('NimiAIConfig scopeRef does not match Zhiyu agent home scopeRef.');
  }
  const normalized = { ...next, scopeRef };
  const expectedBaseVersion = options?.expectedBaseVersion?.trim();
  if (expectedBaseVersion) {
    const currentVersion = versionNimiAIConfig(loadZhiyuAIConfig(scopeRef));
    if (currentVersion !== expectedBaseVersion) {
      throw new Error('NimiAIConfig CAS conflict: baseVersion is stale');
    }
  }
  const saved = aiConfigStore.save(normalized);
  configSubscriptions.notify(saved);
  return saved;
}

export function recordZhiyuAISnapshot(snapshot: NimiAISnapshot): NimiAISnapshot {
  return aiSnapshotStore.record(snapshot);
}

export function getZhiyuAISnapshot(executionId: string): NimiAISnapshot | null {
  return aiSnapshotStore.get(executionId);
}

export function getLatestZhiyuAISnapshot(
  scopeRef: NimiAIScopeRef = createZhiyuAgentHomeAIScopeRef(),
): NimiAISnapshot | null {
  return aiSnapshotStore.getLatest(scopeRef);
}

export function createZhiyuAIConfigService(): SharedAIConfigService {
  const createSurface = () => createNimiAIHostSurface({
    profiles: [],
    configStore: aiConfigStore,
    snapshotStore: aiSnapshotStore,
    subscriptions: configSubscriptions,
  });
  return {
    aiConfig: {
      get(scopeRef: NimiAIScopeRef) {
        return loadZhiyuAIConfig(scopeRef);
      },
      update(scopeRef: NimiAIScopeRef, next: NimiAIConfig) {
        return saveZhiyuAIConfig(next, scopeRef);
      },
      subscribe(scopeRef: NimiAIScopeRef, listener: SharedAIConfigSubscribeListener): SharedAIConfigUnsubscribe {
        return configSubscriptions.subscribe(scopeRef, listener);
      },
    },
    aiProfile: {
      async list() {
        return [];
      },
      async previewApply(scopeRef: NimiAIScopeRef, profileId: string, options) {
        repairZhiyuAIConfigStorageForScope(scopeRef);
        return createSurface().aiProfile.previewApply(scopeRef, profileId, options);
      },
      async apply(scopeRef: NimiAIScopeRef, profileId: string, options) {
        repairZhiyuAIConfigStorageForScope(scopeRef);
        return createSurface().aiProfile.apply(scopeRef, profileId, options);
      },
    },
  };
}
