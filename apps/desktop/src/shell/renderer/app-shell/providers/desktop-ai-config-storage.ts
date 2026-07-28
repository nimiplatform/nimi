/**
 * Shared Desktop host AIConfig persistence (S-AICONF-005).
 *
 * Phase 5 multi-scope persistence remains scope-keyed, but the owner semantics
 * now live under the shared Desktop host AIConfig service instead of any
 * chat-local storage helper.
 *
 * Hard cut — no legacy migration, no backward-compat shim. Project is pre-launch.
 */

import type { NimiAIConfig, NimiAIHostStorage, NimiAIScopeRef } from '@nimiplatform/sdk/ai';
import {
  resolveBrowserStorage,
} from '@nimiplatform/kit/core/storage-json';
import {
  areNimiAIScopeRefsEqual,
  createNimiAIConfigStore,
  encodeNimiAIScopeRef,
  formatNimiAIValidationIssues,
  parseNimiAIScopeRefKey,
  validateNimiAIConfig,
} from '@nimiplatform/sdk/ai';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const SCOPE_INDEX_KEY = 'nimi.ai-config.scope-index.v2';
const SCOPE_CONFIG_PREFIX = 'nimi.ai-config.scope.';
const SCOPE_CONFIG_SUFFIX = '.v2';
const QUARANTINE_PREFIX = 'nimi.ai-config.quarantine.';

export type DesktopAIConfigStorageRepairResult = {
  readonly scanned: number;
  readonly quarantined: number;
  readonly removedScopeKeys: readonly string[];
  readonly quarantineKeys: readonly string[];
};

export type DesktopAIConfigStorageRepairOptions = {
  readonly now?: () => string;
};

function isStorageLike(value: unknown): value is NimiAIHostStorage {
  return Boolean(value)
    && typeof (value as NimiAIHostStorage).getItem === 'function'
    && typeof (value as NimiAIHostStorage).setItem === 'function';
}

function getStorage(): NimiAIHostStorage | null {
  const storage = resolveBrowserStorage('local');
  return isStorageLike(storage) ? storage : null;
}

function isNonBrowserAIConfigStoreHarness(): boolean {
  return typeof window === 'undefined';
}

const scopedStore = createNimiAIConfigStore({
  storage: () => getStorage(),
  indexKey: SCOPE_INDEX_KEY,
  configKeyForScope: (scopeKey) => storageKeyForScope(scopeKey),
  enableEphemeralStore: isNonBrowserAIConfigStoreHarness(),
});

export function scopeKeyFromRef(ref: NimiAIScopeRef): string {
  return encodeNimiAIScopeRef(ref);
}

function storageKeyForScope(scopeKey: string): string {
  return `${SCOPE_CONFIG_PREFIX}${scopeKey}${SCOPE_CONFIG_SUFFIX}`;
}

function readScopeIndex(storage: NimiAIHostStorage): string[] {
  const raw = storage.getItem(SCOPE_INDEX_KEY);
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

function removeStorageItem(storage: NimiAIHostStorage, key: string): void {
  if (storage.removeItem) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, '');
}

function uniqueQuarantineKey(storage: NimiAIHostStorage, scopeKey: string, quarantinedAt: string): string {
  const base = `${QUARANTINE_PREFIX}${encodeURIComponent(scopeKey)}.${encodeURIComponent(quarantinedAt)}`;
  let candidate = base;
  let index = 1;
  while (storage.getItem(candidate) !== null) {
    candidate = `${base}.${index}`;
    index += 1;
  }
  return candidate;
}

function storedConfigInvalidReason(raw: string, scopeRef: NimiAIScopeRef): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return error instanceof Error ? error.message : String(error || 'Invalid stored AIConfig JSON');
  }
  const validation = validateNimiAIConfig(parsed);
  if (!validation.valid) {
    return formatNimiAIValidationIssues(validation.issues);
  }
  const config = parsed as NimiAIConfig;
  if (!areNimiAIScopeRefsEqual(config.scopeRef, scopeRef)) {
    return 'Stored AIConfig scopeRef does not match requested scopeRef';
  }
  return null;
}

export function repairDesktopAIConfigStorage(
  storage: NimiAIHostStorage,
  options: DesktopAIConfigStorageRepairOptions = {},
): DesktopAIConfigStorageRepairResult {
  const keys = readScopeIndex(storage);
  const retainedScopeKeys = new Set<string>();
  const removedScopeKeys: string[] = [];
  const quarantineKeys: string[] = [];
  let scanned = 0;
  let changed = false;

  for (const scopeKey of keys) {
    const scopeRef = parseScopeKey(scopeKey);
    if (!scopeRef) {
      removedScopeKeys.push(scopeKey);
      changed = true;
      continue;
    }
    scanned += 1;
    const configKey = storageKeyForScope(scopeKey);
    const raw = storage.getItem(configKey);
    if (!raw) {
      removedScopeKeys.push(scopeKey);
      changed = true;
      continue;
    }
    const reason = storedConfigInvalidReason(raw, scopeRef);
    if (!reason) {
      retainedScopeKeys.add(scopeKey);
      continue;
    }

    const quarantinedAt = options.now?.() ?? new Date().toISOString();
    const quarantineKey = uniqueQuarantineKey(storage, scopeKey, quarantinedAt);
    storage.setItem(quarantineKey, JSON.stringify({
      schemaVersion: 1,
      reasonCode: 'DESKTOP_AI_CONFIG_STORE_INVALID',
      reason,
      scopeKey,
      originalKey: configKey,
      quarantinedAt,
      raw,
    }));
    removeStorageItem(storage, configKey);
    removedScopeKeys.push(scopeKey);
    quarantineKeys.push(quarantineKey);
    changed = true;
  }

  if (changed) {
    storage.setItem(SCOPE_INDEX_KEY, JSON.stringify([...retainedScopeKeys].sort()));
  }

  return {
    scanned,
    quarantined: quarantineKeys.length,
    removedScopeKeys,
    quarantineKeys,
  };
}

let repairedStorage: NimiAIHostStorage | null = null;

function ensureDesktopAIConfigStorageRepaired(): void {
  const storage = getStorage();
  if (!storage || repairedStorage === storage) {
    return;
  }
  repairDesktopAIConfigStorage(storage);
  repairedStorage = storage;
}

// ---------------------------------------------------------------------------
// Public API — multi-scope
// ---------------------------------------------------------------------------

/** Load AIConfig for a specific scope. Returns empty config if not found. */
export function loadAIConfigForScope(scopeRef: NimiAIScopeRef): NimiAIConfig {
  ensureDesktopAIConfigStorageRepaired();
  return scopedStore.load(scopeRef);
}

/** Persist AIConfig for a specific scope. */
export function persistAIConfigForScope(config: NimiAIConfig): void {
  ensureDesktopAIConfigStorageRepaired();
  scopedStore.save(config);
}

/** List all known scope keys from the index. */
export function listPersistedScopeKeys(): string[] {
  ensureDesktopAIConfigStorageRepaired();
  return scopedStore.listScopeRefs().map(encodeNimiAIScopeRef);
}

/** Parse a scope key string back to AIScopeRef. */
export function parseScopeKey(key: string): NimiAIScopeRef | null {
  return parseNimiAIScopeRefKey(key);
}
