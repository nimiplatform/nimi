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
  createNimiAIConfigStore,
  encodeNimiAIScopeRef,
  parseNimiAIScopeRefKey,
} from '@nimiplatform/sdk/ai';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const SCOPE_INDEX_KEY = 'nimi.ai-config.scope-index.v2';
const SCOPE_CONFIG_PREFIX = 'nimi.ai-config.scope.';
const SCOPE_CONFIG_SUFFIX = '.v2';

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

// ---------------------------------------------------------------------------
// Public API — multi-scope
// ---------------------------------------------------------------------------

/** Load AIConfig for a specific scope. Returns empty config if not found. */
export function loadAIConfigForScope(scopeRef: NimiAIScopeRef): NimiAIConfig {
  return scopedStore.load(scopeRef);
}

/** Persist AIConfig for a specific scope. */
export function persistAIConfigForScope(config: NimiAIConfig): void {
  scopedStore.save(config);
}

/** List all known scope keys from the index. */
export function listPersistedScopeKeys(): string[] {
  return scopedStore.listScopeRefs().map(encodeNimiAIScopeRef);
}

/** Parse a scope key string back to AIScopeRef. */
export function parseScopeKey(key: string): NimiAIScopeRef | null {
  return parseNimiAIScopeRefKey(key);
}
