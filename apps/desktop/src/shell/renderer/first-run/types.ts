// First-Run Readiness Projection — view-model types.
//
// Local definitions for `ColdStartState`, `ColdStartProjection`, and
// `UpstreamInputs`. Canonical state values mirror `P-COLD-001` exactly.

export type ColdStartState =
  | 'unavailable'
  | 'setup-required'
  | 'needs-confirmation'
  | 'in-progress'
  | 'failed'
  | 'unsupported'
  | 'stale-projection'
  | 'ready';

export interface ColdStartProjection {
  readonly state: ColdStartState;
  readonly reasonOwner?: string;
  readonly detail?: string;
}

export interface UpstreamInputs {
  readonly runtimeDaemon: ColdStartState;
  readonly account: ColdStartState;
  readonly productControlRecord: ColdStartState;
  readonly dataRoot: ColdStartState;
  readonly aiProfileSelection: ColdStartState;
  readonly materialization: ColdStartState;
  readonly appRegistry: ColdStartState;
  readonly cognitionMemory: ColdStartState;
  readonly readyForUse: boolean;
}

// FirstRunStep enumerates the upstream owners surfaced in first-run UI.
// Mirrors `UpstreamInputs` fields plus stable display ordering.
export const FIRST_RUN_STEPS = [
  'runtimeDaemon',
  'account',
  'productControlRecord',
  'dataRoot',
  'aiProfileSelection',
  'materialization',
  'appRegistry',
  'cognitionMemory',
] as const;

export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];

export interface FirstRunStepProjection {
  readonly step: FirstRunStep;
  readonly state: ColdStartState;
  readonly detail?: string;
}

export interface FirstRunReadinessProjection {
  readonly overall: ColdStartProjection;
  readonly steps: readonly FirstRunStepProjection[];
  readonly isReady: boolean;
}
