// App Access probe state model: pure reducers and gating. Honesty rules live
// here — a probe that has not run under the current session never implies
// state, and session loss clears evidence instead of leaving it stale.

import {
  appAccessGroups,
  appAccessPageCopy,
  appAccessProbeById,
  appAccessProbes,
  type AppAccessGroupId,
  type AppAccessProbeId,
} from './app-access-catalog.js';
import type { AppAccessProbeOutcome } from './app-access-probes.js';

export type AppAccessProbeStatus = 'not-run' | 'running' | 'passed' | 'failed';

export type AppAccessProbeState = {
  readonly status: AppAccessProbeStatus;
  // Passed headlines are literal run evidence; not-run/running/failed headlines
  // are catalog i18n keys the probe card resolves through t() at render time.
  readonly headline: string;
  readonly facts: readonly string[];
  readonly reasonCode?: string;
  readonly detail?: string;
};

export type AppAccessProbeStates = Readonly<Record<AppAccessProbeId, AppAccessProbeState>>;

const initialProbeState: AppAccessProbeState = {
  status: 'not-run',
  headline: appAccessPageCopy.notRun,
  facts: [],
};

export function createInitialProbeStates(): AppAccessProbeStates {
  return Object.fromEntries(
    appAccessProbes.map((definition) => [definition.id, initialProbeState]),
  ) as Record<AppAccessProbeId, AppAccessProbeState>;
}

function withProbe(
  states: AppAccessProbeStates,
  id: AppAccessProbeId,
  next: AppAccessProbeState,
): AppAccessProbeStates {
  return { ...states, [id]: next };
}

export function applyProbeStart(states: AppAccessProbeStates, id: AppAccessProbeId): AppAccessProbeStates {
  return withProbe(states, id, {
    status: 'running',
    headline: appAccessProbeById[id].runningKey,
    facts: [],
  });
}

export function applyProbeOutcome(
  states: AppAccessProbeStates,
  id: AppAccessProbeId,
  outcome: AppAccessProbeOutcome,
): AppAccessProbeStates {
  let next: AppAccessProbeStates;
  if (outcome.ok === true) {
    next = withProbe(states, id, { status: 'passed', headline: outcome.headline, facts: outcome.facts });
  } else {
    next = withProbe(states, id, {
      status: 'failed',
      headline: outcome.headlineKey,
      facts: [],
      reasonCode: outcome.reasonCode,
      detail: outcome.detail,
    });
  }
  return next;
}

// Session loss: every probe's evidence belonged to the lost session, so the
// whole board falls back to not-run rather than implying state it cannot back.
export function applySessionLoss(states: AppAccessProbeStates): AppAccessProbeStates {
  return createInitialProbeStates();
}

export type AppAccessGateContext = {
  readonly sessionBound: boolean;
  readonly agentReferenceSelected: boolean;
};

export type AppAccessGate =
  | { readonly runnable: true }
  | { readonly runnable: false; readonly guidanceKey: string };

export function resolveProbeGate(
  id: AppAccessProbeId,
  _states: AppAccessProbeStates,
  context: AppAccessGateContext,
): AppAccessGate {
  if (!context.sessionBound) {
    return { runnable: false, guidanceKey: appAccessPageCopy.signedOut };
  }
  const gate = appAccessProbeById[id].gate;
  if (!gate) return { runnable: true };
  switch (gate.kind) {
    case 'agent-selection':
      return context.agentReferenceSelected
        ? { runnable: true }
        : { runnable: false, guidanceKey: gate.guidanceKey };
  }
}

export function planGroupRun(groupId: AppAccessGroupId): readonly AppAccessProbeId[] {
  const group = appAccessGroups.find((candidate) => candidate.id === groupId);
  return group ? group.probes : [];
}

export function planRunAll(): readonly AppAccessProbeId[] {
  return appAccessGroups.flatMap((group) => group.probes);
}
