package skill

import (
	"errors"
	"fmt"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

// ValidateBundle performs structural fail-closed validation on a
// skill bundle.
func ValidateBundle(b Bundle) error {
	if b.BundleID == "" {
		return errors.New("validate bundle: bundle_id is required")
	}
	if b.ScopeID == "" {
		return fmt.Errorf("validate bundle %s: scope_id is required", b.BundleID)
	}
	if b.Version < 1 {
		return fmt.Errorf("validate bundle %s: version must be >= 1, got %d", b.BundleID, b.Version)
	}
	if err := validateBundleStatus(b.Status); err != nil {
		return fmt.Errorf("validate bundle %s: %w", b.BundleID, err)
	}
	if b.Name == "" {
		return fmt.Errorf("validate bundle %s: name is required", b.BundleID)
	}
	if len(b.Steps) == 0 {
		return fmt.Errorf("validate bundle %s: at least one step is required", b.BundleID)
	}
	seenStepIDs := make(map[string]struct{}, len(b.Steps))
	seenOrders := make(map[int]struct{}, len(b.Steps))
	for i, step := range b.Steps {
		if err := validateStep(step); err != nil {
			return fmt.Errorf("validate bundle %s: steps[%d]: %w", b.BundleID, i, err)
		}
		if _, exists := seenStepIDs[step.StepID]; exists {
			return fmt.Errorf("validate bundle %s: steps[%d]: duplicate step_id %q", b.BundleID, i, step.StepID)
		}
		seenStepIDs[step.StepID] = struct{}{}
		if _, exists := seenOrders[step.Order]; exists {
			return fmt.Errorf("validate bundle %s: steps[%d]: duplicate order %d", b.BundleID, i, step.Order)
		}
		seenOrders[step.Order] = struct{}{}
	}
	if b.Trigger != nil {
		if err := validateTrigger(*b.Trigger); err != nil {
			return fmt.Errorf("validate bundle %s: trigger: %w", b.BundleID, err)
		}
	}
	for i, ref := range b.SourceRefs {
		if err := validateSourceRef(ref); err != nil {
			return fmt.Errorf("validate bundle %s: source_refs[%d]: %w", b.BundleID, i, err)
		}
	}
	for i, ref := range b.ArtifactRefs {
		if err := artifactref.Validate(ref); err != nil {
			return fmt.Errorf("validate bundle %s: artifact_refs[%d]: %w", b.BundleID, i, err)
		}
		if ref.FromKind != artifactref.KindSkillBundle || ref.FromID != string(b.BundleID) {
			return fmt.Errorf("validate bundle %s: artifact_refs[%d]: ownership must stay on the bundle", b.BundleID, i)
		}
	}
	if b.CreatedAt.IsZero() {
		return fmt.Errorf("validate bundle %s: created_at is required", b.BundleID)
	}
	if b.UpdatedAt.IsZero() {
		return fmt.Errorf("validate bundle %s: updated_at is required", b.BundleID)
	}
	return nil
}

func validateStep(s Step) error {
	if s.StepID == "" {
		return errors.New("step_id is required")
	}
	if s.Instruction == "" {
		return errors.New("instruction is required")
	}
	if s.Order <= 0 {
		return errors.New("order must be > 0")
	}
	return nil
}

func validateTrigger(t Trigger) error {
	if t.TriggerKind == "" {
		return errors.New("trigger_kind is required")
	}
	if t.Condition == "" {
		return errors.New("condition is required")
	}
	return nil
}

func validateBundleStatus(s BundleStatus) error {
	switch s {
	case BundleStatusDraft, BundleStatusActive, BundleStatusArchived, BundleStatusRemoved:
		return nil
	case "":
		return errors.New("status is required")
	default:
		return fmt.Errorf("invalid status %q", s)
	}
}

func validateSourceRef(ref kernel.SourceRef) error {
	if ref.SourceType == "" {
		return errors.New("source_type is required")
	}
	if ref.SourceID == "" {
		return errors.New("source_id is required")
	}
	if err := validateRefStrength(ref.Strength); err != nil {
		return err
	}
	if ref.ObservedAt.IsZero() {
		return errors.New("observed_at is required")
	}
	return nil
}

func validateRefStrength(strength kernel.RefStrength) error {
	switch strength {
	case kernel.RefStrong, kernel.RefWeak:
		return nil
	case "":
		return errors.New("strength is required")
	default:
		return fmt.Errorf("invalid ref strength %q", strength)
	}
}
