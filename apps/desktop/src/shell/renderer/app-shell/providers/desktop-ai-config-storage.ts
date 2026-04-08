/**
 * Shared Desktop host AIConfig persistence (S-AICONF-005).
 *
 * Phase 5 multi-scope persistence remains scope-keyed, but the owner semantics
 * now live under the shared Desktop host AIConfig service instead of any
 * chat-local storage helper.
 *
 * Hard cut — no legacy migration, no backward-compat shim. Project is pre-launch.
 */

import type { AIConfig, AIScopeRef } from '@nimiplatform/sdk/mod';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const SCOPE_INDEX_KEY = 'nimi.ai-config.scope-index.v2';
const SCOPE_CONFIG_PREFIX = 'nimi.ai-config.scope.';
const SCOPE_CONFIG_SUFFIX = '.v2';

function getStorage(): Storage | undefined {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    return globalThis.localStorage as Storage | undefined;
  } catch {
    return undefined;
  }
}

function encodeScopeSegment(value: string | undefined): string {
  return encodeURIComponent(String(value || ''));
}

function decodeScopeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function scopeKeyFromRef(ref: AIScopeRef): string {
  return [
    encodeScopeSegment(ref.kind),
    encodeScopeSegment(ref.ownerId),
    encodeScopeSegment(ref.surfaceId),
  ].join(':');
}

function storageKeyForScope(scopeKey: string): string {
  return `${SCOPE_CONFIG_PREFIX}${scopeKey}${SCOPE_CONFIG_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// Normalize / parse
// ---------------------------------------------------------------------------

function normalizeAIConfig(raw: unknown): AIConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const scopeRef = record.scopeRef;
  if (!scopeRef || typeof scopeRef !== 'object') return null;
  const sr = scopeRef as Record<string, unknown>;
  if (!sr.kind || !sr.ownerId) return null;
  const caps = record.capabilities;
  if (!caps || typeof caps !== 'object') return null;
  const c = caps as Record<string, unknown>;
  return {
    scopeRef: {
      kind: sr.kind as AIConfig['scopeRef']['kind'],
      ownerId: String(sr.ownerId),
      surfaceId: sr.surfaceId ? String(sr.surfaceId) : undefined,
    },
    capabilities: {
      selectedBindings: (c.selectedBindings && typeof c.selectedBindings === 'object'
        ? c.selectedBindings
        : {}) as AIConfig['capabilities']['selectedBindings'],
      localProfileRefs: (c.localProfileRefs && typeof c.localProfileRefs === 'object'
        ? c.localProfileRefs
        : {}) as AIConfig['capabilities']['localProfileRefs'],
    },
    profileOrigin: record.profileOrigin as AIConfig['profileOrigin'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Scope index
// ---------------------------------------------------------------------------

function loadScopeIndex(storage: Storage): string[] {
  try {
    const raw = storage.getItem(SCOPE_INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
    }
  } catch { /* ignore */ }
  return [];
}

function persistScopeIndex(storage: Storage, scopeKeys: string[]): void {
  try {
    storage.setItem(SCOPE_INDEX_KEY, JSON.stringify(scopeKeys));
  } catch { /* ignore */ }
}

function ensureScopeInIndex(storage: Storage, scopeKey: string): void {
  const index = loadScopeIndex(storage);
  if (!index.includes(scopeKey)) {
    index.push(scopeKey);
    persistScopeIndex(storage, index);
  }
}

// ---------------------------------------------------------------------------
// Public API — multi-scope
// ---------------------------------------------------------------------------

/** Load AIConfig for a specific scope. Returns empty config if not found. */
export function loadAIConfigForScope(scopeRef: AIScopeRef): AIConfig {
  const storage = getStorage();
  if (!storage) return createEmptyAIConfig(scopeRef);
  const key = scopeKeyFromRef(scopeRef);
  try {
    const raw = storage.getItem(storageKeyForScope(key));
    if (raw) {
      const parsed = normalizeAIConfig(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch { /* ignore */ }
  return createEmptyAIConfig(scopeRef);
}

/** Persist AIConfig for a specific scope. */
export function persistAIConfigForScope(config: AIConfig): void {
  const storage = getStorage();
  if (!storage) return;
  const key = scopeKeyFromRef(config.scopeRef);
  try {
    storage.setItem(storageKeyForScope(key), JSON.stringify(config));
    ensureScopeInIndex(storage, key);
  } catch { /* ignore */ }
}

/** List all known scope keys from the index. */
export function listPersistedScopeKeys(): string[] {
  const storage = getStorage();
  if (!storage) return [];
  return loadScopeIndex(storage);
}

/** Parse a scope key string back to AIScopeRef. */
export function parseScopeKey(key: string): AIScopeRef | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const decodedKind = decodeScopeSegment(parts[0] ?? '');
  const decodedOwnerId = decodeScopeSegment(parts[1] ?? '');
  const decodedSurfaceId = decodeScopeSegment(parts[2] ?? '');
  if (decodedKind === null || decodedOwnerId === null || decodedSurfaceId === null) {
    return null;
  }
  const kind = decodedKind as AIScopeRef['kind'];
  const ownerId = decodedOwnerId;
  const surfaceId = decodedSurfaceId || undefined;
  if (!kind || !ownerId) return null;
  return { kind, ownerId, surfaceId };
}
