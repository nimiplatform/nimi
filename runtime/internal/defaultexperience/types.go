// Package defaultexperience implements the Runtime-side loader and query
// surface for the Platform-owned Default Experience Profile catalog table
// at .nimi/spec/platform/kernel/tables/default-experience-profiles.yaml.
//
// Authority: .nimi/spec/platform/kernel/default-experience-profile-contract.md
// (P-DXP-001..P-DXP-012). This package consumes the catalog read-only; it
// does not own the schema, recommendation policy, or apply path. Per
// P-DXP-008, profile rows must not embed provider, connector, engine, or
// model identifier strings and this loader does not introduce any.
package defaultexperience

import "errors"

// PrivacyPosture enumerates admitted privacy posture values per
// profile_schema.enums.privacy_posture.
type PrivacyPosture string

const (
	PrivacyPostureCloudOK        PrivacyPosture = "cloud-ok"
	PrivacyPostureLocalPreferred PrivacyPosture = "local-preferred"
	PrivacyPostureLocalRequired  PrivacyPosture = "local-required"
)

// Valid reports whether the privacy posture is an admitted value.
func (p PrivacyPosture) Valid() bool {
	switch p {
	case PrivacyPostureCloudOK, PrivacyPostureLocalPreferred, PrivacyPostureLocalRequired:
		return true
	}
	return false
}

// ComputePosture enumerates admitted compute posture values per
// profile_schema.enums.compute_posture.
type ComputePosture string

const (
	ComputePostureCPUOnly      ComputePosture = "cpu-only"
	ComputePostureMetalCapable ComputePosture = "metal-capable"
	ComputePostureCUDACapable  ComputePosture = "cuda-capable"
	ComputePostureCloudOnly    ComputePosture = "cloud-only"
)

// Valid reports whether the compute posture is an admitted value.
func (c ComputePosture) Valid() bool {
	switch c {
	case ComputePostureCPUOnly, ComputePostureMetalCapable, ComputePostureCUDACapable, ComputePostureCloudOnly:
		return true
	}
	return false
}

// RoutingPolicy enumerates admitted routing policy values per
// profile_schema.enums.routing_policy.
type RoutingPolicy string

const (
	RoutingPolicyCloudFirst     RoutingPolicy = "cloud-first"
	RoutingPolicyLocalFirst     RoutingPolicy = "local-first"
	RoutingPolicyHybridExplicit RoutingPolicy = "hybrid-explicit"
)

// Valid reports whether the routing policy is an admitted value.
func (r RoutingPolicy) Valid() bool {
	switch r {
	case RoutingPolicyCloudFirst, RoutingPolicyLocalFirst, RoutingPolicyHybridExplicit:
		return true
	}
	return false
}

// ApplicableScope enumerates admitted applicable_scopes values per
// profile_schema.enums.applicable_scopes.
type ApplicableScope string

const (
	ApplicableScopeFirstRun        ApplicableScope = "first-run"
	ApplicableScopeFirstPartyApp   ApplicableScope = "first-party-app"
	ApplicableScopeScopeBoundApply ApplicableScope = "scope-bound-apply"
)

// Valid reports whether the applicable scope is an admitted value.
func (a ApplicableScope) Valid() bool {
	switch a {
	case ApplicableScopeFirstRun, ApplicableScopeFirstPartyApp, ApplicableScopeScopeBoundApply:
		return true
	}
	return false
}

// Profile is a single Default Experience Profile catalog row. The four
// dimension fields together key the row per P-DXP-002; alias is a
// readable projection and must not be treated as a schema owner.
type Profile struct {
	Alias                               string
	PrivacyPosture                      PrivacyPosture
	ComputePosture                      ComputePosture
	CapabilitySet                       []string
	RoutingPolicy                       RoutingPolicy
	HostCapabilityProfileRefs           []string
	LocalComputePackRefs                []string
	DependencyFamilyRefs                []string
	MaterializationConfirmationRequired bool
	ApplicableScopes                    []ApplicableScope
	SourceRule                          string
}

// SupportsScope reports whether the profile lists the given scope in its
// applicable_scopes.
func (p *Profile) SupportsScope(scope ApplicableScope) bool {
	for _, declared := range p.ApplicableScopes {
		if declared == scope {
			return true
		}
	}
	return false
}

// Catalog is the parsed Platform Default Experience Profile catalog
// table. It is read-only; callers must not mutate Profiles.
type Catalog struct {
	Version     int
	TableFamily string
	Owner       string
	CatalogID   string
	Profiles    []Profile
}

// FilterCriteria narrows the catalog by dimension. Empty (zero-value)
// fields match any value.
type FilterCriteria struct {
	PrivacyPosture  PrivacyPosture
	ComputePosture  ComputePosture
	RoutingPolicy   RoutingPolicy
	ApplicableScope ApplicableScope
}

// Sentinel errors returned by the loader and query API.
var (
	ErrCatalogParse              = errors.New("default-experience catalog parse failed")
	ErrCatalogMissingProfile     = errors.New("default-experience catalog has no profiles")
	ErrProfileUnknownPrivacy     = errors.New("default-experience profile uses unknown privacy_posture")
	ErrProfileUnknownCompute     = errors.New("default-experience profile uses unknown compute_posture")
	ErrProfileUnknownRouting     = errors.New("default-experience profile uses unknown routing_policy")
	ErrProfileUnknownScope       = errors.New("default-experience profile uses unknown applicable_scope")
	ErrProfileMissingAlias       = errors.New("default-experience profile is missing alias")
	ErrProfileMissingSourceRule  = errors.New("default-experience profile is missing source_rule")
	ErrCatalogMissingTableFamily = errors.New("default-experience catalog is missing table_family or owner or catalog_id")
)
