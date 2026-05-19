package appregistrycatalog

import (
	"errors"
	"fmt"
)

// ValidationContext bundles cross-table inputs that the registry rows
// must resolve against. Each input is required.
//
// `AdmittedAIProfileAliases` is the opaque set of factory AIProfile
// aliases / profileIds admitted by the Platform-owned factory AIProfile
// catalog (`P-AIPS-002`, `tables/ai-profile-factory-catalog.yaml`). The
// validator does not parse the catalog itself; callers supply the set
// from whatever source they choose, keeping `appregistrycatalog` free of
// any Runtime-side product-selection ownership.
type ValidationContext struct {
	AdmittedAIProfileAliases []string
	AdmittedTrustTiers       []TrustTier
	ReleaseDescriptors       []ReleaseDescriptorValidationRef
	StoragePolicyRefs        []string
}

// ReleaseDescriptorValidationRef is the minimum Runtime registry validator
// needs from the Platform release descriptor table. The full descriptor is
// parsed by appreleasecatalog; registry validation only consumes the app and
// storage ownership binding needed to prevent cross-app descriptor reuse.
type ReleaseDescriptorValidationRef struct {
	DescriptorID     string
	AppID            string
	StoragePolicyRef string
}

// CrossTableViolation reports a single row reference that fails to
// resolve against the validation context.
type CrossTableViolation struct {
	AppID  string
	Field  string
	Value  string
	Reason string
}

func (v CrossTableViolation) Error() string {
	return fmt.Sprintf("registry %q field %q value %q: %s", v.AppID, v.Field, v.Value, v.Reason)
}

var (
	ErrValidationContextMissing = errors.New("appregistrycatalog ValidationContext missing required inputs")
)

// CrossTableValidate sweeps every registry row against the validation
// context. Returns nil when all rows resolve. Returns wrapped error
// listing every violation when any references are unresolved.
func (r *Registry) CrossTableValidate(ctx ValidationContext) []CrossTableViolation {
	if r == nil {
		return nil
	}
	if len(ctx.AdmittedAIProfileAliases) == 0 || len(ctx.AdmittedTrustTiers) == 0 ||
		len(ctx.ReleaseDescriptors) == 0 || len(ctx.StoragePolicyRefs) == 0 {
		return []CrossTableViolation{{
			Field:  "<context>",
			Reason: ErrValidationContextMissing.Error(),
		}}
	}
	tierAdmitted := make(map[TrustTier]bool, len(ctx.AdmittedTrustTiers))
	for _, tier := range ctx.AdmittedTrustTiers {
		tierAdmitted[tier] = true
	}
	aliasAdmitted := make(map[string]bool, len(ctx.AdmittedAIProfileAliases))
	for _, alias := range ctx.AdmittedAIProfileAliases {
		aliasAdmitted[alias] = true
	}
	descriptorAdmitted := make(map[string]ReleaseDescriptorValidationRef, len(ctx.ReleaseDescriptors))
	for _, descriptor := range ctx.ReleaseDescriptors {
		descriptorAdmitted[descriptor.DescriptorID] = descriptor
	}
	storageAdmitted := make(map[string]bool, len(ctx.StoragePolicyRefs))
	for _, ref := range ctx.StoragePolicyRefs {
		storageAdmitted[ref] = true
	}
	violations := []CrossTableViolation{}
	for index := range r.Apps {
		app := &r.Apps[index]
		if !tierAdmitted[app.TrustTierRef] {
			violations = append(violations, CrossTableViolation{
				AppID:  app.AppID,
				Field:  "trust_tier_ref",
				Value:  string(app.TrustTierRef),
				Reason: "not in admitted trust tier set",
			})
		}
		if app.AIProfileSelectionRef != "" {
			if !aliasAdmitted[app.AIProfileSelectionRef] {
				violations = append(violations, CrossTableViolation{
					AppID:  app.AppID,
					Field:  "ai_profile_selection_ref",
					Value:  app.AIProfileSelectionRef,
					Reason: "alias not present in admitted factory AIProfile catalog",
				})
			}
		}
		descriptor, descriptorOK := descriptorAdmitted[app.ReleaseDescriptorRef]
		if !descriptorOK {
			violations = append(violations, CrossTableViolation{
				AppID:  app.AppID,
				Field:  "release_descriptor_ref",
				Value:  app.ReleaseDescriptorRef,
				Reason: "not in admitted release descriptor set",
			})
		} else {
			if descriptor.AppID != app.AppID {
				violations = append(violations, CrossTableViolation{
					AppID:  app.AppID,
					Field:  "release_descriptor_ref",
					Value:  app.ReleaseDescriptorRef,
					Reason: "release descriptor belongs to a different app",
				})
			}
			if descriptor.StoragePolicyRef != app.InstallStoragePolicyRef {
				violations = append(violations, CrossTableViolation{
					AppID:  app.AppID,
					Field:  "release_descriptor_ref",
					Value:  app.ReleaseDescriptorRef,
					Reason: "release descriptor storage policy does not match install_storage_policy_ref",
				})
			}
		}
		if !storageAdmitted[app.InstallStoragePolicyRef] {
			violations = append(violations, CrossTableViolation{
				AppID:  app.AppID,
				Field:  "install_storage_policy_ref",
				Value:  app.InstallStoragePolicyRef,
				Reason: "not in admitted storage policy set",
			})
		}
	}
	return violations
}

// ValidateReleaseDescriptorBindings validates the registry fields needed before
// Runtime can consume a Platform app registry projection. It intentionally does
// not require AIProfile catalog inputs, because those belong to separate
// projection plumbing.
func (r *Registry) ValidateReleaseDescriptorBindings(releaseDescriptors []ReleaseDescriptorValidationRef, storagePolicyRefs []string) []CrossTableViolation {
	if r == nil {
		return nil
	}
	if len(releaseDescriptors) == 0 || len(storagePolicyRefs) == 0 {
		return []CrossTableViolation{{
			Field:  "<context>",
			Reason: ErrValidationContextMissing.Error(),
		}}
	}
	descriptorAdmitted := make(map[string]ReleaseDescriptorValidationRef, len(releaseDescriptors))
	for _, descriptor := range releaseDescriptors {
		descriptorAdmitted[descriptor.DescriptorID] = descriptor
	}
	storageAdmitted := make(map[string]bool, len(storagePolicyRefs))
	for _, ref := range storagePolicyRefs {
		storageAdmitted[ref] = true
	}
	violations := []CrossTableViolation{}
	for index := range r.Apps {
		app := &r.Apps[index]
		descriptor, descriptorOK := descriptorAdmitted[app.ReleaseDescriptorRef]
		if !descriptorOK {
			violations = append(violations, CrossTableViolation{
				AppID:  app.AppID,
				Field:  "release_descriptor_ref",
				Value:  app.ReleaseDescriptorRef,
				Reason: "not in admitted release descriptor set",
			})
		} else {
			if descriptor.AppID != app.AppID {
				violations = append(violations, CrossTableViolation{
					AppID:  app.AppID,
					Field:  "release_descriptor_ref",
					Value:  app.ReleaseDescriptorRef,
					Reason: "release descriptor belongs to a different app",
				})
			}
			if descriptor.StoragePolicyRef != app.InstallStoragePolicyRef {
				violations = append(violations, CrossTableViolation{
					AppID:  app.AppID,
					Field:  "release_descriptor_ref",
					Value:  app.ReleaseDescriptorRef,
					Reason: "release descriptor storage policy does not match install_storage_policy_ref",
				})
			}
		}
		if !storageAdmitted[app.InstallStoragePolicyRef] {
			violations = append(violations, CrossTableViolation{
				AppID:  app.AppID,
				Field:  "install_storage_policy_ref",
				Value:  app.InstallStoragePolicyRef,
				Reason: "not in admitted storage policy set",
			})
		}
	}
	return violations
}
