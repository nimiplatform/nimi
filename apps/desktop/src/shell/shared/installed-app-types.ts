// Host projection only: no launch lease, PID, path, credential or session material.
export interface InstalledAppRun {
  readonly launchSelector: readonly number[];
  readonly state: 'launching' | 'running' | 'stopping' | 'stopped' | 'crashed';
  readonly accessAvailable: boolean;
  readonly accessReasonCode: string;
  readonly message: string;
  readonly reasonCode?: string;
}
