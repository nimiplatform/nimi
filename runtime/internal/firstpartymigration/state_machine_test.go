package firstpartymigration

import (
	"errors"
	"testing"
)

// genericMigration constructs an Avatar-kind migration with the master gate
// already acked, so transition tests exercise the canonical state machine
// without the Avatar-specific master-gate guard interfering.
func genericMigration(state MigrationState) *Migration {
	return &Migration{
		MigrationID:           "mig-generic-1",
		Kind:                  MigrationKindAvatarStandalone,
		SubjectUserID:         "user-1",
		State:                 state,
		AvatarMasterGateAcked: true,
	}
}

func avatarMigration(state MigrationState, masterGateAcked bool) *Migration {
	return &Migration{
		MigrationID:           "mig-avatar-1",
		Kind:                  MigrationKindAvatarStandalone,
		SubjectUserID:         "user-1",
		State:                 state,
		AvatarMasterGateAcked: masterGateAcked,
	}
}

func TestCanonicalMigrationStates(t *testing.T) {
	states := CanonicalMigrationStates()
	if len(states) != 9 {
		t.Errorf("got %d, want 9", len(states))
	}
	for _, s := range states {
		if !s.Valid() {
			t.Errorf("%q should be valid", s)
		}
	}
	if MigrationState("rogue").Valid() {
		t.Error("rogue must not be valid")
	}
}

func TestMigrationStates_TerminalAndBlocked(t *testing.T) {
	for _, s := range []MigrationState{MigrationStateCompleted, MigrationStateFailedTerminal, MigrationStateRolledBack} {
		if !s.IsTerminal() {
			t.Errorf("%q should be terminal", s)
		}
	}
	if !MigrationStateBlockedMasterGate.IsBlocked() {
		t.Error("BlockedMasterGate should be IsBlocked")
	}
	for _, s := range []MigrationState{MigrationStatePending, MigrationStateInProgress} {
		if s.IsTerminal() || s.IsBlocked() {
			t.Errorf("%q should be neither terminal nor blocked", s)
		}
	}
}

func TestTransition_HappyPath(t *testing.T) {
	m := genericMigration(MigrationStatePending)
	for _, next := range []MigrationState{
		MigrationStateInventoryBuilt,
		MigrationStateUserConfirmed,
		MigrationStateInProgress,
		MigrationStateCompleted,
	} {
		var err error
		m, err = Transition(m, next, 1, "")
		if err != nil {
			t.Fatalf("transition to %q: %v", next, err)
		}
	}
	if m.State != MigrationStateCompleted {
		t.Errorf("final = %q, want completed", m.State)
	}
}

func TestTransition_AvatarBlockedWithoutMasterGateAck(t *testing.T) {
	m := avatarMigration(MigrationStatePending, false)
	_, err := Transition(m, MigrationStateInventoryBuilt, 1, "")
	if err == nil {
		t.Fatal("avatar transition without master gate ack must fail")
	}
	if !errors.Is(err, ErrMigrationAvatarMasterGateBlock) {
		t.Errorf("error = %v, want ErrMigrationAvatarMasterGateBlock", err)
	}
}

func TestTransition_AvatarCanGoToBlockedMasterGate(t *testing.T) {
	m := avatarMigration(MigrationStatePending, false)
	m, err := Transition(m, MigrationStateBlockedMasterGate, 1, "avatar master gate not true-closed")
	if err != nil {
		t.Fatalf("avatar→blocked-by-master-gate must succeed: %v", err)
	}
	if !m.State.IsBlocked() {
		t.Error("state should be blocked")
	}
}

func TestTransition_AvatarUnblockAfterMasterGateAck(t *testing.T) {
	m := avatarMigration(MigrationStateBlockedMasterGate, true)
	m, err := Transition(m, MigrationStatePending, 2, "master gate true-closed")
	if err != nil {
		t.Fatalf("avatar blocked→pending after ack: %v", err)
	}
	if m.State != MigrationStatePending {
		t.Errorf("state = %q, want pending", m.State)
	}
}

func TestTransition_FailedRecoverableRequiresRecoveryPath(t *testing.T) {
	m := genericMigration(MigrationStateFailedRecoverable)
	_, err := Transition(m, MigrationStateInProgress, 1, "")
	if err == nil {
		t.Fatal("failed-recoverable→in-progress without recovery path must fail")
	}
	if !errors.Is(err, ErrMigrationRecoveryRequired) {
		t.Errorf("error = %v, want ErrMigrationRecoveryRequired", err)
	}
}

func TestTransition_FailedRecoverableWithRecoveryPathSucceeds(t *testing.T) {
	m := genericMigration(MigrationStateFailedRecoverable)
	m.RecoveryPath = "/var/nimi/migration-recovery/mig-generic-1.snapshot"
	m, err := Transition(m, MigrationStateInProgress, 1, "retry with recovery")
	if err != nil {
		t.Fatalf("retry with recovery: %v", err)
	}
	if m.State != MigrationStateInProgress {
		t.Errorf("state = %q, want in-progress", m.State)
	}
}

func TestTransition_FailedRecoverableRolledBack(t *testing.T) {
	m := genericMigration(MigrationStateFailedRecoverable)
	m, err := Transition(m, MigrationStateRolledBack, 1, "user declined retry")
	if err != nil {
		t.Fatalf("failed-recoverable→rolled-back: %v", err)
	}
	if !m.State.IsTerminal() {
		t.Error("rolled-back should be terminal")
	}
}

func TestTransition_TerminalStateLocked(t *testing.T) {
	m := genericMigration(MigrationStateCompleted)
	_, err := Transition(m, MigrationStatePending, 1, "")
	if err == nil {
		t.Fatal("terminal state must not transition")
	}
	if !errors.Is(err, ErrMigrationTerminalLocked) {
		t.Errorf("error = %v, want ErrMigrationTerminalLocked", err)
	}
}

func TestTransition_InvalidTransitionRejected(t *testing.T) {
	m := genericMigration(MigrationStatePending)
	_, err := Transition(m, MigrationStateInProgress, 1, "")
	if err == nil {
		t.Fatal("pending→in-progress (skipping steps) must fail")
	}
	if !errors.Is(err, ErrMigrationInvalidTransition) {
		t.Errorf("error = %v, want ErrMigrationInvalidTransition", err)
	}
}

func TestTransition_UnknownNextStateRejected(t *testing.T) {
	m := genericMigration(MigrationStatePending)
	_, err := Transition(m, MigrationState("rogue"), 1, "")
	if err == nil {
		t.Fatal("unknown next state must be rejected")
	}
	if !errors.Is(err, ErrMigrationUnknownState) {
		t.Errorf("error = %v, want ErrMigrationUnknownState", err)
	}
}

func TestTransition_NilMigration(t *testing.T) {
	_, err := Transition(nil, MigrationStatePending, 1, "")
	if err == nil {
		t.Fatal("nil migration must fail")
	}
}

func TestMigrationKind_RejectsUnknown(t *testing.T) {
	if MigrationKind("legacy-standalone").Valid() {
		t.Error("non-canonical migration kind must not be valid")
	}
}
