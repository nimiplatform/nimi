// First-Run Readiness Projection — view-model types.
//
// Re-exports the typed cold-start enum from the Wave 1 Desktop default-experience
// bridge so first-run UI components project canonical P-COLD-001 states only.

export type {
  ColdStartState,
  ColdStartProjection,
  UpstreamInputs,
} from '../../../runtime/default-experience-bridge/index.js';

// FirstRunStep enumerates the upstream owners surfaced in first-run UI.
// Mirrors `UpstreamInputs` fields plus stable display ordering.
export const FIRST_RUN_STEPS = [
  'runtimeDaemon',
  'account',
  'defaultExperienceProfile',
  'materialization',
  'appRegistry',
  'cognitionMemory',
] as const;

export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];

export interface FirstRunStepProjection {
  readonly step: FirstRunStep;
  readonly state: import('../../../runtime/default-experience-bridge/index.js').ColdStartState;
  readonly detail?: string;
}

export interface FirstRunReadinessProjection {
  readonly overall: import('../../../runtime/default-experience-bridge/index.js').ColdStartProjection;
  readonly steps: readonly FirstRunStepProjection[];
  readonly isReady: boolean;
}
