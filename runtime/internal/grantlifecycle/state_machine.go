package grantlifecycle

import "fmt"

// allowedTransitions enumerates the canonical grant lifecycle
// transition graph per grant-service.md. Each map[from][to] entry is
// admitted; all others are rejected.
var allowedTransitions = map[GrantState]map[GrantState]bool{
	GrantStatePending: {
		GrantStateGranted: true,
		GrantStateDenied:  true,
		GrantStateExpired: true,
	},
	GrantStateGranted: {
		GrantStateRevoked:    true,
		GrantStateExpired:    true,
		GrantStateSuperseded: true,
	},
	GrantStateDenied: {
		GrantStatePending: true,
	},
}

// Transition returns a Grant with State advanced to next, validating
// the transition is canonical. Terminal states cannot transition.
// Fail-closed: unknown next state or non-canonical transition returns
// a wrapped error and the original Grant unchanged.
func Transition(grant *Grant, next GrantState, atUnix int64, detail string) (*Grant, error) {
	if grant == nil {
		return nil, fmt.Errorf("grantlifecycle Transition: %w", ErrGrantRequired)
	}
	if !next.Valid() {
		return nil, fmt.Errorf("grantlifecycle Transition: %w: %q", ErrGrantUnknownState, string(next))
	}
	if grant.State.IsTerminal() {
		return nil, fmt.Errorf("grantlifecycle Transition (%q→%q): %w",
			string(grant.State), string(next), ErrGrantTerminalLocked)
	}
	allowed, ok := allowedTransitions[grant.State]
	if !ok || !allowed[next] {
		return nil, fmt.Errorf("grantlifecycle Transition (%q→%q): %w",
			string(grant.State), string(next), ErrGrantInvalidTransition)
	}
	clone := *grant
	clone.State = next
	clone.LastTransition = atUnix
	clone.Detail = detail
	return &clone, nil
}

func RevokeGranted(grant *Grant, atUnix int64, detail string) (*Grant, error) {
	if grant == nil {
		return nil, fmt.Errorf("grantlifecycle RevokeGranted: %w", ErrGrantRequired)
	}
	return Transition(grant, GrantStateRevoked, atUnix, detail)
}

// CanonicalGrantStates returns the full canonical enum in catalog
// order, useful for tests and consumers that need to enumerate the
// closed set without consulting spec yaml.
func CanonicalGrantStates() []GrantState {
	return []GrantState{
		GrantStatePending,
		GrantStateGranted,
		GrantStateDenied,
		GrantStateExpired,
		GrantStateRevoked,
		GrantStateSuperseded,
	}
}
