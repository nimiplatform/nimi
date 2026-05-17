package appregistrycatalog

import (
	"errors"
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/defaultexperience"
)

// ValidationContext bundles cross-table inputs that the registry rows
// must resolve against. Each input is required.
type ValidationContext struct {
	DefaultExperienceCatalog *defaultexperience.Catalog
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
	if ctx.DefaultExperienceCatalog == nil || len(ctx.AdmittedTrustTiers) == 0 {
		return []CrossTableViolation{{
			Field:  "<context>",
			Reason: ErrValidationContextMissing.Error(),
		}}
	}
	tierAdmitted := make(map[TrustTier]bool, len(ctx.AdmittedTrustTiers))
	for _, tier := range ctx.AdmittedTrustTiers {
		tierAdmitted[tier] = true
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
		if app.DefaultExperienceAliasRef != "" {
			if _, ok := ctx.DefaultExperienceCatalog.FindByAlias(app.DefaultExperienceAliasRef); !ok {
				violations = append(violations, CrossTableViolation{
					AppID:  app.AppID,
					Field:  "default_experience_alias_ref",
					Value:  app.DefaultExperienceAliasRef,
					Reason: "alias not present in Default Experience Profile catalog",
				})
			}
		}
	}
	return violations
}
