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
} from '@nimiplatform/sdk/runtime';
import { createEmptyMemoryEmbeddingConfig } from '@nimiplatform/sdk/runtime';
import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import type {
  AIScopeRef,
} from '@nimiplatform/sdk/scope';
import {
  encodeAIScopeRefKey,
  parseAIScopeRefKey,
} from '@nimiplatform/sdk/scope';

const SCOPE_INDEX_KEY = 'nimi.memory-embedding.scope-index.v1';
const SCOPE_CONFIG_PREFIX = 'nimi.memory-embedding.scope.';
const SCOPE_CONFIG_SUFFIX = '.v1';

function getStorage(): Storage | undefined {
  return resolveBrowserStorage('local') || undefined;
}

export function scopeKeyFromRef(ref: AIScopeRef): string {
  return encodeAIScopeRefKey(ref);
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
  const surfaceId = sr.surfaceId ? String(sr.surfaceId).trim() : '';
  return {
    scopeRef: surfaceId
      ? { kind: kind as AIScopeRef['kind'], ownerId, surfaceId }
      : { kind: kind as AIScopeRef['kind'], ownerId },
    sourceKind,
    bindingRef,
    revisionToken,
    updatedAt,
  };
}

function loadScopeIndex(storage: Storage): string[] {
  const result = readStorageJsonFrom(storage, SCOPE_INDEX_KEY);
  if (result.state === 'ready' && Array.isArray(result.value)) {
    return result.value.filter((value): value is string => typeof value === 'string');
  }
  return [];
}

function persistScopeIndex(storage: Storage, scopeKeys: string[]): void {
  writeStorageJsonTo(storage, SCOPE_INDEX_KEY, scopeKeys);
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
  const result = readStorageJsonFrom(storage, storageKeyForScope(key), normalizeMemoryEmbeddingConfig);
  if (result.state === 'ready' && result.value) {
    return result.value;
  }
  return createEmptyMemoryEmbeddingConfig(scopeRef);
}

export function persistMemoryEmbeddingConfigForScope(config: MemoryEmbeddingConfig): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  const key = scopeKeyFromRef(config.scopeRef);
  const result = writeStorageJsonTo(storage, storageKeyForScope(key), config);
  if (result.state === 'saved') {
    ensureScopeInIndex(storage, key);
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
  return parseAIScopeRefKey(key);
}
