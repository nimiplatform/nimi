import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import type { DesktopRendererLocalModelProgressPort } from '../../renderer/local-model-progress-port.js';

const STORAGE_KEY = 'nimi.runtime.local-model-center.dismissed-transfer-sessions.v1';

function normalize(value: unknown): string[] {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { installSessionIds?: unknown }).installSessionIds
    : value;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))].slice(-200);
}

export function createDesktopProductionLocalModelProgressPort(): DesktopRendererLocalModelProgressPort {
  let setupAutodiscoverClaimed = false;
  return Object.freeze({
    loadDismissedSessionIds() {
      const result = readStorageJsonFrom(resolveBrowserStorage('local'), STORAGE_KEY);
      return normalize(result.state === 'ready' ? result.value : null);
    },
    persistDismissedSessionIds(sessionIds: readonly string[]) {
      writeStorageJsonTo(resolveBrowserStorage('local'), STORAGE_KEY, {
        version: 1,
        installSessionIds: normalize(sessionIds),
      });
    },
    claimSetupAutodiscover() {
      if (setupAutodiscoverClaimed) return false;
      setupAutodiscoverClaimed = true;
      return true;
    },
  });
}
