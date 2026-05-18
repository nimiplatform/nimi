// DefaultExperienceBridge — Desktop-side typed boundary that applies a
// Default Experience Profile and projects cold-start readiness through
// the admitted Runtime public surface (RuntimeAdapter).
//
// Fail-closed semantics per P-COLD-001 and P-DXP-008: any adapter
// failure projects an explicit non-ready state; the bridge never
// projects ready when an upstream is not ready and never embeds
// provider/connector/engine/model identifier string constants.

import type { RuntimeAdapter } from './runtime-adapter.js';
import type {
  ApplicableScope,
  ApplyResult,
  BridgeResult,
  ColdStartProjection,
  ColdStartState,
  ProfilePreferences,
  ScopeRef,
  UpstreamInputs,
} from './types.js';

export class DefaultExperienceBridge {
  constructor(private readonly runtime: RuntimeAdapter) {
    if (runtime === null || runtime === undefined) {
      throw new Error('DefaultExperienceBridge: runtime adapter is required');
    }
  }

  /**
   * Recommend a Default Experience Profile for the current host + scope and
   * apply it via the adapter's atomic aiProfile.apply path. Returns
   * BridgeResult; callers must inspect status before treating the apply
   * as successful.
   */
  async applyDefaultProfile(
    scopeRef: ScopeRef,
    scope: ApplicableScope,
    preferences?: ProfilePreferences,
  ): Promise<BridgeResult<ApplyResult>> {
    let recommended;
    try {
      recommended = await this.runtime.recommendProfile(scope, preferences);
    } catch (error) {
      return {
        status: 'blocked',
        state: 'unavailable',
        detail: `recommendProfile failed: ${errorMessage(error)}`,
      };
    }
    if (!recommended || typeof recommended.alias !== 'string' || recommended.alias.length === 0) {
      return {
        status: 'blocked',
        state: 'failed',
        detail: 'recommendProfile returned no profile alias',
      };
    }
    let applied;
    try {
      applied = await this.runtime.applyProfile(scopeRef, recommended.alias);
    } catch (error) {
      return {
        status: 'blocked',
        state: 'failed',
        detail: `applyProfile failed: ${errorMessage(error)}`,
      };
    }
    if (!applied || applied.applied !== true) {
      return {
        status: 'blocked',
        state: 'failed',
        detail: 'applyProfile returned non-applied result',
      };
    }
    return { status: 'applied', value: applied };
  }

  /**
   * Project the current cold-start readiness using upstream inputs. Any
   * adapter failure projects fail-closed; never projects ready unless
   * all upstreams are ready and the adapter agrees.
   */
  async projectReadiness(inputs: UpstreamInputs): Promise<ColdStartProjection> {
    if (!hasReadyAllUpstreams(inputs)) {
      const worst = pickWorstUpstream(inputs);
      return {
        state: worst.state,
        reasonOwner: worst.owner,
        detail: `upstream ${worst.owner} reports state "${worst.state}"`,
      };
    }
    try {
      const projection = await this.runtime.projectColdStart(inputs);
      if (projection && isCanonicalState(projection.state)) {
        return projection;
      }
      return {
        state: 'unavailable',
        detail: 'projectColdStart returned non-canonical state',
      };
    } catch (error) {
      return {
        state: 'unavailable',
        detail: `projectColdStart failed: ${errorMessage(error)}`,
      };
    }
  }
}

const canonicalStates: readonly ColdStartState[] = [
  'unavailable',
  'setup-required',
  'needs-confirmation',
  'in-progress',
  'failed',
  'unsupported',
  'stale-projection',
  'ready',
];

const statePriority: readonly ColdStartState[] = [
  'unsupported',
  'failed',
  'unavailable',
  'stale-projection',
  'setup-required',
  'needs-confirmation',
  'in-progress',
  'ready',
];

function priorityIndex(state: ColdStartState): number {
  const idx = statePriority.indexOf(state);
  return idx >= 0 ? idx : -1;
}

function isCanonicalState(value: unknown): value is ColdStartState {
  return typeof value === 'string' && canonicalStates.includes(value as ColdStartState);
}

function hasReadyAllUpstreams(inputs: UpstreamInputs): boolean {
  // Strict equality on canonical 'ready' string — any non-canonical
  // value (including casts past the type system) fails this check and
  // forces fail-closed projection downstream.
  return (
    inputs.runtimeDaemon === 'ready' &&
    inputs.account === 'ready' &&
    inputs.defaultExperienceProfile === 'ready' &&
    inputs.materialization === 'ready' &&
    inputs.appRegistry === 'ready' &&
    inputs.cognitionMemory === 'ready'
  );
}

// normalizeStateOrUnavailable enforces canonical state at runtime even
// when inputs cross from untrusted/cast boundaries. Non-canonical
// values fail closed to 'unavailable' rather than leaking through to
// the consumer.
function normalizeStateOrUnavailable(state: ColdStartState): ColdStartState {
  return isCanonicalState(state) ? state : 'unavailable';
}

function pickWorstUpstream(inputs: UpstreamInputs): { owner: string; state: ColdStartState } {
  const entries: ReadonlyArray<{ owner: string; state: ColdStartState }> = [
    { owner: 'runtime-daemon', state: normalizeStateOrUnavailable(inputs.runtimeDaemon) },
    { owner: 'account', state: normalizeStateOrUnavailable(inputs.account) },
    { owner: 'default-experience-profile', state: normalizeStateOrUnavailable(inputs.defaultExperienceProfile) },
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
  return worst;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'unknown error';
}
