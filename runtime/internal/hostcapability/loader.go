package hostcapability

import (
	"fmt"
	"io"
	"os"

	"gopkg.in/yaml.v3"
)

type rawCatalog struct {
	Version     int          `yaml:"version"`
	TableFamily string       `yaml:"table_family"`
	Owner       string       `yaml:"owner"`
	CatalogID   string       `yaml:"catalog_id"`
	Profiles    []rawProfile `yaml:"profiles"`
}

type rawPlatformTuple struct {
	OS   string `yaml:"os"`
	Arch string `yaml:"arch"`
}

type rawProfile struct {
	ProfileID                string           `yaml:"profile_id"`
	PlatformTuple            rawPlatformTuple `yaml:"platform_tuple"`
	AcceleratorVendor        string           `yaml:"accelerator_vendor"`
	AcceleratorPlanes        []string         `yaml:"accelerator_planes"`
	EvidenceSources          []string         `yaml:"evidence_sources"`
	SystemDependencyEvidence []string         `yaml:"system_dependency_evidence"`
	ForbiddenEvidence        []string         `yaml:"forbidden_evidence"`
}

// LoadCatalog parses a host capability profile catalog from the given
// reader. It validates required fields per device-profile-contract
// profile_schema.fields and fails closed on missing profile_id or
// platform_tuple components.
func LoadCatalog(reader io.Reader) (*Catalog, error) {
	if reader == nil {
		return nil, fmt.Errorf("host-capability LoadCatalog: %w", ErrCatalogParse)
	}
	bytes, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("host-capability LoadCatalog read: %w", err)
	}
	var raw rawCatalog
	if err := yaml.Unmarshal(bytes, &raw); err != nil {
		return nil, fmt.Errorf("host-capability LoadCatalog unmarshal: %w: %w", ErrCatalogParse, err)
	}
	if raw.TableFamily == "" || raw.Owner == "" || raw.CatalogID == "" {
		return nil, fmt.Errorf("host-capability LoadCatalog: %w", ErrCatalogMissingFields)
	}
	if len(raw.Profiles) == 0 {
		return nil, fmt.Errorf("host-capability LoadCatalog: %w", ErrCatalogMissingProfile)
	}
	catalog := &Catalog{
		Version:     raw.Version,
		TableFamily: raw.TableFamily,
		Owner:       raw.Owner,
		CatalogID:   raw.CatalogID,
		Profiles:    make([]Profile, 0, len(raw.Profiles)),
	}
	for index, raw := range raw.Profiles {
		profile, err := convertProfile(raw)
		if err != nil {
			return nil, fmt.Errorf("host-capability LoadCatalog profile[%d] (%q): %w", index, raw.ProfileID, err)
		}
		catalog.Profiles = append(catalog.Profiles, profile)
	}
	return catalog, nil
}

// LoadCatalogFromFile reads the catalog yaml from a filesystem path
// and parses it via LoadCatalog.
func LoadCatalogFromFile(path string) (*Catalog, error) {
	if path == "" {
		return nil, fmt.Errorf("host-capability LoadCatalogFromFile: empty path: %w", ErrCatalogParse)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("host-capability LoadCatalogFromFile open: %w", err)
	}
	catalog, loadErr := LoadCatalog(file)
	if closeErr := file.Close(); closeErr != nil && loadErr == nil {
		return nil, fmt.Errorf("host-capability LoadCatalogFromFile close: %w", closeErr)
	}
	return catalog, loadErr
}

func convertProfile(raw rawProfile) (Profile, error) {
	if raw.ProfileID == "" {
		return Profile{}, ErrProfileMissingID
	}
	if raw.PlatformTuple.OS == "" || raw.PlatformTuple.Arch == "" {
		return Profile{}, ErrProfileMissingPlatform
	}
	return Profile{
		ProfileID:                raw.ProfileID,
		Platform:                 PlatformTuple{OS: raw.PlatformTuple.OS, Arch: raw.PlatformTuple.Arch},
		AcceleratorVendor:        raw.AcceleratorVendor,
		AcceleratorPlanes:        append([]string(nil), raw.AcceleratorPlanes...),
		EvidenceSources:          append([]string(nil), raw.EvidenceSources...),
		SystemDependencyEvidence: append([]string(nil), raw.SystemDependencyEvidence...),
		ForbiddenEvidence:        append([]string(nil), raw.ForbiddenEvidence...),
	}, nil
}
