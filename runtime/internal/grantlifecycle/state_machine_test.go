package grantlifecycle

import (
	"errors"
	"testing"
)

func newGrant(state GrantState) *Grant {
	return &Grant{
		GrantID:       "grant-1",
		AppID:         "nimi.shijing",
		SubjectUserID: "user-1",
		ScopeKey:      "avatar.mood.read",
		State:         state,
	}
}

func TestCanonicalGrantStates_Completeness(t *testing.T) {
	states := CanonicalGrantStates()
	if len(states) != 6 {
		t.Errorf("len(CanonicalGrantStates) = %d, want 6", len(states))
	}
	for _, s := range states {
		if !s.Valid() {
			t.Errorf("canonical state %q not Valid()", s)
		}
	}
	if GrantState("rogue").Valid() {
		t.Error("rogue state must not be valid")
	}
}

func TestIsTerminal(t *testing.T) {
	for _, s := range []GrantState{GrantStateRevoked, GrantStateExpired, GrantStateSuperseded} {
		if !s.IsTerminal() {
			t.Errorf("%q should be terminal", s)
		}
	}
	for _, s := range []GrantState{GrantStatePending, GrantStateGranted, GrantStateDenied} {
		if s.IsTerminal() {
			t.Errorf("%q should not be terminal", s)
		}
	}
}

func TestAllowsAccess(t *testing.T) {
	if !GrantStateGranted.AllowsAccess() {
		t.Error("granted should allow access")
	}
	for _, s := range []GrantState{
		GrantStatePending, GrantStateDenied, GrantStateRevoked,
		GrantStateExpired, GrantStateSuperseded,
	} {
		if s.AllowsAccess() {
			t.Errorf("%q must NOT allow execution", s)
		}
	}
}

func TestTransition_HappyPath(t *testing.T) {
	g := newGrant(GrantStatePending)
	g, err := Transition(g, GrantStateGranted, 1, "user accepted")
	if err != nil {
		t.Fatalf("pending→granted: %v", err)
	}
	if g.State != GrantStateGranted {
		t.Errorf("final state = %q, want granted", g.State)
	}
}

func TestTransition_RejectsTerminalState(t *testing.T) {
	g := newGrant(GrantStateRevoked)
	_, err := Transition(g, GrantStateGranted, 1, "")
	if err == nil {
		t.Fatal("transition from terminal state must fail")
	}
	if !errors.Is(err, ErrGrantTerminalLocked) {
		t.Errorf("error = %v, want ErrGrantTerminalLocked", err)
	}
}

func TestTransition_RejectsInvalidTransition(t *testing.T) {
	g := newGrant(GrantStatePending)
	_, err := Transition(g, GrantStateSuperseded, 1, "")
	if err == nil {
		t.Fatal("pending→superseded must be invalid")
	}
	if !errors.Is(err, ErrGrantInvalidTransition) {
		t.Errorf("error = %v, want ErrGrantInvalidTransition", err)
	}
}

func TestTransition_RejectsUnknownState(t *testing.T) {
	g := newGrant(GrantStatePending)
	_, err := Transition(g, GrantState("rogue"), 1, "")
	if err == nil {
		t.Fatal("unknown state must be rejected")
	}
	if !errors.Is(err, ErrGrantUnknownState) {
		t.Errorf("error = %v, want ErrGrantUnknownState", err)
	}
}

func TestTransition_NilGrant(t *testing.T) {
	_, err := Transition(nil, GrantStateGranted, 1, "")
	if err == nil {
		t.Fatal("nil grant must be rejected")
	}
}

func TestRevokeGranted_Succeeds(t *testing.T) {
	g := newGrant(GrantStateGranted)
	g, err := RevokeGranted(g, 5, "user revoked")
	if err != nil {
		t.Fatalf("RevokeGranted: %v", err)
	}
	if g.State != GrantStateRevoked {
		t.Errorf("state = %q, want revoked", g.State)
	}
	if !g.State.IsTerminal() {
		t.Error("revoked must be terminal")
	}
}

func TestRevokeGranted_NotGrantedFailsClosed(t *testing.T) {
	for _, s := range []GrantState{
		GrantStatePending, GrantStateDenied, GrantStateRevoked,
		GrantStateExpired, GrantStateSuperseded,
	} {
		g := newGrant(s)
		_, err := RevokeGranted(g, 1, "")
		if err == nil {
			t.Errorf("RevokeGranted must fail for state %q", s)
		}
	}
}

func TestRevokeGranted_NilGrant(t *testing.T) {
	_, err := RevokeGranted(nil, 1, "")
	if err == nil {
		t.Fatal("nil grant must be rejected")
	}
}

func TestTransition_GrantedToRevokedExpiredSuperseded(t *testing.T) {
	for _, terminal := range []GrantState{GrantStateRevoked, GrantStateExpired, GrantStateSuperseded} {
		g := newGrant(GrantStateGranted)
		g, err := Transition(g, terminal, 1, "")
		if err != nil {
			t.Errorf("granted→%q must succeed: %v", terminal, err)
		}
		if g.State != terminal {
			t.Errorf("state = %q, want %q", g.State, terminal)
		}
	}
	// granted→denied is NOT allowed (denied is from pending)
	g := newGrant(GrantStateGranted)
	_, err := Transition(g, GrantStateDenied, 1, "")
	if err == nil {
		t.Error("granted→denied must be invalid")
	}
}

func TestTransition_PendingDenied(t *testing.T) {
	g := newGrant(GrantStatePending)
	g, err := Transition(g, GrantStateDenied, 1, "user denied")
	if err != nil {
		t.Fatalf("pending→denied: %v", err)
	}
	if g.State != GrantStateDenied {
		t.Errorf("state = %q, want denied", g.State)
	}
}

func TestTransition_DeniedCanStartNewRequest(t *testing.T) {
	g := newGrant(GrantStateDenied)
	g, err := Transition(g, GrantStatePending, 1, "new request")
	if err != nil {
		t.Fatalf("denied→pending: %v", err)
	}
	if g.State != GrantStatePending {
		t.Errorf("state = %q, want pending", g.State)
	}
}
