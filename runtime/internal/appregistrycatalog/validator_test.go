package appregistrycatalog

import (
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/defaultexperience"
)

const profilesForValidator = `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_default_experience_profiles
profiles:
  - alias: cloud-first
    privacy_posture: cloud-ok
    compute_posture: cloud-only
    capability_set: [text.generate]
    routing_policy: cloud-first
    host_capability_profile_refs: [darwin-arm64-metal]
    local_compute_pack_refs: []
    dependency_family_refs: []
    materialization_confirmation_required: false
    applicable_scopes: [first-run, first-party-app, scope-bound-apply]
    source_rule: P-DXP-002
  - alias: local-gpu
    privacy_posture: local-preferred
    compute_posture: cuda-capable
    capability_set: [text.generate]
    routing_policy: local-first
    host_capability_profile_refs: [windows-amd64-nvidia-cuda]
    local_compute_pack_refs: [local-gpu-support]
    dependency_family_refs: [model.asset]
    materialization_confirmation_required: true
    applicable_scopes: [first-run, first-party-app, scope-bound-apply]
    source_rule: P-DXP-002
`

func loadFixturesForValidator(t *testing.T) (*Registry, *defaultexperience.Catalog) {
	t.Helper()
	registry, err := LoadRegistry(strings.NewReader(sampleRegistryYAML))
	if err != nil {
		t.Fatalf("LoadRegistry: %v", err)
	}
	profiles, err := defaultexperience.LoadCatalog(strings.NewReader(profilesForValidator))
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	return registry, profiles
}

func TestCrossTableValidate_NoViolationsOnHealthyCatalogs(t *testing.T) {
	registry, profiles := loadFixturesForValidator(t)
	ctx := ValidationContext{
		DefaultExperienceCatalog: profiles,
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
	// Build a catalog that only has cloud-first; avatar should be flagged.
	const reducedProfiles = `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_default_experience_profiles
profiles:
  - alias: cloud-first
    privacy_posture: cloud-ok
    compute_posture: cloud-only
    capability_set: [text.generate]
    routing_policy: cloud-first
    host_capability_profile_refs: [darwin-arm64-metal]
    local_compute_pack_refs: []
    dependency_family_refs: []
    materialization_confirmation_required: false
    applicable_scopes: [first-run, first-party-app, scope-bound-apply]
    source_rule: P-DXP-002
`
	registry, _ := loadFixturesForValidator(t)
	profiles, err := defaultexperience.LoadCatalog(strings.NewReader(reducedProfiles))
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	ctx := ValidationContext{
		DefaultExperienceCatalog: profiles,
		AdmittedTrustTiers:       []TrustTier{TrustTierFirstParty},
	}
	violations := registry.CrossTableValidate(ctx)
	flagged := false
	for _, v := range violations {
		if v.AppID == "nimi.avatar" && v.Field == "default_experience_alias_ref" && v.Value == "local-gpu" {
			flagged = true
		}
	}
	if !flagged {
		t.Errorf("expected avatar local-gpu alias to be flagged; got %v", violations)
	}
}

func TestCrossTableValidate_FlagsUnadmittedTrustTier(t *testing.T) {
	registry, profiles := loadFixturesForValidator(t)
	ctx := ValidationContext{
		DefaultExperienceCatalog: profiles,
		AdmittedTrustTiers:       []TrustTier{TrustTierCommunity},
	}
	violations := registry.CrossTableValidate(ctx)
	if len(violations) == 0 {
		t.Errorf("expected first-party-tier-only apps to be flagged; got 0 violations")
	}
}

func TestCrossTableValidate_RejectsMissingContext(t *testing.T) {
	registry, _ := loadFixturesForValidator(t)
	violations := registry.CrossTableValidate(ValidationContext{})
	if len(violations) != 1 {
		t.Errorf("expected 1 missing-context violation, got %d", len(violations))
	}
}

func TestCrossTableValidate_NilReceiver(t *testing.T) {
	var r *Registry
	violations := r.CrossTableValidate(ValidationContext{
		DefaultExperienceCatalog: nil,
		AdmittedTrustTiers:       nil,
	})
	if violations != nil {
		t.Errorf("nil receiver should return nil, got %v", violations)
	}
}
