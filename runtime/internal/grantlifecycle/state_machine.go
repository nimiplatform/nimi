package grantlifecycle

import "fmt"

// allowedTransitions enumerates the canonical grant lifecycle
// transition graph per grant-service.md. Each map[from][to] entry is
// admitted; all others are rejected.
var allowedTransitions = map[GrantState]map[GrantState]bool{
	GrantStateRequested: {
		GrantStatePrompted: true,
		GrantStateDenied:   true,
		GrantStateFailed:   true,
	},
	GrantStatePrompted: {
		GrantStateGranted: true,
		GrantStateDenied:  true,
		GrantStateExpired: true,
		GrantStateFailed:  true,
	},
	GrantStateGranted: {
		GrantStateInUse:   true,
		GrantStateRevoked: true,
		GrantStateExpired: true,
		GrantStateFailed:  true,
	},
	GrantStateInUse: {
		GrantStateGranted: true, // back to idle granted state after execution completes
		GrantStateRevoked: true,
		GrantStateExpired: true,
		GrantStateFailed:  true,
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

// RevokeActive forces immediate revocation of an in-use grant. Per
// "revocation during use fails closed for streaming and background
// work" — this is the explicit fast-path that streaming/background
// consumers must call when revocation arrives mid-execution.
//
// If the grant is not in-use, returns ErrGrantNotInUse so callers can
// fall back to the regular Transition path.
func RevokeActive(grant *Grant, atUnix int64, detail string) (*Grant, error) {
	if grant == nil {
		return nil, fmt.Errorf("grantlifecycle RevokeActive: %w", ErrGrantRequired)
	}
	if grant.State != GrantStateInUse {
		return nil, fmt.Errorf("grantlifecycle RevokeActive: %w (current=%q)",
			ErrGrantNotInUse, string(grant.State))
	}
	clone := *grant
	clone.State = GrantStateRevoked
	clone.LastTransition = atUnix
	clone.Detail = detail
	return &clone, nil
}

// CanonicalGrantStates returns the full canonical enum in catalog
// order, useful for tests and consumers that need to enumerate the
// closed set without consulting spec yaml.
func CanonicalGrantStates() []GrantState {
	return []GrantState{
		GrantStateRequested,
		GrantStatePrompted,
		GrantStateGranted,
		GrantStateInUse,
		GrantStateRevoked,
		GrantStateExpired,
		GrantStateDenied,
		GrantStateFailed,
	}
}
