package hostcapability

import (
	"errors"
	"runtime"
	"strings"
	"testing"
)

func loadTestCatalog(t *testing.T) *Catalog {
	t.Helper()
	catalog, err := LoadCatalog(strings.NewReader(canonicalHostCapabilityYAML))
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	return catalog
}

func TestCurrentPlatform_UsesRuntimeGoosGoarch(t *testing.T) {
	platform := CurrentPlatform()
	if platform.OS != runtime.GOOS {
		t.Errorf("CurrentPlatform.OS = %q, want %q", platform.OS, runtime.GOOS)
	}
	if platform.Arch != runtime.GOARCH {
		t.Errorf("CurrentPlatform.Arch = %q, want %q", platform.Arch, runtime.GOARCH)
	}
}

func TestMatchProfile_DarwinArm64(t *testing.T) {
	catalog := loadTestCatalog(t)
	profile, err := MatchProfile(catalog, PlatformTuple{OS: "darwin", Arch: "arm64"})
	if err != nil {
		t.Fatalf("MatchProfile returned error: %v", err)
	}
	if profile.ProfileID != "darwin-arm64-metal" {
		t.Errorf("ProfileID = %q, want darwin-arm64-metal", profile.ProfileID)
	}
	if profile.Platform.OS != "darwin" || profile.Platform.Arch != "arm64" {
		t.Errorf("Platform mismatch: %+v", profile.Platform)
	}
}

func TestMatchProfile_WindowsAmd64FirstMatchWins(t *testing.T) {
	catalog := loadTestCatalog(t)
	// Catalog has windows-amd64-nvidia-cuda first, then windows-amd64-cpu.
	// First-match-in-catalog-order: deterministic selection of the cuda row.
	profile, err := MatchProfile(catalog, PlatformTuple{OS: "windows", Arch: "amd64"})
	if err != nil {
		t.Fatalf("MatchProfile returned error: %v", err)
	}
	if profile.ProfileID != "windows-amd64-nvidia-cuda" {
		t.Errorf("ProfileID = %q, want windows-amd64-nvidia-cuda (first in catalog order)", profile.ProfileID)
	}
}

func TestMatchProfile_NoMatchReturnsErr(t *testing.T) {
	catalog := loadTestCatalog(t)
	_, err := MatchProfile(catalog, PlatformTuple{OS: "linux", Arch: "arm64"})
	if err == nil {
		t.Fatal("MatchProfile returned nil error for unmatched platform")
	}
	if !errors.Is(err, ErrNoMatchingHostProfile) {
		t.Errorf("error = %v, want wrapped ErrNoMatchingHostProfile", err)
	}
}

func TestMatchProfile_DeterministicForSamePlatform(t *testing.T) {
	catalog := loadTestCatalog(t)
	platform := PlatformTuple{OS: "darwin", Arch: "arm64"}
	first, err := MatchProfile(catalog, platform)
	if err != nil {
		t.Fatalf("MatchProfile(1) returned error: %v", err)
	}
	for i := 0; i < 5; i++ {
		again, err := MatchProfile(catalog, platform)
		if err != nil {
			t.Fatalf("MatchProfile(%d) returned error: %v", i+2, err)
		}
		if again.ProfileID != first.ProfileID {
			t.Errorf("MatchProfile non-deterministic: got %q then %q", first.ProfileID, again.ProfileID)
		}
	}
}

func TestMatchProfile_NilCatalog(t *testing.T) {
	_, err := MatchProfile(nil, PlatformTuple{OS: "darwin", Arch: "arm64"})
	if err == nil {
		t.Fatal("MatchProfile on nil catalog returned nil error")
	}
	if !errors.Is(err, ErrCatalogMissingProfile) {
		t.Errorf("error = %v, want wrapped ErrCatalogMissingProfile", err)
	}
}

func TestMatchProfile_EmptyPlatform(t *testing.T) {
	catalog := loadTestCatalog(t)
	_, err := MatchProfile(catalog, PlatformTuple{})
	if err == nil {
		t.Fatal("MatchProfile accepted empty platform")
	}
	_, err = MatchProfile(catalog, PlatformTuple{OS: "darwin"})
	if err == nil {
		t.Fatal("MatchProfile accepted platform with missing arch")
	}
	_, err = MatchProfile(catalog, PlatformTuple{Arch: "arm64"})
	if err == nil {
		t.Fatal("MatchProfile accepted platform with missing os")
	}
}

func TestMatchCurrentProfile_ReturnsErrOnUnsupportedPlatform(t *testing.T) {
	// Build a minimal catalog that excludes the runtime platform so we
	// can deterministically assert the error path regardless of test host.
	excluded := PlatformTuple{OS: "freebsd", Arch: "riscv64"}
	if runtime.GOOS == excluded.OS && runtime.GOARCH == excluded.Arch {
		t.Skip("runtime platform matches the deliberately-excluded tuple; skipping")
	}
	catalog := &Catalog{
		Version:     1,
		TableFamily: "product_catalog",
		Owner:       "runtime",
		CatalogID:   "runtime_host_capability_profiles",
		Profiles: []Profile{
			{
				ProfileID: "freebsd-riscv64-cpu",
				Platform:  excluded,
			},
		},
	}
	_, err := MatchCurrentProfile(catalog)
	if err == nil {
		t.Fatal("MatchCurrentProfile returned nil error for unsupported runtime platform")
	}
	if !errors.Is(err, ErrNoMatchingHostProfile) {
		t.Errorf("error = %v, want wrapped ErrNoMatchingHostProfile", err)
	}
}
