// First-Run Readiness Projection logic.
//
// Pure function that takes the Wave 1 DefaultExperienceBridge and an
// UpstreamInputs snapshot, returns a FirstRunReadinessProjection
// suitable for React rendering. Fail-closed: when bridge throws or
// returns non-canonical state, the projection reports the upstream as
// `unavailable`, never `ready`.

import { DefaultExperienceBridge } from '../../../runtime/default-experience-bridge/index.js';
import type {
  ColdStartProjection,
  ColdStartState,
  UpstreamInputs,
} from '../../../runtime/default-experience-bridge/index.js';
import { FIRST_RUN_STEPS, type FirstRunReadinessProjection, type FirstRunStep, type FirstRunStepProjection } from './types.js';

function pickStateForStep(inputs: UpstreamInputs, step: FirstRunStep): ColdStartState {
  switch (step) {
    case 'runtimeDaemon': return inputs.runtimeDaemon;
    case 'account': return inputs.account;
    case 'defaultExperienceProfile': return inputs.defaultExperienceProfile;
    case 'materialization': return inputs.materialization;
    case 'appRegistry': return inputs.appRegistry;
    case 'cognitionMemory': return inputs.cognitionMemory;
  }
}

/**
 * Compute the first-run readiness projection for the current UpstreamInputs.
 *
 * The function calls `bridge.projectReadiness(inputs)` and combines the
 * resulting overall ColdStartProjection with per-step projections. When the
 * bridge call fails or yields a non-canonical overall state, the function
 * returns a projection with `isReady: false` and overall state `unavailable`.
 */
export async function projectFirstRunReadiness(
  bridge: DefaultExperienceBridge,
  inputs: UpstreamInputs,
): Promise<FirstRunReadinessProjection> {
  if (!bridge) {
    return buildFailClosed('first-run readiness: bridge is required', inputs);
  }
  let overall: ColdStartProjection;
  try {
    overall = await bridge.projectReadiness(inputs);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    return buildFailClosed(`first-run readiness: bridge.projectReadiness failed: ${detail}`, inputs);
  }
  const steps: FirstRunStepProjection[] = FIRST_RUN_STEPS.map((step) => ({
    step,
    state: pickStateForStep(inputs, step),
  }));
  return {
    overall,
    steps,
    isReady: overall.state === 'ready' && steps.every((s) => s.state === 'ready'),
  };
}

function buildFailClosed(detail: string, inputs: UpstreamInputs): FirstRunReadinessProjection {
  return {
    overall: { state: 'unavailable', detail },
    steps: FIRST_RUN_STEPS.map((step) => ({ step, state: pickStateForStep(inputs, step) })),
    isReady: false,
  };
}
