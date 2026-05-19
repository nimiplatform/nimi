package coldstart

import "fmt"

// statePriority orders states from most-severe to least-severe for
// worst-state-wins aggregation. Worse states preempt better ones to
// preserve fail-closed semantics per P-COLD-001.
var statePriority = []State{
	StateUnsupported,      // hard hardware/runtime gap
	StateFailed,           // explicit failure
	StateUnavailable,      // upstream not reachable
	StateStaleProjection,  // bounded staleness, unconfirmed
	StateSetupRequired,    // dependency missing
	StateNeedsConfirmation, // user confirmation pending
	StateInProgress,       // active progress
	StateReady,            // all good
}

func priorityIndex(state State) int {
	for index, candidate := range statePriority {
		if candidate == state {
			return index
		}
	}
	return -1
}

func normalizeUpstream(state State) State {
	if state == "" {
		return StateUnavailable
	}
	return state
}

// Aggregate folds the upstream inputs into a single canonical cold-start
// Projection using worst-state-wins. Any unknown (non-canonical, non-empty)
// upstream state returns an error to enforce fail-closed behavior.
//
// The owner labels in the returned Projection identify which upstream
// authority dictated the result; ready aggregation reports an empty
// owner because no single authority owns the ready state.
func Aggregate(inputs UpstreamInputs) (Projection, error) {
	type entry struct {
		owner string
		state State
	}
	entries := []entry{
		{owner: "runtime-daemon", state: normalizeUpstream(inputs.RuntimeDaemon)},
		{owner: "account", state: normalizeUpstream(inputs.Account)},
		{owner: "ai-profile-selection", state: normalizeUpstream(inputs.AIProfileSelection)},
		{owner: "materialization", state: normalizeUpstream(inputs.Materialization)},
		{owner: "app-registry", state: normalizeUpstream(inputs.AppRegistry)},
		{owner: "cognition-memory", state: normalizeUpstream(inputs.CognitionMemory)},
	}
	for _, candidate := range entries {
		if !candidate.state.Valid() {
			return Projection{}, fmt.Errorf("coldstart Aggregate (%s): %w: %q", candidate.owner, ErrUnknownUpstreamState, string(candidate.state))
		}
	}
	worst := entries[0]
	for _, candidate := range entries[1:] {
		if priorityIndex(candidate.state) < priorityIndex(worst.state) {
			worst = candidate
		}
	}
	if worst.state == StateReady {
		return Projection{State: StateReady}, nil
	}
	return Projection{
		State:       worst.state,
		ReasonOwner: worst.owner,
		Detail:      fmt.Sprintf("upstream %s reports state %q", worst.owner, string(worst.state)),
	}, nil
}
