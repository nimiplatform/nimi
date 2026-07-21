export interface DesktopRendererLocalModelProgressPort {
  loadDismissedSessionIds(): readonly string[];
  persistDismissedSessionIds(sessionIds: readonly string[]): void;
  claimSetupAutodiscover(): boolean;
}

export function createMemoryDesktopRendererLocalModelProgressPort(): DesktopRendererLocalModelProgressPort {
  let dismissed: readonly string[] = [];
  let setupAutodiscoverClaimed = false;
  return Object.freeze({
    loadDismissedSessionIds: () => [...dismissed],
    persistDismissedSessionIds(sessionIds: readonly string[]) {
      dismissed = [...sessionIds];
    },
    claimSetupAutodiscover() {
      if (setupAutodiscoverClaimed) return false;
      setupAutodiscoverClaimed = true;
      return true;
    },
  });
}
