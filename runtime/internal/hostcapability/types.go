// Package hostcapability implements Runtime host capability profile
// resolution per .nimi/spec/canonical/runtime/local-compute.authority.yaml.
//
// This package loads the canonical host capability profile catalog from
// runtime/kernel/tables/host-capability-profiles.yaml and resolves the
// current platform (runtime.GOOS + runtime.GOARCH) to a profile_id.
// Per device-profile-contract `install_trigger: forbidden`, the loader
// and matcher never invoke install or download paths.
package hostcapability

import "errors"

// PlatformTuple captures the os + arch pair that identifies a host
// platform for catalog matching purposes.
type PlatformTuple struct {
	OS   string
	Arch string
}

// Profile is a single host capability profile catalog row.
type Profile struct {
	ProfileID                string
	Platform                 PlatformTuple
	AcceleratorVendor        string
	AcceleratorPlanes        []string
	EvidenceSources          []string
	SystemDependencyEvidence []string
	ForbiddenEvidence        []string
}

// Catalog is the parsed Runtime host capability profile catalog table.
type Catalog struct {
	Version     int
	TableFamily string
	Owner       string
	CatalogID   string
	Profiles    []Profile
}

// Sentinel errors returned by the loader and matcher.
var (
	ErrCatalogParse           = errors.New("host-capability catalog parse failed")
	ErrCatalogMissingFields   = errors.New("host-capability catalog is missing table_family or owner or catalog_id")
	ErrCatalogMissingProfile  = errors.New("host-capability catalog has no profiles")
	ErrProfileMissingID       = errors.New("host-capability profile is missing profile_id")
	ErrProfileMissingPlatform = errors.New("host-capability profile is missing platform_tuple.os or platform_tuple.arch")
	ErrNoMatchingHostProfile  = errors.New("host-capability no matching profile for runtime platform")
)
