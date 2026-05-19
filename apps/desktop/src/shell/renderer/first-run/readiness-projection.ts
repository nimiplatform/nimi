// First-Run Readiness Projection logic.
//
// Pure function that takes an `UpstreamInputs` snapshot and returns a
// `FirstRunReadinessProjection` suitable for React rendering.
// Fail-closed: if any upstream is not strictly `ready`, the projection
// surfaces the worst-state upstream and never claims `ready`.

import type {
  ColdStartProjection,
  ColdStartState,
  UpstreamInputs,
} from './types.js';
import { FIRST_RUN_STEPS, type FirstRunReadinessProjection, type FirstRunStep, type FirstRunStepProjection } from './types.js';

const STATE_PRIORITY: readonly ColdStartState[] = [
  'unsupported',
  'failed',
  'unavailable',
  'stale-projection',
  'setup-required',
  'needs-confirmation',
  'in-progress',
  'ready',
];

const CANONICAL_STATES: ReadonlySet<ColdStartState> = new Set(STATE_PRIORITY);

function isCanonicalState(value: unknown): value is ColdStartState {
  return typeof value === 'string' && CANONICAL_STATES.has(value as ColdStartState);
}

function normalizeStateOrUnavailable(state: ColdStartState): ColdStartState {
  return isCanonicalState(state) ? state : 'unavailable';
}

function priorityIndex(state: ColdStartState): number {
  const idx = STATE_PRIORITY.indexOf(state);
  return idx >= 0 ? idx : -1;
}

function pickStateForStep(inputs: UpstreamInputs, step: FirstRunStep): ColdStartState {
  switch (step) {
    case 'runtimeDaemon': return inputs.runtimeDaemon;
    case 'account': return inputs.account;
    case 'productControlRecord': return inputs.productControlRecord;
    case 'dataRoot': return inputs.dataRoot;
    case 'aiProfileSelection': return inputs.aiProfileSelection;
    case 'materialization': return inputs.materialization;
    case 'appRegistry': return inputs.appRegistry;
    case 'cognitionMemory': return inputs.cognitionMemory;
  }
}

function aggregateOverall(inputs: UpstreamInputs): ColdStartProjection {
  const entries: ReadonlyArray<{ owner: string; state: ColdStartState }> = [
    { owner: 'runtime-daemon', state: normalizeStateOrUnavailable(inputs.runtimeDaemon) },
    { owner: 'account', state: normalizeStateOrUnavailable(inputs.account) },
    { owner: 'product-control-record', state: normalizeStateOrUnavailable(inputs.productControlRecord) },
    { owner: 'data-root', state: normalizeStateOrUnavailable(inputs.dataRoot) },
    { owner: 'ai-profile-selection', state: normalizeStateOrUnavailable(inputs.aiProfileSelection) },
    { owner: 'materialization', state: normalizeStateOrUnavailable(inputs.materialization) },
    { owner: 'app-registry', state: normalizeStateOrUnavailable(inputs.appRegistry) },
    { owner: 'cognition-memory', state: normalizeStateOrUnavailable(inputs.cognitionMemory) },
  ];
  let worst = entries[0]!;
  for (const candidate of entries) {
    if (priorityIndex(candidate.state) < priorityIndex(worst.state)) {
      worst = candidate;
    }
  }
  if (worst.state === 'ready') {
    return { state: 'ready' };
  }
  return {
    state: worst.state,
    reasonOwner: worst.owner,
    detail: `upstream ${worst.owner} reports state "${worst.state}"`,
  };
}

/**
 * Compute the first-run readiness projection for the current
 * `UpstreamInputs`. Returns an `isReady: true` result only when every
 * upstream reports `ready`.
 */
export async function projectFirstRunReadiness(inputs: UpstreamInputs): Promise<FirstRunReadinessProjection> {
  const overall = aggregateOverall(inputs);
  const steps: FirstRunStepProjection[] = FIRST_RUN_STEPS.map((step) => ({
    step,
    state: pickStateForStep(inputs, step),
  }));
  return {
    overall,
    steps,
    isReady: inputs.readyForUse && overall.state === 'ready' && steps.every((s) => s.state === 'ready'),
  };
}
