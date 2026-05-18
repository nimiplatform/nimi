package hostcapability

import (
	"errors"
	"strings"
	"testing"
)

const canonicalHostCapabilityYAML = `version: 1
table_family: product_catalog
owner: runtime
catalog_id: runtime_host_capability_profiles

profiles:
  - profile_id: windows-amd64-nvidia-cuda
    platform_tuple:
      os: windows
      arch: amd64
    accelerator_vendor: nvidia
    accelerator_planes:
      - cuda
    evidence_sources:
      - nvidia_driver_api
    system_dependency_evidence:
      - accelerator.cuda.runtime
    forbidden_evidence:
      - unverified_path_precedence_only

  - profile_id: windows-amd64-cpu
    platform_tuple:
      os: windows
      arch: amd64
    accelerator_vendor: none
    accelerator_planes:
      - cpu
    evidence_sources:
      - platform_probe
    system_dependency_evidence: []
    forbidden_evidence: []

  - profile_id: darwin-arm64-metal
    platform_tuple:
      os: darwin
      arch: arm64
    accelerator_vendor: apple
    accelerator_planes:
      - metal
      - cpu
    evidence_sources:
      - platform_probe
      - metal_device_probe
    system_dependency_evidence: []
    forbidden_evidence: []
`

func TestLoadCatalog_ParsesCanonicalYAML(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalHostCapabilityYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	if catalog.Version != 1 || catalog.TableFamily != "product_catalog" || catalog.Owner != "runtime" {
		t.Errorf("metadata incorrect: %+v", catalog)
	}
	if got := len(catalog.Profiles); got != 3 {
		t.Errorf("len(Profiles) = %d, want 3", got)
	}
}

func TestLoadCatalog_ProfileFieldsParsed(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(canonicalHostCapabilityYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	var darwin *Profile
	for i := range catalog.Profiles {
		if catalog.Profiles[i].ProfileID == "darwin-arm64-metal" {
			darwin = &catalog.Profiles[i]
			break
		}
	}
	if darwin == nil {
		t.Fatal("darwin-arm64-metal profile not found")
	}
	if darwin.Platform.OS != "darwin" || darwin.Platform.Arch != "arm64" {
		t.Errorf("platform = %+v, want darwin/arm64", darwin.Platform)
	}
	if darwin.AcceleratorVendor != "apple" {
		t.Errorf("AcceleratorVendor = %q, want apple", darwin.AcceleratorVendor)
	}
	if len(darwin.AcceleratorPlanes) != 2 {
		t.Errorf("len(AcceleratorPlanes) = %d, want 2", len(darwin.AcceleratorPlanes))
	}
}

func TestLoadCatalog_MalformedYAML(t *testing.T) {
	_, err := LoadCatalog(strings.NewReader(": ::not-yaml::"))
	if err == nil {
		t.Fatal("LoadCatalog accepted malformed yaml")
	}
	if !errors.Is(err, ErrCatalogParse) {
		t.Errorf("error = %v, want wrapped ErrCatalogParse", err)
	}
}

func TestLoadCatalog_MissingTableFamily(t *testing.T) {
	bad := strings.Replace(canonicalHostCapabilityYAML, "table_family: product_catalog\n", "", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadCatalog accepted missing table_family")
	}
	if !errors.Is(err, ErrCatalogMissingFields) {
		t.Errorf("error = %v, want wrapped ErrCatalogMissingFields", err)
	}
}

func TestLoadCatalog_NoProfiles(t *testing.T) {
	bad := `version: 1
table_family: product_catalog
owner: runtime
catalog_id: runtime_host_capability_profiles
profiles: []
`
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadCatalog accepted empty profiles")
	}
	if !errors.Is(err, ErrCatalogMissingProfile) {
		t.Errorf("error = %v, want wrapped ErrCatalogMissingProfile", err)
	}
}

func TestLoadCatalog_MissingProfileID(t *testing.T) {
	bad := strings.Replace(canonicalHostCapabilityYAML, "  - profile_id: windows-amd64-nvidia-cuda\n", "  - profile_id: \n", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadCatalog accepted missing profile_id")
	}
	if !errors.Is(err, ErrProfileMissingID) {
		t.Errorf("error = %v, want wrapped ErrProfileMissingID", err)
	}
}

func TestLoadCatalog_MissingPlatformOS(t *testing.T) {
	bad := strings.Replace(canonicalHostCapabilityYAML, "      os: windows\n", "      os: \n", 1)
	_, err := LoadCatalog(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadCatalog accepted missing platform os")
	}
	if !errors.Is(err, ErrProfileMissingPlatform) {
		t.Errorf("error = %v, want wrapped ErrProfileMissingPlatform", err)
	}
}

func TestLoadCatalog_NilReader(t *testing.T) {
	_, err := LoadCatalog(nil)
	if err == nil {
		t.Fatal("LoadCatalog accepted nil reader")
	}
	if !errors.Is(err, ErrCatalogParse) {
		t.Errorf("error = %v, want wrapped ErrCatalogParse", err)
	}
}

func TestLoadCatalogFromFile_EmptyPath(t *testing.T) {
	_, err := LoadCatalogFromFile("")
	if err == nil {
		t.Fatal("LoadCatalogFromFile accepted empty path")
	}
}

func TestLoadCatalogFromFile_Missing(t *testing.T) {
	_, err := LoadCatalogFromFile("/tmp/nimi-host-capability-does-not-exist.yaml")
	if err == nil {
		t.Fatal("LoadCatalogFromFile accepted missing path")
	}
}
