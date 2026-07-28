package runtimeagent

import (
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestDeriveDelegatedToolClassificationFromDeclaredDescriptor(t *testing.T) {
	profile := &runtimev1.DelegatedProviderProfile{
		AllowedTools: []*runtimev1.DelegatedToolAllowlistEntry{
			{
				ToolName:                 "calendar_write",
				EffectClass:              runtimev1.EffectClass_EFFECT_CLASS_EXTERNAL_SIDE_EFFECT,
				ExpectedSensitivityClass: runtimev1.SensitivityClass_SENSITIVITY_CLASS_USER_PRIVATE,
			},
			{ToolName: "legacy_tool"},
		},
	}
	if got := deriveDelegatedToolEffectClass(profile, "calendar_write"); got != runtimev1.EffectClass_EFFECT_CLASS_EXTERNAL_SIDE_EFFECT {
		t.Fatalf("declared effect class not derived: %v", got)
	}
	if got := deriveDelegatedToolExpectedSensitivity(profile, "calendar_write"); got != runtimev1.SensitivityClass_SENSITIVITY_CLASS_USER_PRIVATE {
		t.Fatalf("declared sensitivity not derived: %v", got)
	}
	// Pre-classification persisted entries and unknown tools stay UNSPECIFIED
	// at derivation; conservative collapse happens in effectiveDelegatedSensitivity.
	if got := deriveDelegatedToolEffectClass(profile, "legacy_tool"); got != runtimev1.EffectClass_EFFECT_CLASS_UNSPECIFIED {
		t.Fatalf("legacy entry must derive UNSPECIFIED effect, got %v", got)
	}
	if got := deriveDelegatedToolEffectClass(profile, "missing_tool"); got != runtimev1.EffectClass_EFFECT_CLASS_UNSPECIFIED {
		t.Fatalf("missing tool must derive UNSPECIFIED effect, got %v", got)
	}
	if got := effectiveDelegatedSensitivity(runtimev1.SensitivityClass_SENSITIVITY_CLASS_UNSPECIFIED); got != runtimev1.SensitivityClass_SENSITIVITY_CLASS_UNKNOWN_SENSITIVE {
		t.Fatalf("undeclared sensitivity must collapse to UNKNOWN_SENSITIVE, got %v", got)
	}
	if got := effectiveDelegatedSensitivity(runtimev1.SensitivityClass_SENSITIVITY_CLASS_NONE); got != runtimev1.SensitivityClass_SENSITIVITY_CLASS_NONE {
		t.Fatalf("declared NONE must pass through, got %v", got)
	}
	// Effect class collapses the same conservative direction: an unclassified
	// effect must never surface as the UNSPECIFIED zero value on an approval.
	if got := effectiveDelegatedEffectClass(runtimev1.EffectClass_EFFECT_CLASS_UNSPECIFIED); got != runtimev1.EffectClass_EFFECT_CLASS_SENSITIVE_READ {
		t.Fatalf("undeclared effect must collapse to SENSITIVE_READ, got %v", got)
	}
	if got := effectiveDelegatedEffectClass(runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY); got != runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY {
		t.Fatalf("declared READ_ONLY must pass through, got %v", got)
	}
}

func TestClassifyApprovalCollapsesUnclassifiedEffectFromHydratedProfile(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	// Simulate a pre-classification persisted profile that bypassed the upsert
	// guard by landing directly in the store (DB hydration path): an allowlisted
	// tool whose effect_class is the UNSPECIFIED zero value.
	svc.ensureDelegatedControlStoresLocked()
	svc.delegatedProviderProfiles[delegatedProviderProfileKey("agent-1", "provider-legacy")] = &runtimev1.DelegatedProviderProfile{
		ProviderProfileId: "provider-legacy",
		State:             runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY,
		AllowedTools: []*runtimev1.DelegatedToolAllowlistEntry{{
			ToolName:          "legacy_tool",
			InputSchemaDigest: "sha256:legacy",
		}},
	}
	decision := &runtimeAgentDelegatedCapabilityDecision{
		DecisionID: "deleg-decision-legacy",
		AgentID:    "agent-1",
		ProviderID: "provider-legacy",
		ToolName:   "legacy_tool",
	}
	svc.classifyDelegatedApprovalDecisionLocked(decision)
	if decision.EffectClass != runtimev1.EffectClass_EFFECT_CLASS_SENSITIVE_READ {
		t.Fatalf("hydrated unclassified effect must collapse to SENSITIVE_READ, got %v", decision.EffectClass)
	}
	if decision.SensitivityClass != runtimev1.SensitivityClass_SENSITIVITY_CLASS_UNKNOWN_SENSITIVE {
		t.Fatalf("hydrated unclassified sensitivity must collapse to UNKNOWN_SENSITIVE, got %v", decision.SensitivityClass)
	}
}

func TestValidateDelegatedApprovalResumeRejectsUnclassifiedEffect(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	svc.ensureDelegatedControlStoresLocked()
	svc.delegatedProviderProfiles[delegatedProviderProfileKey("agent-1", "provider-1")] = &runtimev1.DelegatedProviderProfile{
		ProviderProfileId: "provider-1",
		State:             runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY,
		AllowedTools: []*runtimev1.DelegatedToolAllowlistEntry{{
			ToolName:          "calendar_lookup",
			InputSchemaDigest: "sha256:descriptor",
			EffectClass:       runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY,
		}},
	}
	detail, err := structpb.NewStruct(map[string]any{
		"descriptor_hash":    "sha256:descriptor",
		"policy_snapshot_id": delegatedApprovalPolicySnapshotID("provider-1", "calendar.read", "calendar_lookup", "sha256:descriptor"),
		"principal_id":       "user-1",
	})
	if err != nil {
		t.Fatalf("build detail: %v", err)
	}
	base := &runtimev1.DelegatedApprovalRequest{
		ProviderProfileId: "provider-1",
		CapabilityId:      "calendar.read",
		ToolName:          "calendar_lookup",
		ExpiresAt:         timestamppb.New(time.Now().Add(time.Hour)),
		Detail:            detail,
	}
	ctx := &runtimev1.AgentRequestContext{SubjectUserId: "user-1"}

	// UNSPECIFIED effect (hydrated pre-classification approval) fails closed.
	unclassified := proto.Clone(base).(*runtimev1.DelegatedApprovalRequest)
	unclassified.EffectClass = runtimev1.EffectClass_EFFECT_CLASS_UNSPECIFIED
	if err := svc.validateDelegatedApprovalResumeLocked(ctx, "agent-1", unclassified, time.Now()); err == nil || !strings.Contains(err.Error(), "unclassified") {
		t.Fatalf("expected unclassified-effect rejection, got %v", err)
	}

	// Effect drift between the recorded approval and the current descriptor fails closed.
	drifted := proto.Clone(base).(*runtimev1.DelegatedApprovalRequest)
	drifted.EffectClass = runtimev1.EffectClass_EFFECT_CLASS_EXTERNAL_SIDE_EFFECT
	if err := svc.validateDelegatedApprovalResumeLocked(ctx, "agent-1", drifted, time.Now()); err == nil || !strings.Contains(err.Error(), "effect class drifted") {
		t.Fatalf("expected effect-drift rejection, got %v", err)
	}

	// Matching resolved effect passes the effect-class precondition.
	matching := proto.Clone(base).(*runtimev1.DelegatedApprovalRequest)
	matching.EffectClass = runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY
	if err := svc.validateDelegatedApprovalResumeLocked(ctx, "agent-1", matching, time.Now()); err != nil {
		t.Fatalf("matching resolved effect must pass, got %v", err)
	}
}
