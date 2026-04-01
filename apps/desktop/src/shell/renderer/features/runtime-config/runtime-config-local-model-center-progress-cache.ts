import type { ProgressSessionState } from './runtime-config-model-center-utils';

const downloadSessionSnapshotCache: Record<string, ProgressSessionState> = {};

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

const dismissedSessionIdsCache = new Set<string>();

export function getDismissedSessionIds(): Set<string> {
  return dismissedSessionIdsCache;
}

export function addDismissedSessionId(installSessionId: string): void {
  dismissedSessionIdsCache.add(installSessionId);
}

export function removeDismissedSessionId(installSessionId: string): void {
  dismissedSessionIdsCache.delete(installSessionId);
}
