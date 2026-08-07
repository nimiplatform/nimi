// App Access probe state model: pure reducers and gating. Honesty rules live
// here — a probe that has not run under the current session/config never
// implies state, and evidence invalidated by a later overwrite falls back to
// not-run instead of going stale.

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

function resetProbe(states: AppAccessProbeStates, id: AppAccessProbeId): AppAccessProbeStates {
  return states[id].status === 'not-run' ? states : withProbe(states, id, initialProbeState);
}

export function applyProbeStart(states: AppAccessProbeStates, id: AppAccessProbeId): AppAccessProbeStates {
  return withProbe(states, id, {
    status: 'running',
    headline: appAccessProbeById[id].running,
    facts: [],
  });
}

// Evidence invalidation: an AIConfig overwrite replaces the whole config, so
// evidence that described the replaced config must not survive it.
// - portable-ai-config passed  → cloud-posture evidence (grantless intent persisted) is stale
// - cloud-posture passed       → portable-ai-config + local-text evidence (committed Local route) is stale
const aiConfigInvalidation: Partial<Record<AppAccessProbeId, readonly AppAccessProbeId[]>> = {
  'portable-ai-config': ['cloud-posture'],
  'cloud-posture': ['portable-ai-config', 'local-text'],
};

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
      headline: outcome.headline,
      facts: [],
      reasonCode: outcome.reasonCode,
      detail: outcome.detail,
    });
  }
  if (outcome.ok === true) {
    for (const stale of aiConfigInvalidation[id] ?? []) {
      next = resetProbe(next, stale);
    }
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
  readonly cloudDraftComplete: boolean;
  readonly agentReferenceSelected: boolean;
};

export type AppAccessGate =
  | { readonly runnable: true }
  | { readonly runnable: false; readonly guidance: string };

export function resolveProbeGate(
  id: AppAccessProbeId,
  states: AppAccessProbeStates,
  context: AppAccessGateContext,
): AppAccessGate {
  if (!context.sessionBound) {
    return { runnable: false, guidance: appAccessPageCopy.signedOut };
  }
  const gate = appAccessProbeById[id].gate;
  if (!gate) return { runnable: true };
  switch (gate.kind) {
    case 'probe-passed':
      return gate.probe && states[gate.probe].status === 'passed'
        ? { runnable: true }
        : { runnable: false, guidance: gate.guidance };
    case 'cloud-draft':
      return context.cloudDraftComplete
        ? { runnable: true }
        : { runnable: false, guidance: gate.guidance };
    case 'agent-selection':
      return context.agentReferenceSelected
        ? { runnable: true }
        : { runnable: false, guidance: gate.guidance };
  }
}

export function planGroupRun(groupId: AppAccessGroupId): readonly AppAccessProbeId[] {
  const group = appAccessGroups.find((candidate) => candidate.id === groupId);
  return group ? group.probes : [];
}

export function planRunAll(): readonly AppAccessProbeId[] {
  return appAccessGroups.flatMap((group) => group.probes);
}
