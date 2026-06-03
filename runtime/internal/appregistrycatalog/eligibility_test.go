package appregistrycatalog

import (
	"errors"
	"strings"
	"testing"
)

func TestCheckCallerEligibility_ExampleAppInstallRequired(t *testing.T) {
	r, _ := LoadRegistry(strings.NewReader(sampleRegistryYAML))
	result, err := r.CheckCallerEligibility("nimi.example-app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Eligible {
		t.Error("example-app should not be executable from admission alone")
	}
	if result.Reason != string(EligibilityReasonInstallRequired) {
		t.Errorf("reason = %q, want %q", result.Reason, EligibilityReasonInstallRequired)
	}
}

func TestCheckCallerEligibility_InternalAdmittedAppCanRegisterRuntimeCaller(t *testing.T) {
	yaml := strings.NewReplacer(
		"admission_status: gated_by_avatar_master_gate", "admission_status: admitted",
		"ordinary_visibility: hidden-internal", "ordinary_visibility: hidden-internal",
	).Replace(sampleRegistryYAML)
	r, err := LoadRegistry(strings.NewReader(yaml))
	if err != nil {
		t.Fatalf("LoadRegistry: %v", err)
	}
	result, err := r.CheckCallerEligibility("nimi.avatar")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Eligible {
		t.Fatalf("internal admitted Avatar should be eligible for Runtime caller registration, reason=%q", result.Reason)
	}
	if result.Reason != string(EligibilityReasonOK) {
		t.Errorf("reason = %q, want %q", result.Reason, EligibilityReasonOK)
	}
}

func TestCheckCallerEligibility_AvatarBlockedByMasterGate(t *testing.T) {
	r, _ := LoadRegistry(strings.NewReader(sampleRegistryYAML))
	result, err := r.CheckCallerEligibility("nimi.avatar")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Eligible {
		t.Error("avatar must not be eligible while master gate blocks")
	}
	if result.Reason != string(EligibilityReasonAvatarMasterGateBlocked) {
		t.Errorf("reason = %q, want %q", result.Reason, EligibilityReasonAvatarMasterGateBlocked)
	}
}

func TestCheckCallerEligibility_AppNotRegistered(t *testing.T) {
	r, _ := LoadRegistry(strings.NewReader(sampleRegistryYAML))
	result, err := r.CheckCallerEligibility("nimi.nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Eligible {
		t.Error("nonexistent app must not be eligible")
	}
	if result.Reason != string(EligibilityReasonAppNotRegistered) {
		t.Errorf("reason = %q, want %q", result.Reason, EligibilityReasonAppNotRegistered)
	}
}

func TestCheckCallerEligibility_EmptyAppIDReturnsError(t *testing.T) {
	r, _ := LoadRegistry(strings.NewReader(sampleRegistryYAML))
	_, err := r.CheckCallerEligibility("")
	if err == nil {
		t.Fatal("expected error for empty appID")
	}
	if !errors.Is(err, ErrEligibilityAppIDRequired) {
		t.Errorf("error = %v, want wrapped ErrEligibilityAppIDRequired", err)
	}
}

func TestCheckCallerEligibility_NilRegistry(t *testing.T) {
	var r *Registry
	result, err := r.CheckCallerEligibility("nimi.example-app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Eligible {
		t.Error("nil registry should never be eligible")
	}
	if result.Reason != string(EligibilityReasonAppNotRegistered) {
		t.Errorf("reason = %q, want %q", result.Reason, EligibilityReasonAppNotRegistered)
	}
}

func TestCheckCallerEligibility_PermissionFabricPendingStatus(t *testing.T) {
	yaml := strings.Replace(sampleRegistryYAML, "admission_status: admitted", "admission_status: permission_fabric_pending", 1)
	r, err := LoadRegistry(strings.NewReader(yaml))
	if err != nil {
		t.Fatalf("LoadRegistry: %v", err)
	}
	result, err := r.CheckCallerEligibility("nimi.example-app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Eligible {
		t.Error("permission_fabric_pending must not be eligible")
	}
	if result.Reason != string(EligibilityReasonPermissionFabricPending) {
		t.Errorf("reason = %q, want %q", result.Reason, EligibilityReasonPermissionFabricPending)
	}
}

func TestCheckCallerEligibility_RetiredStatus(t *testing.T) {
	yaml := strings.Replace(sampleRegistryYAML, "admission_status: admitted", "admission_status: retired", 1)
	r, _ := LoadRegistry(strings.NewReader(yaml))
	result, err := r.CheckCallerEligibility("nimi.example-app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Eligible {
		t.Error("retired must not be eligible")
	}
	if result.Reason != string(EligibilityReasonAppRetired) {
		t.Errorf("reason = %q, want %q", result.Reason, EligibilityReasonAppRetired)
	}
}

func TestCheckCallerEligibility_DeferredStatus(t *testing.T) {
	yaml := strings.Replace(sampleRegistryYAML, "admission_status: admitted", "admission_status: deferred", 1)
	r, _ := LoadRegistry(strings.NewReader(yaml))
	result, err := r.CheckCallerEligibility("nimi.example-app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Eligible {
		t.Error("deferred must not be eligible")
	}
	if result.Reason != string(EligibilityReasonAppDeferred) {
		t.Errorf("reason = %q, want %q", result.Reason, EligibilityReasonAppDeferred)
	}
}
