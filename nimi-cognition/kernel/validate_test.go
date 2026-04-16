package kernel

import (
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

// --- Rule helpers ---

func validLocalRule() Rule {
	return Rule{
		RuleID:        "rule_001",
		Kind:          RuleKindSelfFacing,
		Version:       1,
		Statement:     "Agent prefers concise responses",
		AnchorBinding: AnchorBindingLocalOnly,
		Lifecycle:     RuleLifecycleActive,
		CreatedAt:     ts,
		UpdatedAt:     ts,
	}
}

func validAnchoredRule() Rule {
	return Rule{
		RuleID:        "rule_002",
		Kind:          RuleKindWorldFacing,
		Version:       1,
		Statement:     "User Alice works in engineering",
		AnchorBinding: AnchorBindingAnchored,
		Alignment:     AlignmentAligned,
		Lifecycle:     RuleLifecycleActive,
		SourceRefs: []SourceRef{{
			SourceType: "realm_event",
			SourceID:   "evt_001",
			Strength:   RefStrong,
			ObservedAt: ts,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}
}

// --- Kernel helpers ---

func validAgentKernel() AgentModelKernel {
	return AgentModelKernel{
		Kernel: Kernel{
			KernelID:   "amk_001",
			ScopeID:    "agent_001",
			KernelType: KernelTypeAgentModel,
			Version:    1,
			Status:     KernelStatusActive,
			RuleRefs:   []RuleID{"rule_001"},
			CreatedAt:  ts,
			UpdatedAt:  ts,
		},
		Rules: []Rule{validLocalRule()},
	}
}

func validWorldKernel() WorldModelKernel {
	r := validAnchoredRule()
	return WorldModelKernel{
		Kernel: Kernel{
			KernelID:   "wmk_001",
			ScopeID:    "agent_001",
			KernelType: KernelTypeWorldModel,
			Version:    1,
			Status:     KernelStatusActive,
			RuleRefs:   []RuleID{r.RuleID},
			CreatedAt:  ts,
			UpdatedAt:  ts,
		},
		Rules: []Rule{r},
	}
}

// --- Rule validation tests ---

func TestValidateRule_ValidLocal(t *testing.T) {
	if err := ValidateRule(validLocalRule()); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidateRule_ValidAnchored(t *testing.T) {
	if err := ValidateRule(validAnchoredRule()); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidateRule_MissingFields(t *testing.T) {
	tests := []struct {
		name   string
		modify func(*Rule)
		expect string
	}{
		{"missing rule_id", func(r *Rule) { r.RuleID = "" }, "rule_id is required"},
		{"missing rule_kind", func(r *Rule) { r.Kind = "" }, "rule_kind is required"},
		{"invalid rule_kind", func(r *Rule) { r.Kind = "bogus" }, "invalid rule_kind"},
		{"missing statement", func(r *Rule) { r.Statement = "" }, "statement is required"},
		{"bad version", func(r *Rule) { r.Version = 0 }, "version must be >= 1"},
		{"missing anchor_binding", func(r *Rule) { r.AnchorBinding = "" }, "anchor_binding is required"},
		{"invalid anchor_binding", func(r *Rule) { r.AnchorBinding = "bogus" }, "invalid anchor_binding"},
		{"missing lifecycle", func(r *Rule) { r.Lifecycle = "" }, "rule_lifecycle_state is required"},
		{"invalid lifecycle", func(r *Rule) { r.Lifecycle = "bogus" }, "invalid rule_lifecycle_state"},
		{"missing created_at", func(r *Rule) { r.CreatedAt = time.Time{} }, "created_at is required"},
		{"missing updated_at", func(r *Rule) { r.UpdatedAt = time.Time{} }, "updated_at is required"},
		{"superseded without by", func(r *Rule) {
			r.Lifecycle = RuleLifecycleSuperseded
			r.SupersededBy = ""
		}, "superseded_by is required"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := validLocalRule()
			tt.modify(&r)
			err := ValidateRule(r)
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.expect) {
				t.Errorf("expected %q in error, got: %v", tt.expect, err)
			}
		})
	}
}

// --- 3-axis constraint tests ---

func TestValidateRule_AnchoredRequiresAlignment(t *testing.T) {
	r := validAnchoredRule()
	r.Alignment = ""
	err := ValidateRule(r)
	if err == nil || !strings.Contains(err.Error(), "alignment_state is required") {
		t.Fatalf("expected alignment error, got: %v", err)
	}
}

func TestValidateRule_LocalOnlyRejectsAlignment(t *testing.T) {
	r := validLocalRule()
	r.Alignment = AlignmentAligned
	err := ValidateRule(r)
	if err == nil || !strings.Contains(err.Error(), "alignment_state must be empty") {
		t.Fatalf("expected rejection of alignment on local_only, got: %v", err)
	}
}

func TestValidateRule_AllAlignmentStates(t *testing.T) {
	for _, a := range []AlignmentState{AlignmentAligned, AlignmentStale, AlignmentConflicted, AlignmentLocalOverride} {
		r := validAnchoredRule()
		r.Alignment = a
		if err := ValidateRule(r); err != nil {
			t.Errorf("alignment %q should be valid: %v", a, err)
		}
	}
}

func TestValidateRule_LocalOverrideRequiresAnchored(t *testing.T) {
	r := validLocalRule()
	r.Alignment = AlignmentLocalOverride
	err := ValidateRule(r)
	if err == nil || !strings.Contains(err.Error(), "local_override requires anchor_binding anchored") {
		t.Fatalf("expected local_override anchoring error, got: %v", err)
	}
}

func TestValidateRule_AllLifecycleStates(t *testing.T) {
	for _, l := range []RuleLifecycleState{RuleLifecycleActive, RuleLifecycleInvalidated} {
		r := validLocalRule()
		r.Lifecycle = l
		if err := ValidateRule(r); err != nil {
			t.Errorf("lifecycle %q should be valid: %v", l, err)
		}
	}
	// superseded needs superseded_by
	r := validLocalRule()
	r.Lifecycle = RuleLifecycleSuperseded
	r.SupersededBy = "rule_999"
	if err := ValidateRule(r); err != nil {
		t.Errorf("superseded with by should be valid: %v", err)
	}
}

func TestValidateRule_SourceRefValidation(t *testing.T) {
	r := validLocalRule()
	r.SourceRefs = []SourceRef{{SourceType: "", SourceID: "x", Strength: RefWeak, ObservedAt: ts}}
	err := ValidateRule(r)
	if err == nil || !strings.Contains(err.Error(), "source_type is required") {
		t.Fatalf("expected source ref error, got: %v", err)
	}
}

func TestValidateRule_WithValue(t *testing.T) {
	r := validLocalRule()
	r.Value = []byte(`{"confidence": 0.9}`)
	if err := ValidateRule(r); err != nil {
		t.Fatalf("rule with value should be valid: %v", err)
	}
}

func TestValidateRule_ArtifactRefOwnership(t *testing.T) {
	r := validLocalRule()
	r.ArtifactRefs = []artifactref.Ref{{
		FromKind:  artifactref.KindKernelRule,
		FromID:    string(r.RuleID),
		ToKind:    artifactref.KindMemoryRecord,
		ToID:      "mem_001",
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: ts,
		UpdatedAt: ts,
	}}
	if err := ValidateRule(r); err != nil {
		t.Fatalf("rule with artifact refs should be valid: %v", err)
	}
	r.ArtifactRefs[0].FromID = "other"
	err := ValidateRule(r)
	if err == nil || !strings.Contains(err.Error(), "ownership must stay on the rule") {
		t.Fatalf("expected ownership error, got: %v", err)
	}
}

// --- Kernel validation tests ---

func TestValidateKernel_Valid(t *testing.T) {
	k := validAgentKernel().Kernel
	if err := ValidateKernel(k); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidateKernel_MissingFields(t *testing.T) {
	tests := []struct {
		name   string
		modify func(*Kernel)
		expect string
	}{
		{"missing kernel_id", func(k *Kernel) { k.KernelID = "" }, "kernel_id is required"},
		{"missing scope_id", func(k *Kernel) { k.ScopeID = "" }, "scope_id is required"},
		{"missing kernel_type", func(k *Kernel) { k.KernelType = "" }, "kernel_type is required"},
		{"invalid kernel_type", func(k *Kernel) { k.KernelType = "bogus" }, "invalid kernel_type"},
		{"bad version", func(k *Kernel) { k.Version = 0 }, "version must be >= 1"},
		{"missing status", func(k *Kernel) { k.Status = "" }, "status is required"},
		{"invalid status", func(k *Kernel) { k.Status = "bogus" }, "invalid status"},
		{"missing created_at", func(k *Kernel) { k.CreatedAt = time.Time{} }, "created_at is required"},
		{"missing updated_at", func(k *Kernel) { k.UpdatedAt = time.Time{} }, "updated_at is required"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			k := validAgentKernel().Kernel
			tt.modify(&k)
			err := ValidateKernel(k)
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.expect) {
				t.Errorf("expected %q, got: %v", tt.expect, err)
			}
		})
	}
}

// --- AgentModelKernel tests ---

func TestValidateAgentModelKernel_Valid(t *testing.T) {
	if err := ValidateAgentModelKernel(validAgentKernel()); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidateAgentModelKernel_EmptyRules(t *testing.T) {
	k := validAgentKernel()
	k.Rules = nil
	k.Kernel.RuleRefs = nil
	if err := ValidateAgentModelKernel(k); err != nil {
		t.Fatalf("empty rules should be valid: %v", err)
	}
}

func TestValidateAgentModelKernel_WrongKernelType(t *testing.T) {
	k := validAgentKernel()
	k.Kernel.KernelType = KernelTypeWorldModel
	err := ValidateAgentModelKernel(k)
	if err == nil || !strings.Contains(err.Error(), "kernel_type must be agent_model") {
		t.Fatalf("expected type error, got: %v", err)
	}
}

func TestValidateAgentModelKernel_WrongRuleKind(t *testing.T) {
	k := validAgentKernel()
	k.Rules[0].Kind = RuleKindWorldFacing
	err := ValidateAgentModelKernel(k)
	if err == nil || !strings.Contains(err.Error(), "rule_kind must be self_facing") {
		t.Fatalf("expected kind error, got: %v", err)
	}
}

func TestValidateAgentModelKernel_DuplicateRuleID(t *testing.T) {
	k := validAgentKernel()
	k.Rules = append(k.Rules, k.Rules[0])
	err := ValidateAgentModelKernel(k)
	if err == nil || !strings.Contains(err.Error(), "duplicate rule_id") {
		t.Fatalf("expected duplicate error, got: %v", err)
	}
}

func TestValidateAgentModelKernel_RuleRefsInconsistent(t *testing.T) {
	k := validAgentKernel()
	k.Kernel.RuleRefs = []RuleID{"ghost_rule"}
	err := ValidateAgentModelKernel(k)
	if err == nil || !strings.Contains(err.Error(), "rule_refs contains ghost_rule") {
		t.Fatalf("expected ref consistency error, got: %v", err)
	}
}

// --- WorldModelKernel tests ---

func TestValidateWorldModelKernel_Valid(t *testing.T) {
	if err := ValidateWorldModelKernel(validWorldKernel()); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidateWorldModelKernel_WrongKernelType(t *testing.T) {
	k := validWorldKernel()
	k.Kernel.KernelType = KernelTypeAgentModel
	err := ValidateWorldModelKernel(k)
	if err == nil || !strings.Contains(err.Error(), "kernel_type must be world_model") {
		t.Fatalf("expected type error, got: %v", err)
	}
}

func TestValidateWorldModelKernel_WrongRuleKind(t *testing.T) {
	k := validWorldKernel()
	k.Rules[0].Kind = RuleKindSelfFacing
	err := ValidateWorldModelKernel(k)
	if err == nil || !strings.Contains(err.Error(), "rule_kind must be world_facing") {
		t.Fatalf("expected kind error, got: %v", err)
	}
}
