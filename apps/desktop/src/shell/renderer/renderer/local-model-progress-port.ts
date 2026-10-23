export interface DesktopRendererLocalModelProgressPort {
  loadDismissedSessionIds(): readonly string[];
  persistDismissedSessionIds(sessionIds: readonly string[]): void;
  claimSetupAutodiscover(): boolean;
}
