/**
 * Shared Desktop host AIConfig persistence (S-AICONF-005).
 *
 * Phase 5 multi-scope persistence remains scope-keyed, but the owner semantics
 * now live under the shared Desktop host AIConfig service instead of any
 * chat-local storage helper.
 *
 * Hard cut — no legacy migration, no backward-compat shim. Project is pre-launch.
 */

import type { AIConfig, AIConfigStorageLike, AIScopeRef } from '@nimiplatform/sdk/ai';
import {
  resolveBrowserStorage,
} from '@nimiplatform/kit/core/storage-json';
import {
  aiConfigScopeKeyFromRef,
  createScopedAIConfigStore,
  parseAIConfigScopeKey,
} from '@nimiplatform/sdk/ai';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const SCOPE_INDEX_KEY = 'nimi.ai-config.scope-index.v2';
const SCOPE_CONFIG_PREFIX = 'nimi.ai-config.scope.';
const SCOPE_CONFIG_SUFFIX = '.v2';

function getStorage(): Storage | undefined {
  return resolveBrowserStorage('local') || undefined;
}

function isNonBrowserAIConfigStoreHarness(): boolean {
  return typeof window === 'undefined';
}

const scopedStore = createScopedAIConfigStore({
  storage: () => getStorage() as AIConfigStorageLike | undefined,
  indexKey: SCOPE_INDEX_KEY,
  configKeyForScope: (scopeKey) => storageKeyForScope(scopeKey),
  enableEphemeralStore: isNonBrowserAIConfigStoreHarness(),
});

export function scopeKeyFromRef(ref: AIScopeRef): string {
  return aiConfigScopeKeyFromRef(ref);
}

function storageKeyForScope(scopeKey: string): string {
  return `${SCOPE_CONFIG_PREFIX}${scopeKey}${SCOPE_CONFIG_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// Public API — multi-scope
// ---------------------------------------------------------------------------

/** Load AIConfig for a specific scope. Returns empty config if not found. */
export function loadAIConfigForScope(scopeRef: AIScopeRef): AIConfig {
  return scopedStore.load(scopeRef);
}

/** Persist AIConfig for a specific scope. */
export function persistAIConfigForScope(config: AIConfig): void {
  scopedStore.save(config);
}

/** List all known scope keys from the index. */
export function listPersistedScopeKeys(): string[] {
  return scopedStore.listScopeKeys();
}

/** Parse a scope key string back to AIScopeRef. */
export function parseScopeKey(key: string): AIScopeRef | null {
  return parseAIConfigScopeKey(key);
}
