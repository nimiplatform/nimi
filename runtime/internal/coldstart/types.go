// Package coldstart implements the typed cold-start state projection
// per .nimi/spec/platform/kernel/cold-start-authority-contract.md
// (P-COLD-001..P-COLD-008).
//
// Cold start spans the time between process launch and when all
// upstream authorities (Runtime daemon, account, factory AIProfile
// selection, materialization, app registry, cognition memory) report
// ready. The package enforces P-COLD-001's closed enum of allowed
// fail-closed states and forbids projecting empty success or
// best-effort-ready.
package coldstart

import "errors"

// State enumerates the P-COLD-001 closed enum of allowed cold-start
// projection states.
type State string

const (
	StateUnavailable      State = "unavailable"
	StateSetupRequired    State = "setup-required"
	StateNeedsConfirmation State = "needs-confirmation"
	StateInProgress       State = "in-progress"
	StateFailed           State = "failed"
	StateUnsupported      State = "unsupported"
	StateStaleProjection  State = "stale-projection"
	StateReady            State = "ready"
)

// Valid reports whether the state is one of the P-COLD-001 allowed
// values (including the terminal `ready` state).
func (s State) Valid() bool {
	switch s {
	case StateUnavailable, StateSetupRequired, StateNeedsConfirmation,
		StateInProgress, StateFailed, StateUnsupported, StateStaleProjection,
		StateReady:
		return true
	}
	return false
}

// IsNonReady reports whether the state represents a non-ready
// projection per P-COLD-001's fail-closed set.
func (s State) IsNonReady() bool {
	switch s {
	case StateUnavailable, StateSetupRequired, StateNeedsConfirmation,
		StateInProgress, StateFailed, StateUnsupported, StateStaleProjection:
		return true
	}
	return false
}

// UpstreamInputs collects the readiness reported by each cold-start
// upstream authority owner. Each field carries one of the canonical
// States. An empty value (zero String) is treated as `unavailable` to
// enforce fail-closed semantics.
type UpstreamInputs struct {
	RuntimeDaemon      State
	Account            State
	AIProfileSelection State
	Materialization    State
	AppRegistry        State
	CognitionMemory    State
}

// Projection is the aggregated cold-start state plus the upstream input
// that produced it. ReasonOwner names which upstream authority is the
// reason for the projection (when the projection is non-ready).
type Projection struct {
	State       State
	ReasonOwner string
	Detail      string
}

// Sentinel errors.
var (
	ErrUnknownUpstreamState = errors.New("coldstart unknown upstream state")
)
