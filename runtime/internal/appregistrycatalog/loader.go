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

type rawPermissionScope struct {
	AppID       string `yaml:"appId"`
	ScopeFamily string `yaml:"scopeFamily"`
	ScopeName   string `yaml:"scopeName"`
	Qualifier   string `yaml:"qualifier"`
}

type rawPermissionScopeRef struct {
	Pending bool
	Scopes  []rawPermissionScope
}

func (r *rawPermissionScopeRef) UnmarshalYAML(value *yaml.Node) error {
	switch value.Kind {
	case yaml.ScalarNode:
		normalized := strings.TrimSpace(value.Value)
		if normalized != PermissionScopeRefPending {
			return fmt.Errorf("permission_scope_ref scalar must be %q", PermissionScopeRefPending)
		}
		r.Pending = true
		r.Scopes = nil
		return nil
	case yaml.SequenceNode:
		scopes := make([]rawPermissionScope, 0, len(value.Content))
		for index, item := range value.Content {
			if item.Kind != yaml.MappingNode {
				return fmt.Errorf("permission_scope_ref[%d] must be a permission scope object", index)
			}
			var scope rawPermissionScope
			if err := item.Decode(&scope); err != nil {
				return fmt.Errorf("permission_scope_ref[%d]: %w", index, err)
			}
			scopes = append(scopes, scope)
		}
		r.Pending = false
		r.Scopes = scopes
		return nil
	default:
		return fmt.Errorf("permission_scope_ref must be %q or a permission scope object sequence", PermissionScopeRefPending)
	}
}

type rawApp struct {
	AppID                     string                `yaml:"app_id"`
	DisplayLabel              string                `yaml:"display_label"`
	Publisher                 string                `yaml:"publisher"`
	TrustTierRef              string                `yaml:"trust_tier_ref"`
	PackageKind               string                `yaml:"package_kind"`
	PackageSignaturePolicyRef string                `yaml:"package_signature_policy_ref"`
	UpdateChannelRef          string                `yaml:"update_channel_ref"`
	AIProfileSelectionRef     string                `yaml:"ai_profile_selection_ref"`
	CapabilitySetRefs         []string              `yaml:"capability_set_refs"`
	LocalComputePackRefs      []string              `yaml:"local_compute_pack_refs"`
	RuntimeRegistrationMode   string                `yaml:"runtime_registration_mode"`
	PermissionScopeRef        rawPermissionScopeRef `yaml:"permission_scope_ref"`
	HealthRepairProjection    stringList            `yaml:"health_repair_projection"`
	OrdinaryVisibility        string                `yaml:"ordinary_visibility"`
	ReleaseDescriptorRef      string                `yaml:"release_descriptor_ref"`
	InstallStoragePolicyRef   string                `yaml:"install_storage_policy_ref"`
	AdmissionStatus           string                `yaml:"admission_status"`
	SourceRule                string                `yaml:"source_rule"`
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
	scopes := make([]PermissionScopeRef, 0, len(raw.PermissionScopeRef.Scopes))
	for _, scope := range raw.PermissionScopeRef.Scopes {
		if strings.TrimSpace(scope.ScopeFamily) == "" || strings.TrimSpace(scope.ScopeName) == "" {
			return App{}, fmt.Errorf("%w: scopeFamily and scopeName are required", ErrAppInvalidPermissionScopeRef)
		}
		scopes = append(scopes, PermissionScopeRef{
			AppID:       strings.TrimSpace(scope.AppID),
			ScopeFamily: strings.TrimSpace(scope.ScopeFamily),
			ScopeName:   strings.TrimSpace(scope.ScopeName),
			Qualifier:   strings.TrimSpace(scope.Qualifier),
		})
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
		PermissionScopeRefPending: raw.PermissionScopeRef.Pending,
		PermissionScopeRefs:       scopes,
		HealthRepairProjection:    append([]string(nil), raw.HealthRepairProjection...),
		OrdinaryVisibility:        visibility,
		ReleaseDescriptorRef:      raw.ReleaseDescriptorRef,
		InstallStoragePolicyRef:   raw.InstallStoragePolicyRef,
		AdmissionStatus:           status,
		SourceRule:                raw.SourceRule,
	}, nil
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
