package firstpartymigration

import "testing"

func TestLaunchGateAdmitsAvatarWhenMigrationNotRequired(t *testing.T) {
	gate := NewLaunchGate(
		WithAvatarMasterGateAcked(true),
		WithMigrationNotRequired("app.nimi.avatar"),
	)
	decision := gate.Evaluate("nimi.avatar")
	if !decision.Admitted || decision.Reason != LaunchReasonNotRequired {
		t.Fatalf("unexpected decision: %+v", decision)
	}
}

func TestLaunchGateAdmitsCompletedMigration(t *testing.T) {
	gate := NewLaunchGate(
		WithAvatarMasterGateAcked(true),
		WithMigrationState("nimi.avatar", MigrationStateCompleted),
	)
	decision := gate.Evaluate("app.nimi.avatar")
	if !decision.Admitted || decision.Reason != LaunchReasonCompleted {
		t.Fatalf("unexpected decision: %+v", decision)
	}
}

func TestLaunchGateBlocksMissingOrIncompleteMigration(t *testing.T) {
	gate := NewLaunchGate(WithAvatarMasterGateAcked(true))
	missing := gate.Evaluate("nimi.avatar")
	if missing.Admitted || missing.Reason != LaunchReasonStateMissing {
		t.Fatalf("missing migration should fail closed: %+v", missing)
	}

	pendingGate := NewLaunchGate(
		WithAvatarMasterGateAcked(true),
		WithMigrationState("nimi.avatar", MigrationStatePending),
	)
	pending := pendingGate.Evaluate("nimi.avatar")
	if pending.Admitted || pending.Reason != string(MigrationStatePending) {
		t.Fatalf("pending migration should fail closed: %+v", pending)
	}
}

func TestLaunchGateBlocksAvatarUntilMasterGateAcked(t *testing.T) {
	blocked := NewLaunchGate(WithMigrationNotRequired("nimi.avatar")).Evaluate("nimi.avatar")
	if blocked.Admitted || blocked.Reason != LaunchReasonAvatarMasterGateBlocked {
		t.Fatalf("avatar must remain blocked without master gate ack: %+v", blocked)
	}

	admitted := NewLaunchGate(
		WithAvatarMasterGateAcked(true),
		WithMigrationNotRequired("nimi.avatar"),
	).Evaluate("nimi.avatar")
	if !admitted.Admitted {
		t.Fatalf("avatar should admit only after master gate ack and migration not-required/completed: %+v", admitted)
	}
}

func TestLaunchGateIgnoresNonHardcutApps(t *testing.T) {
	decision := NewLaunchGate().Evaluate("third.party")
	if !decision.Admitted || decision.Reason != LaunchReasonAdmitted {
		t.Fatalf("unexpected non-hardcut decision: %+v", decision)
	}
}
