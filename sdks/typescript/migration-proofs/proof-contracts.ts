export type NimiMigrationProofStatus = 'passed' | 'failed';

export interface NimiMigrationProofResult {
  readonly proofId: string;
  readonly appShape: string;
  readonly status: NimiMigrationProofStatus;
  readonly migratedBy: 'adapter-model-replacement' | 'adapter-route-replacement' | 'source-root-adapter-contract';
  readonly adapterIds: readonly string[];
  readonly observedCapabilities: readonly string[];
  readonly evidence: readonly string[];
}

export function assertProofPassed(proof: NimiMigrationProofResult): void {
  if (proof.status !== 'passed') {
    throw new Error(`migration proof ${proof.proofId} failed`);
  }
}
