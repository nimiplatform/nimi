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
	if len(ctx.AdmittedAIProfileAliases) == 0 || len(ctx.AdmittedTrustTiers) == 0 {
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
	}
	return violations
}
