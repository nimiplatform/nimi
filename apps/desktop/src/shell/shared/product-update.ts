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
  maintenanceAvailable?: boolean;
}>;

export type ProductRetentionEntry = Readonly<{
  version: string; path: string; identitySha256: string; directoryId: string;
  logicalBytes: number; complete: boolean; eligible: boolean; reason: string;
}>;
export type ProductRetentionPreview = Readonly<{
  currentVersion: string; runtimeVersion: string; entries: ProductRetentionEntry[];
}>;
export type ProductRetentionResult = Readonly<{
  results: Array<{ version: string; deletedBytes: number; removed: boolean; reason: string }>;
}>;
