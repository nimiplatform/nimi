package appregistrycatalog

import (
	"fmt"
	"io"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type rawRegistry struct {
	Version     int      `yaml:"version"`
	TableFamily string   `yaml:"table_family"`
	Owner       string   `yaml:"owner"`
	CatalogID   string   `yaml:"catalog_id"`
	Apps        []rawApp `yaml:"apps"`
}

type rawPermissionRequirement struct {
	PermissionID string `yaml:"id"`
	Reason       string `yaml:"reason"`
}

type rawApp struct {
	AppID                     string                     `yaml:"app_id"`
	DisplayLabel              string                     `yaml:"display_label"`
	Publisher                 string                     `yaml:"publisher"`
	TrustTierRef              string                     `yaml:"trust_tier_ref"`
	PackageKind               string                     `yaml:"package_kind"`
	PackageSignaturePolicyRef string                     `yaml:"package_signature_policy_ref"`
	UpdateChannelRef          string                     `yaml:"update_channel_ref"`
	AIProfileSelectionRef     string                     `yaml:"ai_profile_selection_ref"`
	CapabilitySetRefs         []string                   `yaml:"capability_set_refs"`
	LocalComputePackRefs      []string                   `yaml:"local_compute_pack_refs"`
	RuntimeRegistrationMode   string                     `yaml:"runtime_registration_mode"`
	PermissionRequirements    []rawPermissionRequirement `yaml:"permission_requirements"`
	LegacyPermissionScopeRef  any                        `yaml:"permission_scope_ref"`
	HealthRepairProjection    stringList                 `yaml:"health_repair_projection"`
	OrdinaryVisibility        string                     `yaml:"ordinary_visibility"`
	ReleaseDescriptorRef      string                     `yaml:"release_descriptor_ref"`
	InstallStoragePolicyRef   string                     `yaml:"install_storage_policy_ref"`
	AdmissionStatus           string                     `yaml:"admission_status"`
	SourceRule                string                     `yaml:"source_rule"`
}

type stringList []string

func (s *stringList) UnmarshalYAML(value *yaml.Node) error {
	switch value.Kind {
	case yaml.ScalarNode:
		normalized := value.Value
		if normalized == "" {
			*s = nil
			return nil
		}
		*s = []string{normalized}
		return nil
	case yaml.SequenceNode:
		values := make([]string, 0, len(value.Content))
		for _, item := range value.Content {
			if item.Kind != yaml.ScalarNode {
				return fmt.Errorf("expected scalar string in sequence")
			}
			if item.Value != "" {
				values = append(values, item.Value)
			}
		}
		*s = values
		return nil
	default:
		return fmt.Errorf("expected string or string sequence")
	}
}

// LoadRegistry parses the Nimi App registry from a reader. Fail-closed:
// any row with non-canonical package_kind (i.e., not nimi-app), unknown
// trust tier, unknown admission status, or unknown registration mode is
// rejected.
func LoadRegistry(reader io.Reader) (*Registry, error) {
	if reader == nil {
		return nil, fmt.Errorf("appregistry LoadRegistry: %w", ErrRegistryParse)
	}
	bytes, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("appregistry LoadRegistry read: %w", err)
	}
	var raw rawRegistry
	if err := yaml.Unmarshal(bytes, &raw); err != nil {
		return nil, fmt.Errorf("appregistry LoadRegistry unmarshal: %w: %w", ErrRegistryParse, err)
	}
	if raw.TableFamily == "" || raw.Owner == "" || raw.CatalogID == "" {
		return nil, fmt.Errorf("appregistry LoadRegistry: %w", ErrRegistryMissingFields)
	}
	registry := &Registry{
		Version:     raw.Version,
		TableFamily: raw.TableFamily,
		Owner:       raw.Owner,
		CatalogID:   raw.CatalogID,
		Apps:        make([]App, 0, len(raw.Apps)),
	}
	for index, raw := range raw.Apps {
		app, err := convertApp(raw)
		if err != nil {
			return nil, fmt.Errorf("appregistry LoadRegistry apps[%d] (%q): %w", index, raw.AppID, err)
		}
		registry.Apps = append(registry.Apps, app)
	}
	return registry, nil
}

func LoadRegistryFromFile(path string) (*Registry, error) {
	if path == "" {
		return nil, fmt.Errorf("appregistry LoadRegistryFromFile: empty path: %w", ErrRegistryParse)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("appregistry LoadRegistryFromFile open: %w", err)
	}
	registry, loadErr := LoadRegistry(file)
	if closeErr := file.Close(); closeErr != nil && loadErr == nil {
		return nil, fmt.Errorf("appregistry LoadRegistryFromFile close: %w", closeErr)
	}
	return registry, loadErr
}

func convertApp(raw rawApp) (App, error) {
	if raw.AppID == "" || raw.DisplayLabel == "" || raw.Publisher == "" || raw.SourceRule == "" ||
		raw.ReleaseDescriptorRef == "" || raw.InstallStoragePolicyRef == "" {
		return App{}, ErrAppMissingRequiredField
	}
	kind := PackageKind(raw.PackageKind)
	if !kind.Valid() {
		return App{}, fmt.Errorf("%w: %q", ErrAppUnknownPackageKind, raw.PackageKind)
	}
	tier := TrustTier(raw.TrustTierRef)
	if !tier.Valid() {
		return App{}, fmt.Errorf("%w: %q", ErrAppUnknownTrustTier, raw.TrustTierRef)
	}
	mode := RuntimeRegistrationMode(raw.RuntimeRegistrationMode)
	if !mode.Valid() {
		return App{}, fmt.Errorf("%w: %q", ErrAppUnknownRuntimeRegistration, raw.RuntimeRegistrationMode)
	}
	status := AdmissionStatus(raw.AdmissionStatus)
	if !status.Valid() {
		return App{}, fmt.Errorf("%w: %q", ErrAppUnknownAdmissionStatus, raw.AdmissionStatus)
	}
	visibility := OrdinaryVisibility(raw.OrdinaryVisibility)
	if !visibility.Valid() {
		return App{}, fmt.Errorf("%w: %q", ErrAppUnknownOrdinaryVisibility, raw.OrdinaryVisibility)
	}
	if raw.LegacyPermissionScopeRef != nil || raw.PermissionRequirements == nil {
		return App{}, ErrAppInvalidPermissionRequirement
	}
	requirements := make([]PermissionRequirement, 0, len(raw.PermissionRequirements))
	seenPermissions := make(map[string]struct{}, len(raw.PermissionRequirements))
	for index, requirement := range raw.PermissionRequirements {
		permissionID := strings.TrimSpace(requirement.PermissionID)
		reason := strings.TrimSpace(requirement.Reason)
		if permissionID == "" || permissionID != requirement.PermissionID || reason == "" || reason != requirement.Reason || len([]byte(reason)) > 240 {
			return App{}, fmt.Errorf("%w: item %d requires canonical id and bounded reason", ErrAppInvalidPermissionRequirement, index)
		}
		if _, duplicate := seenPermissions[permissionID]; duplicate {
			return App{}, fmt.Errorf("%w: duplicate id %s", ErrAppInvalidPermissionRequirement, permissionID)
		}
		if !admittedPublicPermissionID(permissionID) {
			return App{}, fmt.Errorf("%w: %s", ErrAppPermissionNotAdmitted, permissionID)
		}
		seenPermissions[permissionID] = struct{}{}
		requirements = append(requirements, PermissionRequirement{PermissionID: permissionID, Reason: reason})
	}
	return App{
		AppID:                     raw.AppID,
		DisplayLabel:              raw.DisplayLabel,
		Publisher:                 raw.Publisher,
		TrustTierRef:              tier,
		PackageKind:               kind,
		PackageSignaturePolicyRef: raw.PackageSignaturePolicyRef,
		UpdateChannelRef:          raw.UpdateChannelRef,
		AIProfileSelectionRef:     raw.AIProfileSelectionRef,
		CapabilitySetRefs:         append([]string(nil), raw.CapabilitySetRefs...),
		LocalComputePackRefs:      append([]string(nil), raw.LocalComputePackRefs...),
		RuntimeRegistrationMode:   mode,
		PermissionRequirements:    requirements,
		HealthRepairProjection:    append([]string(nil), raw.HealthRepairProjection...),
		OrdinaryVisibility:        visibility,
		ReleaseDescriptorRef:      raw.ReleaseDescriptorRef,
		InstallStoragePolicyRef:   raw.InstallStoragePolicyRef,
		AdmissionStatus:           status,
		SourceRule:                raw.SourceRule,
	}, nil
}

// No third-party public permission is admitted in the current atomic cut.
// Promoting a catalog row must update this enforcement point together with
// selector, grant, SDK/Kit, Desktop UI, audit, revoke, and positive evidence.
func admittedPublicPermissionID(string) bool {
	return false
}

// FindByID returns the registry entry with the given app_id.
func (r *Registry) FindByID(appID string) (*App, error) {
	if r == nil {
		return nil, fmt.Errorf("appregistry FindByID: %w", ErrAppNotFound)
	}
	for index := range r.Apps {
		if r.Apps[index].AppID == appID {
			return &r.Apps[index], nil
		}
	}
	return nil, fmt.Errorf("appregistry FindByID (%q): %w", appID, ErrAppNotFound)
}
