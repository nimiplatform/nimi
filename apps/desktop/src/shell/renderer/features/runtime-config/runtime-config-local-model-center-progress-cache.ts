import type { DesktopRendererLocalModelProgressPort } from '../../renderer/local-model-progress-port.js';
import type { ProgressSessionState } from './runtime-config-model-center-utils';

export function createLocalModelCenterProgressCache(
  port: DesktopRendererLocalModelProgressPort,
) {
  let sessions: Record<string, ProgressSessionState> = {};
  const dismissedSessionIds = new Set(
    port.loadDismissedSessionIds().map((id) => String(id || '').trim()).filter(Boolean),
  );

  function persistDismissed(): void {
    port.persistDismissedSessionIds([...dismissedSessionIds]);
  }

  return Object.freeze({
    getProgressSessions: () => ({ ...sessions }),
    cacheProgressSessions(next: Record<string, ProgressSessionState>) {
      sessions = { ...next };
      return next;
    },
    getDismissedSessionIds: () => new Set(dismissedSessionIds),
    addDismissedSessionId(installSessionId: string) {
      const normalized = String(installSessionId || '').trim();
      if (!normalized || dismissedSessionIds.has(normalized)) return;
      dismissedSessionIds.add(normalized);
      persistDismissed();
    },
    removeDismissedSessionId(installSessionId: string) {
      const normalized = String(installSessionId || '').trim();
      if (!normalized || !dismissedSessionIds.delete(normalized)) return;
      persistDismissed();
    },
    clear() {
      sessions = {};
      dismissedSessionIds.clear();
    },
  });
}

export type LocalModelCenterProgressCache = ReturnType<typeof createLocalModelCenterProgressCache>;
