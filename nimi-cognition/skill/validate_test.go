package skill

import (
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

func validBundle() Bundle {
	return Bundle{
		BundleID: "skill_001",
		ScopeID:  "agent_001",
		Version:  1,
		Status:   BundleStatusActive,
		Name:     "Code Review Procedure",
		Steps: []Step{
			{StepID: "s1", Instruction: "Read the diff", Order: 1},
			{StepID: "s2", Instruction: "Check for bugs", Order: 2},
		},
		CreatedAt: ts,
		UpdatedAt: ts,
	}
}

func TestValidateBundle_Valid(t *testing.T) {
	if err := ValidateBundle(validBundle()); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidateBundle_AllStatuses(t *testing.T) {
	for _, s := range []BundleStatus{
		BundleStatusDraft, BundleStatusActive,
		BundleStatusArchived, BundleStatusRemoved,
	} {
		b := validBundle()
		b.Status = s
		if err := ValidateBundle(b); err != nil {
			t.Errorf("status %q should be valid: %v", s, err)
		}
	}
}

func TestValidateBundle_MissingFields(t *testing.T) {
	tests := []struct {
		name   string
		modify func(*Bundle)
		expect string
	}{
		{"missing bundle_id", func(b *Bundle) { b.BundleID = "" }, "bundle_id is required"},
		{"missing scope_id", func(b *Bundle) { b.ScopeID = "" }, "scope_id is required"},
		{"bad version", func(b *Bundle) { b.Version = 0 }, "version must be >= 1"},
		{"missing status", func(b *Bundle) { b.Status = "" }, "status is required"},
		{"invalid status", func(b *Bundle) { b.Status = "bogus" }, "invalid status"},
		{"missing name", func(b *Bundle) { b.Name = "" }, "name is required"},
		{"missing created_at", func(b *Bundle) { b.CreatedAt = time.Time{} }, "created_at is required"},
		{"missing updated_at", func(b *Bundle) { b.UpdatedAt = time.Time{} }, "updated_at is required"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := validBundle()
			tt.modify(&b)
			err := ValidateBundle(b)
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.expect) {
				t.Errorf("expected %q, got: %v", tt.expect, err)
			}
		})
	}
}

func TestValidateBundle_BadStep(t *testing.T) {
	b := validBundle()
	b.Steps = []Step{{StepID: "", Instruction: "do something"}}
	err := ValidateBundle(b)
	if err == nil || !strings.Contains(err.Error(), "step_id is required") {
		t.Fatalf("expected step error, got: %v", err)
	}
}

func TestValidateBundle_EmptySteps(t *testing.T) {
	b := validBundle()
	b.Steps = nil
	err := ValidateBundle(b)
	if err == nil || !strings.Contains(err.Error(), "at least one step is required") {
		t.Fatalf("expected empty-step rejection, got: %v", err)
	}
}

func TestValidateBundle_DuplicateOrder(t *testing.T) {
	b := validBundle()
	b.Steps[1].Order = b.Steps[0].Order
	err := ValidateBundle(b)
	if err == nil || !strings.Contains(err.Error(), "duplicate order") {
		t.Fatalf("expected duplicate order error, got: %v", err)
	}
}

func TestValidateBundle_DuplicateStepID(t *testing.T) {
	b := validBundle()
	b.Steps[1].StepID = b.Steps[0].StepID
	err := ValidateBundle(b)
	if err == nil || !strings.Contains(err.Error(), "duplicate step_id") {
		t.Fatalf("expected duplicate step_id error, got: %v", err)
	}
}

func TestValidateBundle_WithTrigger(t *testing.T) {
	b := validBundle()
	b.Trigger = &Trigger{TriggerKind: "keyword", Condition: "review"}
	if err := ValidateBundle(b); err != nil {
		t.Fatalf("bundle with trigger should be valid: %v", err)
	}
}

func TestValidateBundle_ArtifactRefOwnership(t *testing.T) {
	b := validBundle()
	b.ArtifactRefs = []artifactref.Ref{{
		FromKind:  artifactref.KindSkillBundle,
		FromID:    string(b.BundleID),
		ToKind:    artifactref.KindKnowledgePage,
		ToID:      "page_001",
		Strength:  artifactref.StrengthWeak,
		Role:      "guide",
		CreatedAt: ts,
		UpdatedAt: ts,
	}}
	if err := ValidateBundle(b); err != nil {
		t.Fatalf("bundle with artifact refs should be valid: %v", err)
	}
	b.ArtifactRefs[0].FromID = "other"
	err := ValidateBundle(b)
	if err == nil || !strings.Contains(err.Error(), "ownership must stay on the bundle") {
		t.Fatalf("expected ownership error, got: %v", err)
	}
}
