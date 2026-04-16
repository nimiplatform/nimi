// Package artifactref provides the unified internal-reference model used by
// standalone cognition artifacts.
//
// Reference ownership always lives on the referencing artifact. Referenced
// artifacts never carry downstream ownership metadata.
package artifactref

import (
	"errors"
	"fmt"
	"time"
)

// Kind identifies the owning or target artifact family for an internal ref.
type Kind string

const (
	KindKernelRule    Kind = "kernel_rule"
	KindMemoryRecord  Kind = "memory_record"
	KindKnowledgePage Kind = "knowledge_page"
	KindSkillBundle   Kind = "skill_bundle"
)

// Strength classifies how strongly the source artifact depends on the target.
type Strength string

const (
	StrengthStrong Strength = "strong_ref"
	StrengthWeak   Strength = "weak_ref"
)

// Ref is a unified internal artifact reference.
type Ref struct {
	FromKind  Kind      `json:"from_kind"`
	FromID    string    `json:"from_id"`
	ToKind    Kind      `json:"to_kind"`
	ToID      string    `json:"to_id"`
	Strength  Strength  `json:"strength"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Validate checks a reference structurally.
func Validate(r Ref) error {
	if err := validateKind("from_kind", r.FromKind); err != nil {
		return err
	}
	if r.FromID == "" {
		return errors.New("from_id is required")
	}
	if err := validateKind("to_kind", r.ToKind); err != nil {
		return err
	}
	if r.ToID == "" {
		return errors.New("to_id is required")
	}
	if r.FromKind == r.ToKind && r.FromID == r.ToID {
		return errors.New("self-reference is not allowed")
	}
	if err := validateStrength(r.Strength); err != nil {
		return err
	}
	if r.Role == "" {
		return errors.New("role is required")
	}
	if r.CreatedAt.IsZero() {
		return errors.New("created_at is required")
	}
	if r.UpdatedAt.IsZero() {
		return errors.New("updated_at is required")
	}
	return nil
}

func validateKind(field string, k Kind) error {
	switch k {
	case KindKernelRule, KindMemoryRecord, KindKnowledgePage, KindSkillBundle:
		return nil
	case "":
		return fmt.Errorf("%s is required", field)
	default:
		return fmt.Errorf("invalid %s %q", field, k)
	}
}

func validateStrength(s Strength) error {
	switch s {
	case StrengthStrong, StrengthWeak:
		return nil
	case "":
		return errors.New("strength is required")
	default:
		return fmt.Errorf("invalid strength %q", s)
	}
}
