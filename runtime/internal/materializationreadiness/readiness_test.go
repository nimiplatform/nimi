package materializationreadiness

import (
	"errors"
	"testing"
)

func TestNewReady_IsReady(t *testing.T) {
	r := NewReady()
	if !r.IsReady() {
		t.Errorf("NewReady().IsReady() = false")
	}
	if r.State != StateReady {
		t.Errorf("state = %q, want ready", r.State)
	}
	if r.Reason != ReasonReady {
		t.Errorf("reason = %q, want ready", r.Reason)
	}
	if err := ValidateProjection(r); err != nil {
		t.Errorf("ValidateProjection(ready) returned error: %v", err)
	}
}

func TestNewInProgress_RequiresValidReason(t *testing.T) {
	r, err := NewInProgress(ReasonSetupInProgress, "downloading engine", []string{"native-engine-package.llama"})
	if err != nil {
		t.Fatalf("NewInProgress(setup_in_progress) returned error: %v", err)
	}
	if r.State != StateSetupInProgress {
		t.Errorf("state = %q, want setup_in_progress", r.State)
	}
	if r.IsReady() {
		t.Errorf("IsReady() should be false for in-progress")
	}
	if err := ValidateProjection(r); err != nil {
		t.Errorf("ValidateProjection returned error: %v", err)
	}
}

func TestNewInProgress_RejectsUnknownReason(t *testing.T) {
	_, err := NewInProgress(ReasonCode("rogue_reason"), "", nil)
	if err == nil {
		t.Fatal("NewInProgress accepted unknown reason")
	}
	if !errors.Is(err, ErrUnknownReasonCode) {
		t.Errorf("error = %v, want wrapped ErrUnknownReasonCode", err)
	}
}

func TestNewInProgress_RejectsReasonReady(t *testing.T) {
	_, err := NewInProgress(ReasonReady, "", nil)
	if err == nil {
		t.Fatal("NewInProgress accepted reason=ready (would violate no-false-readiness)")
	}
}

func TestNewBlocked_DependencyMissing(t *testing.T) {
	r, err := NewBlocked(ReasonEnginePackageMissing, "engine binary not on disk", []string{"native-engine-package.llama"})
	if err != nil {
		t.Fatalf("NewBlocked returned error: %v", err)
	}
	if r.State != StateSetupRequired {
		t.Errorf("state = %q, want setup_required", r.State)
	}
	if r.Reason != ReasonEnginePackageMissing {
		t.Errorf("reason = %q, want engine_package_missing", r.Reason)
	}
	if r.IsReady() {
		t.Errorf("IsReady() should be false for blocked state")
	}
	if err := ValidateProjection(r); err != nil {
		t.Errorf("ValidateProjection returned error: %v", err)
	}
}

func TestNewBlocked_RejectsUnknownReason(t *testing.T) {
	_, err := NewBlocked(ReasonCode("invented_reason"), "", nil)
	if err == nil {
		t.Fatal("NewBlocked accepted unknown reason")
	}
}

func TestNewFailed_ValidatesReason(t *testing.T) {
	r, err := NewFailed(ReasonFailed, "engine setup returned non-zero exit", []string{"native-engine-package.llama"})
	if err != nil {
		t.Fatalf("NewFailed returned error: %v", err)
	}
	if r.State != StateFailed {
		t.Errorf("state = %q, want failed", r.State)
	}
	if !r.State.IsTerminalNonReady() {
		t.Errorf("failed state should report IsTerminalNonReady()=true")
	}
}

func TestNewUnsupported_HostCapability(t *testing.T) {
	r, err := NewUnsupported(ReasonMetalRuntimeUnavailable, "Metal not available on this host")
	if err != nil {
		t.Fatalf("NewUnsupported returned error: %v", err)
	}
	if r.State != StateUnsupported {
		t.Errorf("state = %q, want unsupported", r.State)
	}
	if !r.State.IsTerminalNonReady() {
		t.Errorf("unsupported state should report IsTerminalNonReady()=true")
	}
}

func TestNewRepairRequired_ValidatesReason(t *testing.T) {
	r, err := NewRepairRequired(ReasonRepairRequired, "engine cache corrupted", []string{"native-engine-package.llama"})
	if err != nil {
		t.Fatalf("NewRepairRequired returned error: %v", err)
	}
	if r.State != StateRepairRequired {
		t.Errorf("state = %q, want repair_required", r.State)
	}
	if !r.State.IsTerminalNonReady() {
		t.Errorf("repair_required state should report IsTerminalNonReady()=true")
	}
}

func TestNewCancelled(t *testing.T) {
	r, err := NewCancelled(ReasonCancelled, "user cancelled materialization")
	if err != nil {
		t.Fatalf("NewCancelled returned error: %v", err)
	}
	if r.State != StateCancelled {
		t.Errorf("state = %q, want cancelled", r.State)
	}
}

func TestValidateProjection_HandConstructedActiveReadyWithoutReady(t *testing.T) {
	r := Readiness{State: StateReady, Reason: ReasonEnginePackageMissing}
	err := ValidateProjection(r)
	if err == nil {
		t.Fatal("ValidateProjection accepted state=ready with reason!=ready")
	}
	if !errors.Is(err, ErrActiveReadyRequiresReasonReady) {
		t.Errorf("error = %v, want wrapped ErrActiveReadyRequiresReasonReady", err)
	}
}

func TestValidateProjection_HandConstructedNonReadyWithReady(t *testing.T) {
	r := Readiness{State: StateSetupRequired, Reason: ReasonReady}
	err := ValidateProjection(r)
	if err == nil {
		t.Fatal("ValidateProjection accepted state=setup_required with reason=ready")
	}
	if !errors.Is(err, ErrNonReadyMustNotProjectActive) {
		t.Errorf("error = %v, want wrapped ErrNonReadyMustNotProjectActive", err)
	}
}

func TestValidateProjection_NonReadyWithoutReason(t *testing.T) {
	r := Readiness{State: StateSetupRequired}
	err := ValidateProjection(r)
	if err == nil {
		t.Fatal("ValidateProjection accepted non-ready state with empty reason")
	}
}

func TestValidateProjection_UnknownState(t *testing.T) {
	r := Readiness{State: ActivationState("active_ready"), Reason: ReasonReady}
	err := ValidateProjection(r)
	if err == nil {
		t.Fatal("ValidateProjection accepted unknown state value")
	}
	if !errors.Is(err, ErrUnknownActivationState) {
		t.Errorf("error = %v, want wrapped ErrUnknownActivationState", err)
	}
}

func TestActivationState_Valid(t *testing.T) {
	for _, state := range []ActivationState{
		StateUnsupported, StateRepairRequired, StateFailed, StateCancelled,
		StateSetupInProgress, StateSetupRequired, StateReady,
	} {
		if !state.Valid() {
			t.Errorf("Valid() = false for canonical state %q", state)
		}
	}
	if ActivationState("active_ready").Valid() {
		t.Error("Valid() = true for non-canonical 'active_ready'")
	}
}

func TestCanonicalReasonCodes_CompletenessAndUniqueness(t *testing.T) {
	codes := CanonicalReasonCodes()
	if got := len(codes); got != 20 {
		t.Errorf("len(CanonicalReasonCodes) = %d, want 20 per activation-gate-reason-codes.yaml", got)
	}
	seen := map[ReasonCode]bool{}
	for _, code := range codes {
		if seen[code] {
			t.Errorf("CanonicalReasonCodes has duplicate: %q", code)
		}
		seen[code] = true
		if !code.Valid() {
			t.Errorf("Valid() = false for canonical reason %q", code)
		}
	}
	if ReasonCode("rogue").Valid() {
		t.Error("Valid() = true for non-canonical 'rogue'")
	}
}
