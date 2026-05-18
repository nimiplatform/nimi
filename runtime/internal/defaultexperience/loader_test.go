package defaultexperience

import (
	"errors"
	"strings"
	"testing"
)

const canonicalCatalogYAML = `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_default_experience_profiles

profiles:
  - alias: cloud-first
    privacy_posture: cloud-ok
    compute_posture: cloud-only
    capability_set:
      - text.generate
      - text.embed
    routing_policy: cloud-first
    host_capability_profile_refs:
      - windows-amd64-cpu
      - darwin-arm64-metal
    local_compute_pack_refs: []
    dependency_family_refs: []
    materialization_confirmation_required: false
    applicable_scopes:
      - first-run
      - first-party-app
      - scope-bound-apply
    source_rule: P-DXP-002

  - alias: local-standard
    privacy_posture: local-preferred
    compute_posture: cpu-only
    capability_set:
      - text.generate
      - text.embed
    routing_policy: local-first
    host_capability_profile_refs:
      - windows-amd64-cpu
      - darwin-arm64-metal
    local_compute_pack_refs:
      - local-text
    dependency_family_refs:
      - native-engine-package.family
      - model.asset
    materialization_confirmation_required: true
    applicable_scopes:
      - first-run
      - first-party-app
      - scope-bound-apply
    source_rule: P-DXP-002

  - alias: local-gpu
    privacy_posture: local-preferred
    compute_posture: cuda-capable
    capability_set:
      - text.generate
      - text.embed
      - image.generate
    routing_policy: local-first
    host_capability_profile_refs:
      - windows-amd64-nvidia-cuda
    local_compute_pack_refs:
      - local-text
      - local-gpu-support
    dependency_family_refs:
      - accelerator.cuda.runtime
      - model.asset
    materialization_confirmation_required: true
    applicable_scopes:
      - first-run
      - first-party-app
      - scope-bound-apply
    source_rule: P-DXP-002
`

func TestLoadCatalog_ParsesCanonicalYAML(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	if catalog.Version != 1 {
		t.Errorf("Version = %d, want 1", catalog.Version)
	}
	if catalog.TableFamily != "product_catalog" {
		t.Errorf("TableFamily = %q, want %q", catalog.TableFamily, "product_catalog")
	}
	if catalog.Owner != "platform" {
		t.Errorf("Owner = %q, want %q", catalog.Owner, "platform")
	}
	if catalog.CatalogID != "platform_default_experience_profiles" {
		t.Errorf("CatalogID = %q, want %q", catalog.CatalogID, "platform_default_experience_profiles")
	}
	if got := len(catalog.Profiles); got != 3 {
		t.Errorf("len(Profiles) = %d, want 3", got)
	}
}

func TestLoadCatalog_FailsOnMalformedYAML(t *testing.T) {
	malformed := strings.NewReader(": :: not-valid-yaml ::")
	_, err := LoadCatalog(malformed)
	if err == nil {
		t.Fatalf("LoadCatalog returned nil error for malformed yaml")
	}
	if !errors.Is(err, ErrCatalogParse) {
		t.Errorf("LoadCatalog error = %v, want wrapped ErrCatalogParse", err)
	}
}

func TestLoadCatalog_FailsOnUnknownPrivacyPosture(t *testing.T) {
	bad := strings.Replace(canonicalCatalogYAML, "privacy_posture: cloud-ok", "privacy_posture: cloud-maybe", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatalf("LoadCatalog accepted unknown privacy_posture")
	}
	if !errors.Is(err, ErrProfileUnknownPrivacy) {
		t.Errorf("error = %v, want wrapped ErrProfileUnknownPrivacy", err)
	}
}

func TestLoadCatalog_FailsOnUnknownComputePosture(t *testing.T) {
	bad := strings.Replace(canonicalCatalogYAML, "compute_posture: cpu-only", "compute_posture: cpu-rocm", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatalf("LoadCatalog accepted unknown compute_posture")
	}
	if !errors.Is(err, ErrProfileUnknownCompute) {
		t.Errorf("error = %v, want wrapped ErrProfileUnknownCompute", err)
	}
}

func TestLoadCatalog_FailsOnUnknownRoutingPolicy(t *testing.T) {
	bad := strings.Replace(canonicalCatalogYAML, "routing_policy: cloud-first", "routing_policy: cloud-prefer", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatalf("LoadCatalog accepted unknown routing_policy")
	}
	if !errors.Is(err, ErrProfileUnknownRouting) {
		t.Errorf("error = %v, want wrapped ErrProfileUnknownRouting", err)
	}
}

func TestLoadCatalog_FailsOnUnknownApplicableScope(t *testing.T) {
	bad := strings.Replace(canonicalCatalogYAML, "      - first-run", "      - mod-install", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatalf("LoadCatalog accepted unknown applicable_scope")
	}
	if !errors.Is(err, ErrProfileUnknownScope) {
		t.Errorf("error = %v, want wrapped ErrProfileUnknownScope", err)
	}
}

func TestLoadCatalog_FailsOnMissingTableFamily(t *testing.T) {
	bad := strings.Replace(canonicalCatalogYAML, "table_family: product_catalog\n", "", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatalf("LoadCatalog accepted missing table_family")
	}
	if !errors.Is(err, ErrCatalogMissingTableFamily) {
		t.Errorf("error = %v, want wrapped ErrCatalogMissingTableFamily", err)
	}
}

func TestLoadCatalog_FailsOnNoProfiles(t *testing.T) {
	bad := `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_default_experience_profiles
profiles: []
`
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatalf("LoadCatalog accepted empty profiles")
	}
	if !errors.Is(err, ErrCatalogMissingProfile) {
		t.Errorf("error = %v, want wrapped ErrCatalogMissingProfile", err)
	}
}

func TestLoadCatalog_FailsOnMissingAlias(t *testing.T) {
	bad := strings.Replace(canonicalCatalogYAML, "  - alias: cloud-first\n", "  - alias: \n", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatalf("LoadCatalog accepted missing alias")
	}
	if !errors.Is(err, ErrProfileMissingAlias) {
		t.Errorf("error = %v, want wrapped ErrProfileMissingAlias", err)
	}
}

func TestLoadCatalog_FailsOnMissingSourceRule(t *testing.T) {
	bad := strings.Replace(canonicalCatalogYAML, "    source_rule: P-DXP-002\n", "    source_rule: \n", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatalf("LoadCatalog accepted missing source_rule")
	}
	if !errors.Is(err, ErrProfileMissingSourceRule) {
		t.Errorf("error = %v, want wrapped ErrProfileMissingSourceRule", err)
	}
}

func TestLoadCatalog_NilReader(t *testing.T) {
	_, err := LoadCatalog(nil)
	if err == nil {
		t.Fatalf("LoadCatalog accepted nil reader")
	}
	if !errors.Is(err, ErrCatalogParse) {
		t.Errorf("error = %v, want wrapped ErrCatalogParse", err)
	}
}

func TestLoadCatalogFromFile_EmptyPath(t *testing.T) {
	_, err := LoadCatalogFromFile("")
	if err == nil {
		t.Fatalf("LoadCatalogFromFile accepted empty path")
	}
	if !errors.Is(err, ErrCatalogParse) {
		t.Errorf("error = %v, want wrapped ErrCatalogParse", err)
	}
}

func TestLoadCatalogFromFile_MissingPath(t *testing.T) {
	_, err := LoadCatalogFromFile("/tmp/nimi-default-experience-does-not-exist.yaml")
	if err == nil {
		t.Fatalf("LoadCatalogFromFile accepted missing path")
	}
}

func TestFindByAlias_ReturnsExistingProfile(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	profile, ok := catalog.FindByAlias("local-standard")
	if !ok {
		t.Fatalf("FindByAlias(local-standard) returned ok=false")
	}
	if profile.PrivacyPosture != PrivacyPostureLocalPreferred {
		t.Errorf("PrivacyPosture = %q, want %q", profile.PrivacyPosture, PrivacyPostureLocalPreferred)
	}
	if profile.RoutingPolicy != RoutingPolicyLocalFirst {
		t.Errorf("RoutingPolicy = %q, want %q", profile.RoutingPolicy, RoutingPolicyLocalFirst)
	}
}

func TestFindByAlias_ReturnsFalseForUnknown(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	if _, ok := catalog.FindByAlias("nonexistent-alias"); ok {
		t.Errorf("FindByAlias returned ok=true for unknown alias")
	}
}

func TestFindByAlias_NilCatalog(t *testing.T) {
	var catalog *Catalog
	if _, ok := catalog.FindByAlias("cloud-first"); ok {
		t.Errorf("FindByAlias on nil catalog returned ok=true")
	}
}

func TestFilter_ByPrivacyPosture(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	matches := catalog.Filter(FilterCriteria{PrivacyPosture: PrivacyPostureLocalPreferred})
	if got := len(matches); got != 2 {
		t.Errorf("len(matches) = %d, want 2 (local-standard + local-gpu)", got)
	}
	for _, profile := range matches {
		if profile.PrivacyPosture != PrivacyPostureLocalPreferred {
			t.Errorf("Filter returned profile with PrivacyPosture %q", profile.PrivacyPosture)
		}
	}
}

func TestFilter_ByComputePosture(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	matches := catalog.Filter(FilterCriteria{ComputePosture: ComputePostureCUDACapable})
	if got := len(matches); got != 1 {
		t.Errorf("len(matches) = %d, want 1 (local-gpu)", got)
	}
	if matches[0].Alias != "local-gpu" {
		t.Errorf("Filter returned alias %q, want local-gpu", matches[0].Alias)
	}
}

func TestFilter_ByRoutingPolicy(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	matches := catalog.Filter(FilterCriteria{RoutingPolicy: RoutingPolicyCloudFirst})
	if got := len(matches); got != 1 {
		t.Errorf("len(matches) = %d, want 1 (cloud-first)", got)
	}
	if matches[0].Alias != "cloud-first" {
		t.Errorf("Filter returned alias %q, want cloud-first", matches[0].Alias)
	}
}

func TestFilter_ByApplicableScope(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	matches := catalog.Filter(FilterCriteria{ApplicableScope: ApplicableScopeFirstRun})
	if got := len(matches); got != 3 {
		t.Errorf("len(matches) = %d, want 3 (all profiles support first-run)", got)
	}
}

func TestFilter_NoMatch(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	matches := catalog.Filter(FilterCriteria{
		PrivacyPosture: PrivacyPostureLocalRequired,
		ComputePosture: ComputePostureCUDACapable,
	})
	if got := len(matches); got != 0 {
		t.Errorf("len(matches) = %d, want 0 (no profile is local-required + cuda)", got)
	}
}

func TestFilter_EmptyCriteriaReturnsAll(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	matches := catalog.Filter(FilterCriteria{})
	if got := len(matches); got != 3 {
		t.Errorf("len(matches) = %d, want 3 (all profiles)", got)
	}
}

func TestFilter_NilCatalog(t *testing.T) {
	var catalog *Catalog
	matches := catalog.Filter(FilterCriteria{})
	if matches != nil {
		t.Errorf("Filter on nil catalog returned non-nil: %v", matches)
	}
}

func TestProfile_SupportsScope(t *testing.T) {
	profile := Profile{
		ApplicableScopes: []ApplicableScope{ApplicableScopeFirstRun, ApplicableScopeFirstPartyApp},
	}
	if !profile.SupportsScope(ApplicableScopeFirstRun) {
		t.Errorf("SupportsScope(first-run) = false, want true")
	}
	if profile.SupportsScope(ApplicableScopeScopeBoundApply) {
		t.Errorf("SupportsScope(scope-bound-apply) = true, want false")
	}
}

func TestDimensionEnums_Valid(t *testing.T) {
	if !PrivacyPostureCloudOK.Valid() {
		t.Errorf("PrivacyPostureCloudOK.Valid() = false")
	}
	if PrivacyPosture("cloud-maybe").Valid() {
		t.Errorf("unknown privacy posture reported as valid")
	}
	if !ComputePostureMetalCapable.Valid() {
		t.Errorf("ComputePostureMetalCapable.Valid() = false")
	}
	if ComputePosture("cuda-old").Valid() {
		t.Errorf("unknown compute posture reported as valid")
	}
	if !RoutingPolicyHybridExplicit.Valid() {
		t.Errorf("RoutingPolicyHybridExplicit.Valid() = false")
	}
	if RoutingPolicy("cloud-prefer").Valid() {
		t.Errorf("unknown routing policy reported as valid")
	}
	if !ApplicableScopeScopeBoundApply.Valid() {
		t.Errorf("ApplicableScopeScopeBoundApply.Valid() = false")
	}
	if ApplicableScope("mod-install").Valid() {
		t.Errorf("unknown applicable scope reported as valid")
	}
}
