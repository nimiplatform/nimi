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
