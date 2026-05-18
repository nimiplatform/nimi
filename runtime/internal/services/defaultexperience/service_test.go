package defaultexperience

import (
	"errors"
	"runtime"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/coldstart"
	dx "github.com/nimiplatform/nimi/runtime/internal/defaultexperience"
	"github.com/nimiplatform/nimi/runtime/internal/hostcapability"
)

const profilesYAML = `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_default_experience_profiles
profiles:
  - alias: cloud-first
    privacy_posture: cloud-ok
    compute_posture: cloud-only
    capability_set:
      - text.generate
    routing_policy: cloud-first
    host_capability_profile_refs:
      - darwin-arm64-metal
      - windows-amd64-cpu
    local_compute_pack_refs: []
    dependency_family_refs: []
    materialization_confirmation_required: false
    applicable_scopes:
      - first-run
      - first-party-app
      - scope-bound-apply
    source_rule: P-DXP-002
`

const hostCatalogYAML = `version: 1
table_family: product_catalog
owner: runtime
catalog_id: runtime_host_capability_profiles
profiles:
  - profile_id: darwin-arm64-metal
    platform_tuple:
      os: darwin
      arch: arm64
  - profile_id: windows-amd64-cpu
    platform_tuple:
      os: windows
      arch: amd64
`

func loadCatalogs(t *testing.T) (*dx.Catalog, *hostcapability.Catalog) {
	t.Helper()
	profiles, err := dx.LoadCatalog(strings.NewReader(profilesYAML))
	if err != nil {
		t.Fatalf("load profiles: %v", err)
	}
	hosts, err := hostcapability.LoadCatalog(strings.NewReader(hostCatalogYAML))
	if err != nil {
		t.Fatalf("load hosts: %v", err)
	}
	return profiles, hosts
}

func TestNewService_RejectsNilProfileCatalog(t *testing.T) {
	_, hosts := loadCatalogs(t)
	_, err := NewService(nil, hosts)
	if err == nil {
		t.Fatal("NewService accepted nil profileCatalog")
	}
	if !errors.Is(err, ErrInvalidDependency) {
		t.Errorf("error = %v, want wrapped ErrInvalidDependency", err)
	}
}

func TestNewService_RejectsNilHostCatalog(t *testing.T) {
	profiles, _ := loadCatalogs(t)
	_, err := NewService(profiles, nil)
	if err == nil {
		t.Fatal("NewService accepted nil hostCatalog")
	}
	if !errors.Is(err, ErrInvalidDependency) {
		t.Errorf("error = %v, want wrapped ErrInvalidDependency", err)
	}
}

func TestNewService_Constructs(t *testing.T) {
	profiles, hosts := loadCatalogs(t)
	service, err := NewService(profiles, hosts)
	if err != nil {
		t.Fatalf("NewService returned error: %v", err)
	}
	if service.ProfileCatalog() != profiles {
		t.Error("ProfileCatalog() did not return injected catalog")
	}
	if service.HostCatalog() != hosts {
		t.Error("HostCatalog() did not return injected host catalog")
	}
}

func TestService_HostProfile_ResolvesRuntimePlatformWhenSupported(t *testing.T) {
	profiles, hosts := loadCatalogs(t)
	service, _ := NewService(profiles, hosts)
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		profile, err := service.HostProfile()
		if err != nil {
			t.Fatalf("HostProfile returned error: %v", err)
		}
		if profile.ProfileID != "darwin-arm64-metal" {
			t.Errorf("ProfileID = %q, want darwin-arm64-metal", profile.ProfileID)
		}
		return
	}
	if runtime.GOOS == "windows" && runtime.GOARCH == "amd64" {
		profile, err := service.HostProfile()
		if err != nil {
			t.Fatalf("HostProfile returned error: %v", err)
		}
		if profile.ProfileID != "windows-amd64-cpu" {
			t.Errorf("ProfileID = %q, want windows-amd64-cpu", profile.ProfileID)
		}
		return
	}
	_, err := service.HostProfile()
	if err == nil {
		t.Fatal("HostProfile returned nil error on unsupported runtime platform")
	}
	if !errors.Is(err, hostcapability.ErrNoMatchingHostProfile) {
		t.Errorf("error = %v, want wrapped ErrNoMatchingHostProfile", err)
	}
}

func TestService_RecommendForCurrentHost_Profile(t *testing.T) {
	profiles, hosts := loadCatalogs(t)
	service, _ := NewService(profiles, hosts)
	if runtime.GOOS == "linux" || (runtime.GOOS != "darwin" && runtime.GOOS != "windows") {
		// Skip on platforms not covered by the small test catalog; the
		// negative path is verified in TestService_HostProfile_ResolvesRuntimePlatformWhenSupported.
		t.Skipf("test catalog does not cover runtime platform %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	profile, err := service.RecommendForCurrentHost(dx.ApplicableScopeFirstRun, dx.RecommendationInput{})
	if err != nil {
		t.Fatalf("RecommendForCurrentHost returned error: %v", err)
	}
	if profile.Alias != "cloud-first" {
		t.Errorf("Alias = %q, want cloud-first (only profile in test catalog)", profile.Alias)
	}
}

func TestService_RecommendForCurrentHost_AppliesPreferences(t *testing.T) {
	// Build a richer test catalog with multiple profiles so we can verify
	// preference filtering passes through the Service.
	multiProfilesYAML := `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_default_experience_profiles
profiles:
  - alias: cloud-first
    privacy_posture: cloud-ok
    compute_posture: cloud-only
    capability_set: [text.generate]
    routing_policy: cloud-first
    host_capability_profile_refs: [darwin-arm64-metal, windows-amd64-cpu]
    local_compute_pack_refs: []
    dependency_family_refs: []
    materialization_confirmation_required: false
    applicable_scopes: [first-run, first-party-app, scope-bound-apply]
    source_rule: P-DXP-002
  - alias: local-standard
    privacy_posture: local-preferred
    compute_posture: cpu-only
    capability_set: [text.generate]
    routing_policy: local-first
    host_capability_profile_refs: [darwin-arm64-metal, windows-amd64-cpu]
    local_compute_pack_refs: [local-text]
    dependency_family_refs: [model.asset]
    materialization_confirmation_required: true
    applicable_scopes: [first-run, first-party-app, scope-bound-apply]
    source_rule: P-DXP-002
`
	profiles, err := dx.LoadCatalog(strings.NewReader(multiProfilesYAML))
	if err != nil {
		t.Fatalf("load profiles: %v", err)
	}
	hosts, err := hostcapability.LoadCatalog(strings.NewReader(hostCatalogYAML))
	if err != nil {
		t.Fatalf("load hosts: %v", err)
	}
	service, _ := NewService(profiles, hosts)
	if !(runtime.GOOS == "darwin" || runtime.GOOS == "windows") {
		t.Skipf("test catalog does not cover runtime platform %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	profile, err := service.RecommendForCurrentHost(dx.ApplicableScopeFirstRun, dx.RecommendationInput{
		PreferredPrivacy: dx.PrivacyPostureLocalPreferred,
	})
	if err != nil {
		t.Fatalf("RecommendForCurrentHost returned error: %v", err)
	}
	if profile.Alias != "local-standard" {
		t.Errorf("Alias = %q, want local-standard (privacy preference)", profile.Alias)
	}
}

func TestService_ProjectColdStart_ReadyOnAllReady(t *testing.T) {
	profiles, hosts := loadCatalogs(t)
	service, _ := NewService(profiles, hosts)
	projection, err := service.ProjectColdStart(coldstart.UpstreamInputs{
		RuntimeDaemon:            coldstart.StateReady,
		Account:                  coldstart.StateReady,
		DefaultExperienceProfile: coldstart.StateReady,
		Materialization:          coldstart.StateReady,
		AppRegistry:              coldstart.StateReady,
		CognitionMemory:          coldstart.StateReady,
	})
	if err != nil {
		t.Fatalf("ProjectColdStart returned error: %v", err)
	}
	if projection.State != coldstart.StateReady {
		t.Errorf("State = %q, want ready", projection.State)
	}
}

func TestService_ProjectColdStart_FailedAccountPreemptsReady(t *testing.T) {
	profiles, hosts := loadCatalogs(t)
	service, _ := NewService(profiles, hosts)
	projection, err := service.ProjectColdStart(coldstart.UpstreamInputs{
		RuntimeDaemon:            coldstart.StateReady,
		Account:                  coldstart.StateFailed,
		DefaultExperienceProfile: coldstart.StateReady,
		Materialization:          coldstart.StateReady,
		AppRegistry:              coldstart.StateReady,
		CognitionMemory:          coldstart.StateReady,
	})
	if err != nil {
		t.Fatalf("ProjectColdStart returned error: %v", err)
	}
	if projection.State != coldstart.StateFailed {
		t.Errorf("State = %q, want failed", projection.State)
	}
}

func TestService_NilReceiverFailsGracefully(t *testing.T) {
	var service *Service
	if _, err := service.HostProfile(); err == nil {
		t.Error("nil receiver HostProfile returned nil error")
	}
	if _, err := service.RecommendForCurrentHost(dx.ApplicableScopeFirstRun, dx.RecommendationInput{}); err == nil {
		t.Error("nil receiver RecommendForCurrentHost returned nil error")
	}
	if service.ProfileCatalog() != nil {
		t.Error("nil receiver ProfileCatalog returned non-nil")
	}
	if service.HostCatalog() != nil {
		t.Error("nil receiver HostCatalog returned non-nil")
	}
}
