export type ProductUpdatePhase = 'idle' | 'checking' | 'current' | 'unavailable' | 'downloading' | 'verifying' | 'prepared' | 'failed' | 'canceled' | 'unsupported'
  | 'quiescing' | 'handoff' | 'awaiting-activation' | 'completed' | 'recovery-required';
export type ProductUpdateStatus = Readonly<{
  phase: ProductUpdatePhase; currentVersion: string; channel: 'stable' | 'beta'; target: string;
  candidateVersion: string | null; releaseId: string | null;
  downloadedBytes: number; totalBytes: number; checkedAt: string | null;
  reason: string | null;
  // Requires a production native adapter plus fresh verified prepared state.
  installationAvailable: boolean;
  checkAvailable: boolean;
  recoveryAction: 'none' | 'reopen-current';
  recoveryError: string | null;
}>;
