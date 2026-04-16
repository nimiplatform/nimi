package kernel

import (
	"errors"
	"fmt"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
)

// ValidateRule performs structural fail-closed validation on a single
// rule. Enforces all three state axes and their constraints.
func ValidateRule(r Rule) error {
	if r.RuleID == "" {
		return errors.New("validate rule: rule_id is required")
	}
	if err := validateRuleKind(r.Kind); err != nil {
		return fmt.Errorf("validate rule %s: %w", r.RuleID, err)
	}
	if r.Statement == "" {
		return fmt.Errorf("validate rule %s: statement is required", r.RuleID)
	}
	if r.Version < 1 {
		return fmt.Errorf("validate rule %s: version must be >= 1, got %d", r.RuleID, r.Version)
	}

	// Axis 1: anchor binding
	if err := validateAnchorBinding(r.AnchorBinding); err != nil {
		return fmt.Errorf("validate rule %s: %w", r.RuleID, err)
	}

	// Axis 2: alignment (only when anchored)
	if r.AnchorBinding == AnchorBindingAnchored {
		if err := validateAlignmentState(r.Alignment); err != nil {
			return fmt.Errorf("validate rule %s: %w", r.RuleID, err)
		}
	} else if r.Alignment == AlignmentLocalOverride {
		return fmt.Errorf("validate rule %s: local_override requires anchor_binding anchored", r.RuleID)
	} else if r.Alignment != "" {
		return fmt.Errorf("validate rule %s: alignment_state must be empty when anchor_binding is local_only", r.RuleID)
	}

	// Axis 3: lifecycle
	if err := validateLifecycleState(r.Lifecycle); err != nil {
		return fmt.Errorf("validate rule %s: %w", r.RuleID, err)
	}

	// Supersession invariant
	if r.Lifecycle == RuleLifecycleSuperseded && r.SupersededBy == "" {
		return fmt.Errorf("validate rule %s: superseded_by is required when lifecycle is superseded", r.RuleID)
	}

	// Timestamps
	if r.CreatedAt.IsZero() {
		return fmt.Errorf("validate rule %s: created_at is required", r.RuleID)
	}
	if r.UpdatedAt.IsZero() {
		return fmt.Errorf("validate rule %s: updated_at is required", r.RuleID)
	}

	// Source refs
	for i, ref := range r.SourceRefs {
		if err := validateSourceRef(ref); err != nil {
			return fmt.Errorf("validate rule %s: source_refs[%d]: %w", r.RuleID, i, err)
		}
	}
	for i, ref := range r.ArtifactRefs {
		if err := artifactref.Validate(ref); err != nil {
			return fmt.Errorf("validate rule %s: artifact_refs[%d]: %w", r.RuleID, i, err)
		}
		if ref.FromKind != artifactref.KindKernelRule || ref.FromID != string(r.RuleID) {
			return fmt.Errorf("validate rule %s: artifact_refs[%d]: ownership must stay on the rule", r.RuleID, i)
		}
	}
	if r.Lifecycle != RuleLifecycleSuperseded && r.SupersededBy != "" {
		return fmt.Errorf("validate rule %s: superseded_by is only allowed when lifecycle is superseded", r.RuleID)
	}
	return nil
}

// ValidateKernel performs structural validation on a Kernel container.
func ValidateKernel(k Kernel) error {
	if k.KernelID == "" {
		return errors.New("validate kernel: kernel_id is required")
	}
	if k.ScopeID == "" {
		return errors.New("validate kernel: scope_id is required")
	}
	if err := validateKernelType(k.KernelType); err != nil {
		return fmt.Errorf("validate kernel %s: %w", k.KernelID, err)
	}
	if k.Version < 1 {
		return fmt.Errorf("validate kernel %s: version must be >= 1, got %d", k.KernelID, k.Version)
	}
	if err := validateKernelStatus(k.Status); err != nil {
		return fmt.Errorf("validate kernel %s: %w", k.KernelID, err)
	}
	if k.CreatedAt.IsZero() {
		return fmt.Errorf("validate kernel %s: created_at is required", k.KernelID)
	}
	if k.UpdatedAt.IsZero() {
		return fmt.Errorf("validate kernel %s: updated_at is required", k.KernelID)
	}
	return nil
}

// ValidateAgentModelKernel validates an agent model kernel. Every
// rule must be self-facing. Kernel type must be agent_model.
func ValidateAgentModelKernel(k AgentModelKernel) error {
	if err := ValidateKernel(k.Kernel); err != nil {
		return fmt.Errorf("validate agent model kernel: %w", err)
	}
	if k.Kernel.KernelType != KernelTypeAgentModel {
		return fmt.Errorf("validate agent model kernel %s: kernel_type must be agent_model, got %s",
			k.Kernel.KernelID, k.Kernel.KernelType)
	}
	seen := make(map[RuleID]struct{}, len(k.Rules))
	for i, r := range k.Rules {
		if err := ValidateRule(r); err != nil {
			return fmt.Errorf("validate agent model kernel %s: rules[%d]: %w", k.Kernel.KernelID, i, err)
		}
		if r.Kind != RuleKindSelfFacing {
			return fmt.Errorf("validate agent model kernel %s: rules[%d]: rule_kind must be self_facing, got %s",
				k.Kernel.KernelID, i, r.Kind)
		}
		if _, dup := seen[r.RuleID]; dup {
			return fmt.Errorf("validate agent model kernel %s: rules[%d]: duplicate rule_id %s",
				k.Kernel.KernelID, i, r.RuleID)
		}
		seen[r.RuleID] = struct{}{}
	}
	return validateRuleRefsConsistency(k.Kernel.RuleRefs, k.Rules, k.Kernel.KernelID)
}

// ValidateWorldModelKernel validates a world model kernel. Every
// rule must be world-facing. Kernel type must be world_model.
func ValidateWorldModelKernel(k WorldModelKernel) error {
	if err := ValidateKernel(k.Kernel); err != nil {
		return fmt.Errorf("validate world model kernel: %w", err)
	}
	if k.Kernel.KernelType != KernelTypeWorldModel {
		return fmt.Errorf("validate world model kernel %s: kernel_type must be world_model, got %s",
			k.Kernel.KernelID, k.Kernel.KernelType)
	}
	seen := make(map[RuleID]struct{}, len(k.Rules))
	for i, r := range k.Rules {
		if err := ValidateRule(r); err != nil {
			return fmt.Errorf("validate world model kernel %s: rules[%d]: %w", k.Kernel.KernelID, i, err)
		}
		if r.Kind != RuleKindWorldFacing {
			return fmt.Errorf("validate world model kernel %s: rules[%d]: rule_kind must be world_facing, got %s",
				k.Kernel.KernelID, i, r.Kind)
		}
		if _, dup := seen[r.RuleID]; dup {
			return fmt.Errorf("validate world model kernel %s: rules[%d]: duplicate rule_id %s",
				k.Kernel.KernelID, i, r.RuleID)
		}
		seen[r.RuleID] = struct{}{}
	}
	return validateRuleRefsConsistency(k.Kernel.RuleRefs, k.Rules, k.Kernel.KernelID)
}

func validateRuleRefsConsistency(refs []RuleID, rules []Rule, kernelID string) error {
	ruleSet := make(map[RuleID]struct{}, len(rules))
	for _, r := range rules {
		ruleSet[r.RuleID] = struct{}{}
	}
	for _, ref := range refs {
		if _, ok := ruleSet[ref]; !ok {
			return fmt.Errorf("validate kernel %s: rule_refs contains %s which is not in rules", kernelID, ref)
		}
	}
	return nil
}

func validateRuleKind(k RuleKind) error {
	switch k {
	case RuleKindSelfFacing, RuleKindWorldFacing:
		return nil
	case "":
		return errors.New("rule_kind is required")
	default:
		return fmt.Errorf("invalid rule_kind %q", k)
	}
}

func validateAnchorBinding(b AnchorBinding) error {
	switch b {
	case AnchorBindingAnchored, AnchorBindingLocalOnly:
		return nil
	case "":
		return errors.New("anchor_binding is required")
	default:
		return fmt.Errorf("invalid anchor_binding %q", b)
	}
}

func validateAlignmentState(a AlignmentState) error {
	switch a {
	case AlignmentAligned, AlignmentStale, AlignmentConflicted, AlignmentLocalOverride:
		return nil
	case "":
		return errors.New("alignment_state is required when anchor_binding is anchored")
	default:
		return fmt.Errorf("invalid alignment_state %q", a)
	}
}

func validateLifecycleState(l RuleLifecycleState) error {
	switch l {
	case RuleLifecycleActive, RuleLifecycleSuperseded, RuleLifecycleInvalidated:
		return nil
	case "":
		return errors.New("rule_lifecycle_state is required")
	default:
		return fmt.Errorf("invalid rule_lifecycle_state %q", l)
	}
}

func validateKernelType(t KernelType) error {
	switch t {
	case KernelTypeAgentModel, KernelTypeWorldModel:
		return nil
	case "":
		return errors.New("kernel_type is required")
	default:
		return fmt.Errorf("invalid kernel_type %q", t)
	}
}

func validateKernelStatus(s KernelStatus) error {
	switch s {
	case KernelStatusActive, KernelStatusSuspended:
		return nil
	case "":
		return errors.New("status is required")
	default:
		return fmt.Errorf("invalid status %q", s)
	}
}

func validateSourceRef(ref SourceRef) error {
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

func validateRefStrength(r RefStrength) error {
	switch r {
	case RefStrong, RefWeak:
		return nil
	case "":
		return errors.New("strength is required")
	default:
		return fmt.Errorf("invalid ref_strength %q", r)
	}
}
