package hostcapability

import (
	"fmt"
	"runtime"
)

// CurrentPlatform returns the runtime's PlatformTuple sourced from
// runtime.GOOS and runtime.GOARCH. It performs no syscall, no process
// fork, and no install trigger.
func CurrentPlatform() PlatformTuple {
	return PlatformTuple{OS: runtime.GOOS, Arch: runtime.GOARCH}
}

func MatchProfile(catalog *Catalog, platform PlatformTuple) (*Profile, error) {
	return MatchProfileWithEvidence(catalog, platform, nil)
}

// MatchProfileWithEvidence returns the catalog profile whose platform_tuple and
// evidence requirements match the supplied host evidence. Accelerator profiles
// with system dependency evidence are never selected from catalog order alone.
func MatchProfileWithEvidence(catalog *Catalog, platform PlatformTuple, evidence []string) (*Profile, error) {
	if catalog == nil {
		return nil, fmt.Errorf("host-capability MatchProfile: %w", ErrCatalogMissingProfile)
	}
	if platform.OS == "" || platform.Arch == "" {
		return nil, fmt.Errorf("host-capability MatchProfile: platform os and arch are required")
	}
	for index := range catalog.Profiles {
		profile := &catalog.Profiles[index]
		if profile.Platform.OS == platform.OS && profile.Platform.Arch == platform.Arch && profileEvidenceAdmitted(*profile, evidence) {
			return profile, nil
		}
	}
	return nil, fmt.Errorf(
		"host-capability MatchProfile (os=%q, arch=%q): %w",
		platform.OS, platform.Arch, ErrNoMatchingHostProfile,
	)
}

// MatchCurrentProfile is a convenience wrapper that combines
// CurrentPlatform + MatchProfile.
func MatchCurrentProfile(catalog *Catalog) (*Profile, error) {
	return MatchProfile(catalog, CurrentPlatform())
}

func profileEvidenceAdmitted(profile Profile, evidence []string) bool {
	if !profileRequiresExplicitEvidence(profile) {
		return true
	}
	evidenceSet := map[string]struct{}{}
	for _, item := range evidence {
		if item != "" {
			evidenceSet[item] = struct{}{}
		}
	}
	for _, required := range profile.SystemDependencyEvidence {
		if required == "" {
			continue
		}
		if _, ok := evidenceSet[required]; !ok {
			return false
		}
	}
	for _, source := range profile.EvidenceSources {
		if _, ok := evidenceSet[source]; ok {
			return true
		}
	}
	return false
}

func profileRequiresExplicitEvidence(profile Profile) bool {
	if len(profile.SystemDependencyEvidence) > 0 {
		return true
	}
	if profile.AcceleratorVendor == "nvidia" {
		return true
	}
	for _, plane := range profile.AcceleratorPlanes {
		if plane == "cuda" {
			return true
		}
	}
	return false
}
