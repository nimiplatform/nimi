package firstpartymigration

import "testing"

func TestLaunchGateAdmitsParentOSWhenMigrationNotRequired(t *testing.T) {
	gate := NewLaunchGate(WithMigrationNotRequired("app.nimi.parentos"))
	decision := gate.Evaluate("nimi.parentos")
	if !decision.Admitted || decision.Reason != LaunchReasonNotRequired {
		t.Fatalf("unexpected decision: %+v", decision)
	}
}

func TestLaunchGateAdmitsCompletedMigration(t *testing.T) {
	gate := NewLaunchGate(WithMigrationState("nimi.parentos", MigrationStateCompleted))
	decision := gate.Evaluate("app.nimi.parentos")
	if !decision.Admitted || decision.Reason != LaunchReasonCompleted {
		t.Fatalf("unexpected decision: %+v", decision)
	}
}

func TestLaunchGateBlocksMissingOrIncompleteMigration(t *testing.T) {
	gate := NewLaunchGate()
	missing := gate.Evaluate("nimi.parentos")
	if missing.Admitted || missing.Reason != LaunchReasonStateMissing {
		t.Fatalf("missing migration should fail closed: %+v", missing)
	}

	pendingGate := NewLaunchGate(WithMigrationState("nimi.parentos", MigrationStatePending))
	pending := pendingGate.Evaluate("nimi.parentos")
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
