package defaultexperience

import (
	"errors"
	"strings"
	"testing"
)

func loadTestCatalog(t *testing.T) *Catalog {
	t.Helper()
	catalog, err := LoadCatalog(strings.NewReader(canonicalCatalogYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	return catalog
}

func TestRecommend_ReturnsProfileMatchingHostAndScope(t *testing.T) {
	catalog := loadTestCatalog(t)
	profile, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "darwin-arm64-metal",
		Scope:                    ApplicableScopeFirstRun,
	})
	if err != nil {
		t.Fatalf("Recommend returned error: %v", err)
	}
	if profile == nil {
		t.Fatal("Recommend returned nil profile")
	}
	if !profileSupportsHostRef(profile, "darwin-arm64-metal") {
		t.Errorf("returned profile %q does not contain darwin-arm64-metal in HostCapabilityProfileRefs %v", profile.Alias, profile.HostCapabilityProfileRefs)
	}
	if !profile.SupportsScope(ApplicableScopeFirstRun) {
		t.Errorf("returned profile %q does not support first-run scope", profile.Alias)
	}
}

func TestRecommend_FirstMatchInCatalogOrder(t *testing.T) {
	catalog := loadTestCatalog(t)
	// darwin-arm64-metal is referenced by cloud-first and local-standard.
	// Catalog order puts cloud-first first.
	profile, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "darwin-arm64-metal",
		Scope:                    ApplicableScopeFirstRun,
	})
	if err != nil {
		t.Fatalf("Recommend returned error: %v", err)
	}
	if profile.Alias != "cloud-first" {
		t.Errorf("Recommend selected %q, want cloud-first (first in catalog order)", profile.Alias)
	}
}

func TestRecommend_DeterministicForSameInput(t *testing.T) {
	catalog := loadTestCatalog(t)
	first, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    ApplicableScopeFirstPartyApp,
	})
	if err != nil {
		t.Fatalf("Recommend(1) returned error: %v", err)
	}
	for i := 0; i < 5; i++ {
		again, err := Recommend(catalog, RecommendationInput{
			HostCapabilityProfileRef: "windows-amd64-cpu",
			Scope:                    ApplicableScopeFirstPartyApp,
		})
		if err != nil {
			t.Fatalf("Recommend(%d) returned error: %v", i+2, err)
		}
		if again.Alias != first.Alias {
			t.Errorf("Recommend non-deterministic: got %q then %q", first.Alias, again.Alias)
		}
	}
}

func TestRecommend_ReturnsErrNoCompatibleProfileWhenHostMissing(t *testing.T) {
	catalog := loadTestCatalog(t)
	_, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "linux-arm64-rocm",
		Scope:                    ApplicableScopeFirstRun,
	})
	if err == nil {
		t.Fatal("Recommend returned nil error for unsupported host")
	}
	if !errors.Is(err, ErrNoCompatibleProfile) {
		t.Errorf("error = %v, want wrapped ErrNoCompatibleProfile", err)
	}
}

func TestRecommend_FiltersByApplicableScope(t *testing.T) {
	catalog := &Catalog{
		Version:     1,
		TableFamily: "product_catalog",
		Owner:       "platform",
		CatalogID:   "platform_default_experience_profiles",
		Profiles: []Profile{
			{
				Alias:                     "first-run-only",
				PrivacyPosture:            PrivacyPostureCloudOK,
				ComputePosture:            ComputePostureCPUOnly,
				RoutingPolicy:             RoutingPolicyCloudFirst,
				HostCapabilityProfileRefs: []string{"windows-amd64-cpu"},
				ApplicableScopes:          []ApplicableScope{ApplicableScopeFirstRun},
				SourceRule:                "P-DXP-002",
			},
			{
				Alias:                     "first-party-only",
				PrivacyPosture:            PrivacyPostureCloudOK,
				ComputePosture:            ComputePostureCPUOnly,
				RoutingPolicy:             RoutingPolicyCloudFirst,
				HostCapabilityProfileRefs: []string{"windows-amd64-cpu"},
				ApplicableScopes:          []ApplicableScope{ApplicableScopeFirstPartyApp},
				SourceRule:                "P-DXP-002",
			},
		},
	}
	profile, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    ApplicableScopeFirstPartyApp,
	})
	if err != nil {
		t.Fatalf("Recommend returned error: %v", err)
	}
	if profile.Alias != "first-party-only" {
		t.Errorf("Recommend selected %q, want first-party-only (scope filter)", profile.Alias)
	}
}

func TestRecommend_PreferredPrivacyFilter(t *testing.T) {
	catalog := loadTestCatalog(t)
	// windows-amd64-cpu is in cloud-first (cloud-ok) and local-standard (local-preferred).
	// Filtering by local-preferred should select local-standard.
	profile, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    ApplicableScopeFirstRun,
		PreferredPrivacy:         PrivacyPostureLocalPreferred,
	})
	if err != nil {
		t.Fatalf("Recommend returned error: %v", err)
	}
	if profile.Alias != "local-standard" {
		t.Errorf("Recommend selected %q, want local-standard (privacy filter)", profile.Alias)
	}
	if profile.PrivacyPosture != PrivacyPostureLocalPreferred {
		t.Errorf("returned profile has PrivacyPosture %q, want local-preferred", profile.PrivacyPosture)
	}
}

func TestRecommend_PreferredComputeFilter(t *testing.T) {
	catalog := loadTestCatalog(t)
	profile, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-nvidia-cuda",
		Scope:                    ApplicableScopeFirstRun,
		PreferredCompute:         ComputePostureCUDACapable,
	})
	if err != nil {
		t.Fatalf("Recommend returned error: %v", err)
	}
	if profile.Alias != "local-gpu" {
		t.Errorf("Recommend selected %q, want local-gpu (compute filter)", profile.Alias)
	}
}

func TestRecommend_PreferredRoutingFilter(t *testing.T) {
	catalog := loadTestCatalog(t)
	profile, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "darwin-arm64-metal",
		Scope:                    ApplicableScopeFirstRun,
		PreferredRouting:         RoutingPolicyLocalFirst,
	})
	if err != nil {
		t.Fatalf("Recommend returned error: %v", err)
	}
	if profile.RoutingPolicy != RoutingPolicyLocalFirst {
		t.Errorf("returned profile RoutingPolicy = %q, want local-first", profile.RoutingPolicy)
	}
}

func TestRecommend_PreferenceConflictsReturnNoMatch(t *testing.T) {
	catalog := loadTestCatalog(t)
	// Request local-required privacy, but no profile in canonical catalog has local-required.
	_, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    ApplicableScopeFirstRun,
		PreferredPrivacy:         PrivacyPostureLocalRequired,
	})
	if err == nil {
		t.Fatal("Recommend returned nil error when preference conflicts with all matches")
	}
	if !errors.Is(err, ErrNoCompatibleProfile) {
		t.Errorf("error = %v, want wrapped ErrNoCompatibleProfile", err)
	}
}

func TestRecommend_NilCatalog(t *testing.T) {
	_, err := Recommend(nil, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    ApplicableScopeFirstRun,
	})
	if err == nil {
		t.Fatal("Recommend on nil catalog returned nil error")
	}
	if !errors.Is(err, ErrCatalogMissingProfile) {
		t.Errorf("error = %v, want wrapped ErrCatalogMissingProfile", err)
	}
}

func TestRecommend_EmptyHostRef(t *testing.T) {
	catalog := loadTestCatalog(t)
	_, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "",
		Scope:                    ApplicableScopeFirstRun,
	})
	if err == nil {
		t.Fatal("Recommend accepted empty host_capability_profile_ref")
	}
}

func TestRecommend_EmptyScope(t *testing.T) {
	catalog := loadTestCatalog(t)
	_, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    "",
	})
	if err == nil {
		t.Fatal("Recommend accepted empty scope")
	}
}

func TestRecommend_UnknownScope(t *testing.T) {
	catalog := loadTestCatalog(t)
	_, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    ApplicableScope("mod-install"),
	})
	if err == nil {
		t.Fatal("Recommend accepted unknown scope")
	}
	if !errors.Is(err, ErrProfileUnknownScope) {
		t.Errorf("error = %v, want wrapped ErrProfileUnknownScope", err)
	}
}

func TestRecommend_UnknownPreferredPrivacy(t *testing.T) {
	catalog := loadTestCatalog(t)
	_, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    ApplicableScopeFirstRun,
		PreferredPrivacy:         PrivacyPosture("cloud-maybe"),
	})
	if err == nil {
		t.Fatal("Recommend accepted unknown PreferredPrivacy")
	}
	if !errors.Is(err, ErrProfileUnknownPrivacy) {
		t.Errorf("error = %v, want wrapped ErrProfileUnknownPrivacy", err)
	}
}

func TestRecommend_UnknownPreferredCompute(t *testing.T) {
	catalog := loadTestCatalog(t)
	_, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    ApplicableScopeFirstRun,
		PreferredCompute:         ComputePosture("cuda-old"),
	})
	if err == nil {
		t.Fatal("Recommend accepted unknown PreferredCompute")
	}
	if !errors.Is(err, ErrProfileUnknownCompute) {
		t.Errorf("error = %v, want wrapped ErrProfileUnknownCompute", err)
	}
}

func TestRecommend_UnknownPreferredRouting(t *testing.T) {
	catalog := loadTestCatalog(t)
	_, err := Recommend(catalog, RecommendationInput{
		HostCapabilityProfileRef: "windows-amd64-cpu",
		Scope:                    ApplicableScopeFirstRun,
		PreferredRouting:         RoutingPolicy("cloud-prefer"),
	})
	if err == nil {
		t.Fatal("Recommend accepted unknown PreferredRouting")
	}
	if !errors.Is(err, ErrProfileUnknownRouting) {
		t.Errorf("error = %v, want wrapped ErrProfileUnknownRouting", err)
	}
}
