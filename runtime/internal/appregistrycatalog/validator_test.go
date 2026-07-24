package appregistrycatalog

import (
	"strings"
	"testing"
)

// admittedAliasFixture mirrors the admitted factory AIProfile aliases
// in `config/platform-ai-profile-factory-catalog.yaml`
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

func releaseDescriptorFixture() []ReleaseDescriptorValidationRef {
	return []ReleaseDescriptorValidationRef{
		{
			DescriptorID:     "nimi.avatar.bundled-with-nimi",
			AppID:            "nimi.avatar",
			StoragePolicyRef: "nimi-data-app-roots",
		},
		{
			DescriptorID:     "nimi.example-app.bundled-with-nimi",
			AppID:            "nimi.example-app",
			StoragePolicyRef: "nimi-data-app-roots",
		},
	}
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
		ReleaseDescriptors: releaseDescriptorFixture(),
		StoragePolicyRefs:  []string{"nimi-data-app-roots"},
	}
	violations := registry.CrossTableValidate(ctx)
	if len(violations) != 0 {
		t.Errorf("expected 0 violations, got %d: %v", len(violations), violations)
	}
}

func TestCrossTableValidate_FlagsUnresolvedProfileAlias(t *testing.T) {
	// avatar references local-gpu and example-app references cloud-first.
	// Build an admitted-alias set that omits local-gpu; avatar should be
	// flagged.
	registry := loadRegistryForValidator(t)
	ctx := ValidationContext{
		AdmittedAIProfileAliases: []string{"cloud-first"},
		AdmittedTrustTiers:       []TrustTier{TrustTierFirstParty},
		ReleaseDescriptors:       releaseDescriptorFixture(),
		StoragePolicyRefs:        []string{"nimi-data-app-roots"},
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
		ReleaseDescriptors:       releaseDescriptorFixture(),
		StoragePolicyRefs:        []string{"nimi-data-app-roots"},
	}
	violations := registry.CrossTableValidate(ctx)
	if len(violations) == 0 {
		t.Errorf("expected first-party-tier-only apps to be flagged; got 0 violations")
	}
}

func TestCrossTableValidate_FlagsUnresolvedReleaseDescriptor(t *testing.T) {
	registry := loadRegistryForValidator(t)
	ctx := ValidationContext{
		AdmittedAIProfileAliases: admittedAliasFixture(),
		AdmittedTrustTiers:       []TrustTier{TrustTierFirstParty},
		ReleaseDescriptors: []ReleaseDescriptorValidationRef{
			{
				DescriptorID:     "nimi.avatar.bundled-with-nimi",
				AppID:            "nimi.avatar",
				StoragePolicyRef: "nimi-data-app-roots",
			},
		},
		StoragePolicyRefs: []string{"nimi-data-app-roots"},
	}
	violations := registry.CrossTableValidate(ctx)
	flagged := false
	for _, v := range violations {
		if v.AppID == "nimi.example-app" && v.Field == "release_descriptor_ref" {
			flagged = true
		}
	}
	if !flagged {
		t.Errorf("expected example-app release descriptor to be flagged; got %v", violations)
	}
}

func TestCrossTableValidate_FlagsCrossAppReleaseDescriptor(t *testing.T) {
	registry := loadRegistryForValidator(t)
	ctx := ValidationContext{
		AdmittedAIProfileAliases: admittedAliasFixture(),
		AdmittedTrustTiers:       []TrustTier{TrustTierFirstParty},
		ReleaseDescriptors: []ReleaseDescriptorValidationRef{
			{
				DescriptorID:     "nimi.avatar.bundled-with-nimi",
				AppID:            "nimi.avatar",
				StoragePolicyRef: "nimi-data-app-roots",
			},
			{
				DescriptorID:     "nimi.example-app.bundled-with-nimi",
				AppID:            "nimi.avatar",
				StoragePolicyRef: "nimi-data-app-roots",
			},
		},
		StoragePolicyRefs: []string{"nimi-data-app-roots"},
	}
	violations := registry.CrossTableValidate(ctx)
	flagged := false
	for _, v := range violations {
		if v.AppID == "nimi.example-app" && v.Field == "release_descriptor_ref" && v.Reason == "release descriptor belongs to a different app" {
			flagged = true
		}
	}
	if !flagged {
		t.Errorf("expected example-app cross-app descriptor to be flagged; got %v", violations)
	}
}

func TestCrossTableValidate_FlagsDescriptorStorageMismatch(t *testing.T) {
	registry := loadRegistryForValidator(t)
	ctx := ValidationContext{
		AdmittedAIProfileAliases: admittedAliasFixture(),
		AdmittedTrustTiers:       []TrustTier{TrustTierFirstParty},
		ReleaseDescriptors: []ReleaseDescriptorValidationRef{
			{
				DescriptorID:     "nimi.avatar.bundled-with-nimi",
				AppID:            "nimi.avatar",
				StoragePolicyRef: "nimi-data-app-roots",
			},
			{
				DescriptorID:     "nimi.example-app.bundled-with-nimi",
				AppID:            "nimi.example-app",
				StoragePolicyRef: "other-storage-policy",
			},
		},
		StoragePolicyRefs: []string{"nimi-data-app-roots", "other-storage-policy"},
	}
	violations := registry.CrossTableValidate(ctx)
	flagged := false
	for _, v := range violations {
		if v.AppID == "nimi.example-app" && v.Field == "release_descriptor_ref" && v.Reason == "release descriptor storage policy does not match install_storage_policy_ref" {
			flagged = true
		}
	}
	if !flagged {
		t.Errorf("expected example-app descriptor storage mismatch to be flagged; got %v", violations)
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
