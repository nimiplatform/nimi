/**
 * Shared Desktop host memory-embedding adjacent config persistence.
 *
 * This remains scope-keyed host-local persistence for the adjacent
 * memory-embedding config surface. It is intentionally separate from AIConfig
 * persistence because the config is not owned by AIConfig.capabilities truth.
 */

import type {
  MemoryEmbeddingBindingRef,
  MemoryEmbeddingConfig,
  AIScopeRef,
} from '@nimiplatform/sdk/mod';
import { createEmptyMemoryEmbeddingConfig } from '@nimiplatform/sdk/mod';

const SCOPE_INDEX_KEY = 'nimi.memory-embedding.scope-index.v1';
const SCOPE_CONFIG_PREFIX = 'nimi.memory-embedding.scope.';
const SCOPE_CONFIG_SUFFIX = '.v1';

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

function normalizeBindingRef(raw: unknown): MemoryEmbeddingBindingRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const kind = String(record.kind || '').trim();
  if (kind === 'cloud') {
    const connectorId = String(record.connectorId || '').trim();
    const modelId = String(record.modelId || '').trim();
    if (!connectorId || !modelId) {
      return null;
    }
    return { kind: 'cloud', connectorId, modelId };
  }
  if (kind === 'local') {
    const targetId = String(record.targetId || '').trim();
    if (!targetId) {
      return null;
    }
    return { kind: 'local', targetId };
  }
  return null;
}

function normalizeMemoryEmbeddingConfig(raw: unknown): MemoryEmbeddingConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const scopeRef = record.scopeRef;
  if (!scopeRef || typeof scopeRef !== 'object' || Array.isArray(scopeRef)) {
    return null;
  }
  const sr = scopeRef as Record<string, unknown>;
  const kind = String(sr.kind || '').trim();
  const ownerId = String(sr.ownerId || '').trim();
  if (!kind || !ownerId) {
    return null;
  }
  const sourceKindRaw = String(record.sourceKind || '').trim();
  const sourceKind = sourceKindRaw === 'cloud' || sourceKindRaw === 'local'
    ? sourceKindRaw
    : null;
  const bindingRef = normalizeBindingRef(record.bindingRef);
  const updatedAt = String(record.updatedAt || '').trim() || new Date().toISOString();
  const revisionToken = String(record.revisionToken || '').trim() || updatedAt;
  return {
    scopeRef: {
      kind: kind as AIScopeRef['kind'],
      ownerId,
      surfaceId: sr.surfaceId ? String(sr.surfaceId).trim() || undefined : undefined,
    },
    sourceKind,
    bindingRef,
    revisionToken,
    updatedAt,
  };
}

function loadScopeIndex(storage: Storage): string[] {
  try {
    const raw = storage.getItem(SCOPE_INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === 'string');
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function persistScopeIndex(storage: Storage, scopeKeys: string[]): void {
  try {
    storage.setItem(SCOPE_INDEX_KEY, JSON.stringify(scopeKeys));
  } catch {
    // ignore
  }
}

function ensureScopeInIndex(storage: Storage, scopeKey: string): void {
  const index = loadScopeIndex(storage);
  if (!index.includes(scopeKey)) {
    index.push(scopeKey);
    persistScopeIndex(storage, index);
  }
}

export function loadMemoryEmbeddingConfigForScope(scopeRef: AIScopeRef): MemoryEmbeddingConfig {
  const storage = getStorage();
  if (!storage) {
    return createEmptyMemoryEmbeddingConfig(scopeRef);
  }
  const key = scopeKeyFromRef(scopeRef);
  try {
    const raw = storage.getItem(storageKeyForScope(key));
    if (raw) {
      const parsed = normalizeMemoryEmbeddingConfig(JSON.parse(raw));
      if (parsed) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return createEmptyMemoryEmbeddingConfig(scopeRef);
}

export function persistMemoryEmbeddingConfigForScope(config: MemoryEmbeddingConfig): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  const key = scopeKeyFromRef(config.scopeRef);
  try {
    storage.setItem(storageKeyForScope(key), JSON.stringify(config));
    ensureScopeInIndex(storage, key);
  } catch {
    // ignore
  }
}

export function listPersistedMemoryEmbeddingScopeKeys(): string[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  return loadScopeIndex(storage);
}

export function parseMemoryEmbeddingScopeKey(key: string): AIScopeRef | null {
  const parts = key.split(':');
  if (parts.length !== 3) {
    return null;
  }
  const decodedKind = decodeScopeSegment(parts[0] ?? '');
  const decodedOwnerId = decodeScopeSegment(parts[1] ?? '');
  const decodedSurfaceId = decodeScopeSegment(parts[2] ?? '');
  if (decodedKind === null || decodedOwnerId === null || decodedSurfaceId === null) {
    return null;
  }
  const kind = decodedKind as AIScopeRef['kind'];
  const ownerId = decodedOwnerId;
  const surfaceId = decodedSurfaceId || undefined;
  if (!kind || !ownerId) {
    return null;
  }
  return { kind, ownerId, surfaceId };
}
