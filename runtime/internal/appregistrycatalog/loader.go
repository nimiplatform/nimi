package appregistrycatalog

import (
	"fmt"
	"io"
	"os"

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

type rawApp struct {
	AppID                     string               `yaml:"app_id"`
	DisplayLabel              string               `yaml:"display_label"`
	Publisher                 string               `yaml:"publisher"`
	TrustTierRef              string               `yaml:"trust_tier_ref"`
	PackageKind               string               `yaml:"package_kind"`
	PackageSignaturePolicyRef string               `yaml:"package_signature_policy_ref"`
	UpdateChannelRef          string               `yaml:"update_channel_ref"`
	AIProfileSelectionRef     string               `yaml:"ai_profile_selection_ref"`
	CapabilitySetRefs         []string             `yaml:"capability_set_refs"`
	LocalComputePackRefs      []string             `yaml:"local_compute_pack_refs"`
	RuntimeRegistrationMode   string               `yaml:"runtime_registration_mode"`
	PermissionScopeRef        []rawPermissionScope `yaml:"permission_scope_ref"`
	HealthRepairProjection    string               `yaml:"health_repair_projection"`
	AdmissionStatus           string               `yaml:"admission_status"`
	SourceRule                string               `yaml:"source_rule"`
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
	defer file.Close()
	return LoadRegistry(file)
}

func convertApp(raw rawApp) (App, error) {
	if raw.AppID == "" || raw.DisplayLabel == "" || raw.Publisher == "" || raw.SourceRule == "" {
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
	scopes := make([]PermissionScopeRef, 0, len(raw.PermissionScopeRef))
	for _, scope := range raw.PermissionScopeRef {
		scopes = append(scopes, PermissionScopeRef{
			AppID:       scope.AppID,
			ScopeFamily: scope.ScopeFamily,
			ScopeName:   scope.ScopeName,
			Qualifier:   scope.Qualifier,
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
		PermissionScopeRefs:       scopes,
		HealthRepairProjection:    raw.HealthRepairProjection,
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

// IsLaunchAdmitted reports whether the app is currently admitted for
// ordinary-user launch. Avatar's gated_by_avatar_master_gate status
// blocks launch admission until the master gate clears.
func (a *App) IsLaunchAdmitted() bool {
	return a != nil && a.AdmissionStatus == AdmissionStatusAdmitted
}
