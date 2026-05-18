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

// MatchProfile returns the catalog profile whose platform_tuple matches
// the given PlatformTuple. When no profile matches, returns
// ErrNoMatchingHostProfile and a nil profile.
//
// Matching is exact on both OS and Arch. The matcher does not consider
// accelerator presence; that is the responsibility of subsequent
// accelerator probe packets per device-profile-contract refresh-state
// machinery.
func MatchProfile(catalog *Catalog, platform PlatformTuple) (*Profile, error) {
	if catalog == nil {
		return nil, fmt.Errorf("host-capability MatchProfile: %w", ErrCatalogMissingProfile)
	}
	if platform.OS == "" || platform.Arch == "" {
		return nil, fmt.Errorf("host-capability MatchProfile: platform os and arch are required")
	}
	for index := range catalog.Profiles {
		profile := &catalog.Profiles[index]
		if profile.Platform.OS == platform.OS && profile.Platform.Arch == platform.Arch {
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
