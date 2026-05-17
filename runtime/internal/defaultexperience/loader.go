package defaultexperience

import (
	"fmt"
	"io"
	"os"

	"gopkg.in/yaml.v3"
)

// rawCatalog mirrors the on-disk yaml shape for parsing only.
type rawCatalog struct {
	Version     int          `yaml:"version"`
	TableFamily string       `yaml:"table_family"`
	Owner       string       `yaml:"owner"`
	CatalogID   string       `yaml:"catalog_id"`
	Profiles    []rawProfile `yaml:"profiles"`
}

type rawProfile struct {
	Alias                               string   `yaml:"alias"`
	PrivacyPosture                      string   `yaml:"privacy_posture"`
	ComputePosture                      string   `yaml:"compute_posture"`
	CapabilitySet                       []string `yaml:"capability_set"`
	RoutingPolicy                       string   `yaml:"routing_policy"`
	HostCapabilityProfileRefs           []string `yaml:"host_capability_profile_refs"`
	LocalComputePackRefs                []string `yaml:"local_compute_pack_refs"`
	DependencyFamilyRefs                []string `yaml:"dependency_family_refs"`
	MaterializationConfirmationRequired bool     `yaml:"materialization_confirmation_required"`
	ApplicableScopes                    []string `yaml:"applicable_scopes"`
	SourceRule                          string   `yaml:"source_rule"`
}

// LoadCatalog parses a Default Experience Profile catalog from the given
// reader. It validates dimension enums per profile_schema.enums and fails
// closed on any unknown value or malformed yaml.
func LoadCatalog(reader io.Reader) (*Catalog, error) {
	if reader == nil {
		return nil, fmt.Errorf("default-experience LoadCatalog: %w", ErrCatalogParse)
	}
	bytes, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("default-experience LoadCatalog read: %w", err)
	}
	var raw rawCatalog
	if err := yaml.Unmarshal(bytes, &raw); err != nil {
		return nil, fmt.Errorf("default-experience LoadCatalog unmarshal: %w: %w", ErrCatalogParse, err)
	}
	if raw.TableFamily == "" || raw.Owner == "" || raw.CatalogID == "" {
		return nil, fmt.Errorf("default-experience LoadCatalog: %w", ErrCatalogMissingTableFamily)
	}
	if len(raw.Profiles) == 0 {
		return nil, fmt.Errorf("default-experience LoadCatalog: %w", ErrCatalogMissingProfile)
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
			return nil, fmt.Errorf("default-experience LoadCatalog profile[%d] (%q): %w", index, raw.Alias, err)
		}
		catalog.Profiles = append(catalog.Profiles, profile)
	}
	return catalog, nil
}

// LoadCatalogFromFile is a convenience wrapper around LoadCatalog that
// reads the catalog yaml from the given filesystem path.
func LoadCatalogFromFile(path string) (*Catalog, error) {
	if path == "" {
		return nil, fmt.Errorf("default-experience LoadCatalogFromFile: empty path: %w", ErrCatalogParse)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("default-experience LoadCatalogFromFile open: %w", err)
	}
	defer file.Close()
	return LoadCatalog(file)
}

func convertProfile(raw rawProfile) (Profile, error) {
	if raw.Alias == "" {
		return Profile{}, ErrProfileMissingAlias
	}
	if raw.SourceRule == "" {
		return Profile{}, ErrProfileMissingSourceRule
	}
	privacy := PrivacyPosture(raw.PrivacyPosture)
	if !privacy.Valid() {
		return Profile{}, fmt.Errorf("%w: %q", ErrProfileUnknownPrivacy, raw.PrivacyPosture)
	}
	compute := ComputePosture(raw.ComputePosture)
	if !compute.Valid() {
		return Profile{}, fmt.Errorf("%w: %q", ErrProfileUnknownCompute, raw.ComputePosture)
	}
	routing := RoutingPolicy(raw.RoutingPolicy)
	if !routing.Valid() {
		return Profile{}, fmt.Errorf("%w: %q", ErrProfileUnknownRouting, raw.RoutingPolicy)
	}
	scopes := make([]ApplicableScope, 0, len(raw.ApplicableScopes))
	for _, scope := range raw.ApplicableScopes {
		typed := ApplicableScope(scope)
		if !typed.Valid() {
			return Profile{}, fmt.Errorf("%w: %q", ErrProfileUnknownScope, scope)
		}
		scopes = append(scopes, typed)
	}
	return Profile{
		Alias:                               raw.Alias,
		PrivacyPosture:                      privacy,
		ComputePosture:                      compute,
		CapabilitySet:                       append([]string(nil), raw.CapabilitySet...),
		RoutingPolicy:                       routing,
		HostCapabilityProfileRefs:           append([]string(nil), raw.HostCapabilityProfileRefs...),
		LocalComputePackRefs:                append([]string(nil), raw.LocalComputePackRefs...),
		DependencyFamilyRefs:                append([]string(nil), raw.DependencyFamilyRefs...),
		MaterializationConfirmationRequired: raw.MaterializationConfirmationRequired,
		ApplicableScopes:                    scopes,
		SourceRule:                          raw.SourceRule,
	}, nil
}

// FindByAlias returns the catalog profile with the given alias. The
// boolean reports whether a match was found. Lookup is exact, since
// alias is a readable projection of the four-dimensional key.
func (c *Catalog) FindByAlias(alias string) (*Profile, bool) {
	if c == nil {
		return nil, false
	}
	for index := range c.Profiles {
		if c.Profiles[index].Alias == alias {
			return &c.Profiles[index], true
		}
	}
	return nil, false
}

// Filter returns the catalog profiles that match every non-empty
// dimension in the criteria. An empty (zero-value) dimension matches
// any value. The returned slice is a fresh allocation; callers may
// retain it without mutating the underlying Catalog.
func (c *Catalog) Filter(criteria FilterCriteria) []Profile {
	if c == nil {
		return nil
	}
	matches := make([]Profile, 0, len(c.Profiles))
	for _, profile := range c.Profiles {
		if criteria.PrivacyPosture != "" && profile.PrivacyPosture != criteria.PrivacyPosture {
			continue
		}
		if criteria.ComputePosture != "" && profile.ComputePosture != criteria.ComputePosture {
			continue
		}
		if criteria.RoutingPolicy != "" && profile.RoutingPolicy != criteria.RoutingPolicy {
			continue
		}
		if criteria.ApplicableScope != "" && !profile.SupportsScope(criteria.ApplicableScope) {
			continue
		}
		matches = append(matches, profile)
	}
	return matches
}
