import { DESIGN_STATES, TERMINAL_STATES } from "./common.mjs";

const TRANSITIONS = new Map([
  ["raw", new Set(["confirmed", "duplicate", "superseded", "false_positive", "needs_more_audit"])],
  ["confirmed", new Set([
    "needs_user_decision",
    "needs_authority_alignment",
    "needs_design",
    "ready_for_implementation_wave",
    "blocked",
  ])],
  ["needs_more_audit", new Set(["confirmed", "false_positive", "superseded", "blocked"])],
  ["needs_user_decision", new Set(["confirmed", "ready_for_implementation_wave", "blocked"])],
  ["needs_authority_alignment", new Set(["confirmed", "ready_for_implementation_wave", "blocked"])],
  ["needs_design", new Set(["confirmed", "ready_for_implementation_wave", "blocked"])],
  ["ready_for_implementation_wave", new Set(["blocked"])],
]);

function needsUserGate(toState) {
  return toState === "false_positive";
}

function needsNextArtifact(fromState, toState) {
  return fromState.startsWith("needs_") || [
    "needs_more_audit",
    "needs_user_decision",
    "needs_authority_alignment",
    "needs_design",
    "ready_for_implementation_wave",
  ].includes(toState);
}

export function validateLifecycleTransition({ fromState, toState, userGateRef, nextArtifactRef }) {
  if (!DESIGN_STATES.has(fromState) || !DESIGN_STATES.has(toState)) {
    return `unsupported lifecycle transition ${fromState} -> ${toState}`;
  }
  if (TERMINAL_STATES.has(fromState)) {
    return `terminal finding state cannot transition: ${fromState}`;
  }
  if (!TRANSITIONS.get(fromState)?.has(toState)) {
    return `illegal lifecycle transition ${fromState} -> ${toState}`;
  }
  if (needsUserGate(toState) && !userGateRef) {
    return `${toState} requires --user-gate-ref`;
  }
  if (needsNextArtifact(fromState, toState) && !nextArtifactRef) {
    return `${fromState} -> ${toState} requires --next-artifact-ref`;
  }
  return null;
}

export function terminalStates() {
  return [...TERMINAL_STATES].sort();
}
