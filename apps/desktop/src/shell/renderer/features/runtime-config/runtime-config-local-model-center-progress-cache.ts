import { loadStorageJsonFrom, saveStorageJsonTo } from '@nimiplatform/sdk/mod';
import type { ProgressSessionState } from './runtime-config-model-center-utils';

const downloadSessionSnapshotCache: Record<string, ProgressSessionState> = {};
const DISMISSED_SESSION_STORAGE_KEY = 'nimi.runtime.local-model-center.dismissed-transfer-sessions.v1';
const DISMISSED_SESSION_LIMIT = 200;

export function getCachedProgressSessions(): Record<string, ProgressSessionState> {
  return { ...downloadSessionSnapshotCache };
}

export function cacheProgressSessions(
  sessions: Record<string, ProgressSessionState>,
): Record<string, ProgressSessionState> {
  for (const sessionId of Object.keys(downloadSessionSnapshotCache)) {
    if (!(sessionId in sessions)) {
      delete downloadSessionSnapshotCache[sessionId];
    }
  }
  Object.assign(downloadSessionSnapshotCache, sessions);
  return sessions;
}

// ---------------------------------------------------------------------------
// Dismissed session IDs — persisted so dismissed failed sessions stay hidden
// across component remounts and page reloads.
// ---------------------------------------------------------------------------

type DismissedTransferSessionStorageRecord = {
  version: 1;
  installSessionIds: string[];
};

function resolveStorage(): Storage | undefined {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis === 'undefined') {
    return undefined;
  }
  return globalThis.localStorage as Storage | undefined;
}

function normalizeDismissedSessionIds(value: unknown): string[] {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<DismissedTransferSessionStorageRecord>).installSessionIds
    : value;
  if (!Array.isArray(raw)) {
    return [];
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const installSessionId = String(item || '').trim();
    if (!installSessionId || seen.has(installSessionId)) {
      continue;
    }
    seen.add(installSessionId);
    normalized.push(installSessionId);
  }
  return normalized.slice(-DISMISSED_SESSION_LIMIT);
}

function loadDismissedSessionIds(): string[] {
  return normalizeDismissedSessionIds(
    loadStorageJsonFrom(resolveStorage(), DISMISSED_SESSION_STORAGE_KEY),
  );
}

function persistDismissedSessionIds(sessionIds: Iterable<string>): void {
  const installSessionIds = normalizeDismissedSessionIds([...sessionIds]);
  saveStorageJsonTo(resolveStorage(), DISMISSED_SESSION_STORAGE_KEY, {
    version: 1,
    installSessionIds,
  } satisfies DismissedTransferSessionStorageRecord);
}

const dismissedSessionIdsCache = new Set<string>(loadDismissedSessionIds());

export function getDismissedSessionIds(): Set<string> {
  return dismissedSessionIdsCache;
}

export function addDismissedSessionId(installSessionId: string): void {
  const normalized = String(installSessionId || '').trim();
  if (!normalized) {
    return;
  }
  if (dismissedSessionIdsCache.has(normalized)) {
    return;
  }
  dismissedSessionIdsCache.add(normalized);
  persistDismissedSessionIds(dismissedSessionIdsCache);
}

export function removeDismissedSessionId(installSessionId: string): void {
  const normalized = String(installSessionId || '').trim();
  if (!normalized || !dismissedSessionIdsCache.delete(normalized)) {
    return;
  }
  persistDismissedSessionIds(dismissedSessionIdsCache);
}
