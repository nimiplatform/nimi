package grantlifecycle

import (
	"errors"
	"testing"
)

func newGrant(state GrantState) *Grant {
	return &Grant{
		GrantID:       "grant-1",
		AppID:         "nimi.parentos",
		SubjectUserID: "user-1",
		ScopeKey:      "avatar.mood.read",
		State:         state,
	}
}

func TestCanonicalGrantStates_Completeness(t *testing.T) {
	states := CanonicalGrantStates()
	if len(states) != 8 {
		t.Errorf("len(CanonicalGrantStates) = %d, want 8", len(states))
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
	for _, s := range []GrantState{GrantStateRevoked, GrantStateExpired, GrantStateDenied, GrantStateFailed} {
		if !s.IsTerminal() {
			t.Errorf("%q should be terminal", s)
		}
	}
	for _, s := range []GrantState{GrantStateRequested, GrantStatePrompted, GrantStateGranted, GrantStateInUse} {
		if s.IsTerminal() {
			t.Errorf("%q should not be terminal", s)
		}
	}
}

func TestAllowsExecution(t *testing.T) {
	if !GrantStateInUse.AllowsExecution() {
		t.Error("in-use should allow execution")
	}
	for _, s := range []GrantState{
		GrantStateRequested, GrantStatePrompted, GrantStateGranted,
		GrantStateRevoked, GrantStateExpired, GrantStateDenied, GrantStateFailed,
	} {
		if s.AllowsExecution() {
			t.Errorf("%q must NOT allow execution", s)
		}
	}
}

func TestTransition_HappyPath(t *testing.T) {
	g := newGrant(GrantStateRequested)
	g, err := Transition(g, GrantStatePrompted, 1, "prompt user")
	if err != nil {
		t.Fatalf("requested→prompted: %v", err)
	}
	g, err = Transition(g, GrantStateGranted, 2, "user accepted")
	if err != nil {
		t.Fatalf("prompted→granted: %v", err)
	}
	g, err = Transition(g, GrantStateInUse, 3, "begin execution")
	if err != nil {
		t.Fatalf("granted→in-use: %v", err)
	}
	g, err = Transition(g, GrantStateGranted, 4, "execution complete")
	if err != nil {
		t.Fatalf("in-use→granted: %v", err)
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
	g := newGrant(GrantStateRequested)
	_, err := Transition(g, GrantStateInUse, 1, "")
	if err == nil {
		t.Fatal("requested→in-use must be invalid")
	}
	if !errors.Is(err, ErrGrantInvalidTransition) {
		t.Errorf("error = %v, want ErrGrantInvalidTransition", err)
	}
}

func TestTransition_RejectsUnknownState(t *testing.T) {
	g := newGrant(GrantStateRequested)
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

func TestRevokeActive_InUseSucceeds(t *testing.T) {
	g := newGrant(GrantStateInUse)
	g, err := RevokeActive(g, 5, "user revoked mid-execution")
	if err != nil {
		t.Fatalf("RevokeActive: %v", err)
	}
	if g.State != GrantStateRevoked {
		t.Errorf("state = %q, want revoked", g.State)
	}
	if !g.State.IsTerminal() {
		t.Error("revoked must be terminal")
	}
}

func TestRevokeActive_NotInUseFailsClosed(t *testing.T) {
	for _, s := range []GrantState{
		GrantStateRequested, GrantStatePrompted, GrantStateGranted,
		GrantStateRevoked, GrantStateExpired, GrantStateDenied, GrantStateFailed,
	} {
		g := newGrant(s)
		_, err := RevokeActive(g, 1, "")
		if err == nil {
			t.Errorf("RevokeActive must fail for state %q", s)
		}
		if !errors.Is(err, ErrGrantNotInUse) {
			t.Errorf("state %q error = %v, want ErrGrantNotInUse", s, err)
		}
	}
}

func TestRevokeActive_NilGrant(t *testing.T) {
	_, err := RevokeActive(nil, 1, "")
	if err == nil {
		t.Fatal("nil grant must be rejected")
	}
}

func TestTransition_GrantedToRevokedDeniedExpiredFailed(t *testing.T) {
	for _, terminal := range []GrantState{GrantStateRevoked, GrantStateExpired, GrantStateFailed} {
		g := newGrant(GrantStateGranted)
		g, err := Transition(g, terminal, 1, "")
		if err != nil {
			t.Errorf("granted→%q must succeed: %v", terminal, err)
		}
		if g.State != terminal {
			t.Errorf("state = %q, want %q", g.State, terminal)
		}
	}
	// granted→denied is NOT allowed (denied is from prompted/requested)
	g := newGrant(GrantStateGranted)
	_, err := Transition(g, GrantStateDenied, 1, "")
	if err == nil {
		t.Error("granted→denied must be invalid")
	}
}

func TestTransition_PromptedDenied(t *testing.T) {
	g := newGrant(GrantStatePrompted)
	g, err := Transition(g, GrantStateDenied, 1, "user denied")
	if err != nil {
		t.Fatalf("prompted→denied: %v", err)
	}
	if g.State != GrantStateDenied {
		t.Errorf("state = %q, want denied", g.State)
	}
}
