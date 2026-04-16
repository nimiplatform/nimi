package kernelops

import (
	"errors"
	"fmt"

	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

// ValidateIncomingPatch validates an incoming patch structurally.
func ValidateIncomingPatch(p IncomingPatch) error {
	if p.PatchID == "" {
		return errors.New("validate patch: patch_id is required")
	}
	if p.ScopeID == "" {
		return fmt.Errorf("validate patch %s: scope_id is required", p.PatchID)
	}
	if err := validateTargetKernel(p.TargetKernel); err != nil {
		return fmt.Errorf("validate patch %s: %w", p.PatchID, err)
	}
	if len(p.ProposedChanges) == 0 {
		return fmt.Errorf("validate patch %s: at least one proposed_change is required", p.PatchID)
	}
	if p.SubmittedBy == "" {
		return fmt.Errorf("validate patch %s: submitted_by is required", p.PatchID)
	}
	if p.SubmittedAt.IsZero() {
		return fmt.Errorf("validate patch %s: submitted_at is required", p.PatchID)
	}
	for i, c := range p.ProposedChanges {
		if err := validateProposedChange(c); err != nil {
			return fmt.Errorf("validate patch %s: proposed_changes[%d]: %w", p.PatchID, i, err)
		}
	}
	return nil
}

// ValidateResolvedPatch validates a resolved patch structurally.
func ValidateResolvedPatch(p ResolvedPatch) error {
	if p.ResolvedPatchID == "" {
		return errors.New("validate resolved patch: resolved_patch_id is required")
	}
	if p.ScopeID == "" {
		return fmt.Errorf("validate resolved patch %s: scope_id is required", p.ResolvedPatchID)
	}
	if err := validateTargetKernel(p.TargetKernel); err != nil {
		return fmt.Errorf("validate resolved patch %s: %w", p.ResolvedPatchID, err)
	}
	if len(p.ResolvedChanges) == 0 {
		return fmt.Errorf("validate resolved patch %s: at least one resolved_change is required", p.ResolvedPatchID)
	}
	if p.ResolvedBy == "" {
		return fmt.Errorf("validate resolved patch %s: resolved_by is required", p.ResolvedPatchID)
	}
	if p.ResolvedAt.IsZero() {
		return fmt.Errorf("validate resolved patch %s: resolved_at is required", p.ResolvedPatchID)
	}
	for i, c := range p.ResolvedChanges {
		if err := validateResolvedChange(c); err != nil {
			return fmt.Errorf("validate resolved patch %s: resolved_changes[%d]: %w", p.ResolvedPatchID, i, err)
		}
	}
	return nil
}

func validateProposedChange(c ProposedChange) error {
	if err := validateChangeKind(c.ChangeKind); err != nil {
		return err
	}
	switch c.ChangeKind {
	case ChangeKindAdd:
		if c.NewRule == nil {
			return errors.New("new_rule is required for add")
		}
		if c.RuleID != "" && c.NewRule.RuleID != c.RuleID {
			return errors.New("rule_id must match new_rule.rule_id for add")
		}
		if err := kernel.ValidateRule(*c.NewRule); err != nil {
			return fmt.Errorf("new_rule: %w", err)
		}
	case ChangeKindUpdate:
		if c.RuleID == "" {
			return errors.New("rule_id is required for update")
		}
		if c.BaseVersion < 1 {
			return errors.New("base_version is required for update")
		}
		if c.NewRule == nil {
			return errors.New("new_rule is required for update")
		}
		if c.NewRule.RuleID != c.RuleID {
			return errors.New("rule_id must match new_rule.rule_id for update")
		}
		if c.NewRule.Version <= c.BaseVersion {
			return errors.New("new_rule.version must advance beyond base_version for update")
		}
		if err := kernel.ValidateRule(*c.NewRule); err != nil {
			return fmt.Errorf("new_rule: %w", err)
		}
	case ChangeKindRemove:
		if c.RuleID == "" {
			return errors.New("rule_id is required for remove")
		}
		if c.BaseVersion < 1 {
			return errors.New("base_version is required for remove")
		}
	}
	return nil
}

func validateResolvedChange(c ResolvedChange) error {
	if err := validateChangeKind(c.ChangeKind); err != nil {
		return err
	}
	if err := validateResolutionKind(c.ResolutionKind); err != nil {
		return err
	}
	if c.ChangeKind != ChangeKindRemove && c.FinalRule == nil {
		return fmt.Errorf("final_rule is required for %s", c.ChangeKind)
	}
	if c.FinalRule != nil {
		if c.RuleID != "" && c.FinalRule.RuleID != c.RuleID {
			return errors.New("rule_id must match final_rule.rule_id")
		}
		if err := kernel.ValidateRule(*c.FinalRule); err != nil {
			return fmt.Errorf("final_rule: %w", err)
		}
	}
	if c.ChangeKind != ChangeKindAdd && c.BaseVersion < 1 {
		return errors.New("base_version is required for update/remove")
	}
	return nil
}

func validateTargetKernel(t kernel.KernelType) error {
	switch t {
	case kernel.KernelTypeAgentModel, kernel.KernelTypeWorldModel:
		return nil
	case "":
		return errors.New("target_kernel is required")
	default:
		return fmt.Errorf("invalid target_kernel %q", t)
	}
}

func validateChangeKind(k ChangeKind) error {
	switch k {
	case ChangeKindAdd, ChangeKindUpdate, ChangeKindRemove:
		return nil
	case "":
		return errors.New("change_kind is required")
	default:
		return fmt.Errorf("invalid change_kind %q", k)
	}
}

func validateResolutionKind(k ResolutionKind) error {
	switch k {
	case ResolutionKindKeepLocal, ResolutionKindAcceptPatch,
		ResolutionKindManualMerge, ResolutionKindLocalOverride:
		return nil
	case "":
		return errors.New("resolution_kind is required")
	default:
		return fmt.Errorf("invalid resolution_kind %q", k)
	}
}
