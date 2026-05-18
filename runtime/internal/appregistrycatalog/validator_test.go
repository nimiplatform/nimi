package appregistrycatalog

import (
	"strings"
	"testing"
)

// admittedAliasFixture mirrors the admitted factory AIProfile aliases
// in `.nimi/spec/platform/kernel/tables/ai-profile-factory-catalog.yaml`
// (cloud-first, local-standard, local-speech-ready, local-gpu,
// hybrid-recommended). Validator does not parse the catalog itself;
// tests supply the alias set directly.
func admittedAliasFixture() []string {
	return []string{
		"cloud-first",
		"local-standard",
		"local-speech-ready",
		"local-gpu",
		"hybrid-recommended",
	}
}

func loadRegistryForValidator(t *testing.T) *Registry {
	t.Helper()
	registry, err := LoadRegistry(strings.NewReader(sampleRegistryYAML))
	if err != nil {
		t.Fatalf("LoadRegistry: %v", err)
	}
	return registry
}

func TestCrossTableValidate_NoViolationsOnHealthyCatalogs(t *testing.T) {
	registry := loadRegistryForValidator(t)
	ctx := ValidationContext{
		AdmittedAIProfileAliases: admittedAliasFixture(),
		AdmittedTrustTiers: []TrustTier{
			TrustTierFirstParty,
			TrustTierVerifiedPartner,
			TrustTierCommunity,
		},
	}
	violations := registry.CrossTableValidate(ctx)
	if len(violations) != 0 {
		t.Errorf("expected 0 violations, got %d: %v", len(violations), violations)
	}
}

func TestCrossTableValidate_FlagsUnresolvedProfileAlias(t *testing.T) {
	// avatar references local-gpu and parentos references cloud-first.
	// Build an admitted-alias set that omits local-gpu; avatar should be
	// flagged.
	registry := loadRegistryForValidator(t)
	ctx := ValidationContext{
		AdmittedAIProfileAliases: []string{"cloud-first"},
		AdmittedTrustTiers:       []TrustTier{TrustTierFirstParty},
	}
	violations := registry.CrossTableValidate(ctx)
	flagged := false
	for _, v := range violations {
		if v.AppID == "nimi.avatar" && v.Field == "ai_profile_selection_ref" && v.Value == "local-gpu" {
			flagged = true
		}
	}
	if !flagged {
		t.Errorf("expected avatar local-gpu alias to be flagged; got %v", violations)
	}
}

func TestCrossTableValidate_FlagsUnadmittedTrustTier(t *testing.T) {
	registry := loadRegistryForValidator(t)
	ctx := ValidationContext{
		AdmittedAIProfileAliases: admittedAliasFixture(),
		AdmittedTrustTiers:       []TrustTier{TrustTierCommunity},
	}
	violations := registry.CrossTableValidate(ctx)
	if len(violations) == 0 {
		t.Errorf("expected first-party-tier-only apps to be flagged; got 0 violations")
	}
}

func TestCrossTableValidate_RejectsMissingContext(t *testing.T) {
	registry := loadRegistryForValidator(t)
	violations := registry.CrossTableValidate(ValidationContext{})
	if len(violations) != 1 {
		t.Errorf("expected 1 missing-context violation, got %d", len(violations))
	}
}

func TestCrossTableValidate_NilReceiver(t *testing.T) {
	var r *Registry
	violations := r.CrossTableValidate(ValidationContext{
		AdmittedAIProfileAliases: nil,
		AdmittedTrustTiers:       nil,
	})
	if violations != nil {
		t.Errorf("nil receiver should return nil, got %v", violations)
	}
}
