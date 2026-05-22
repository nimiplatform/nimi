// Package appregistrycatalog implements the Runtime-side typed consumer of the
// Platform Nimi App registry catalog at
// .nimi/spec/platform/kernel/tables/nimi-app-registry.yaml.
//
// Authority: .nimi/spec/platform/kernel/nimi-app-admission-contract.md
// (P-NAPP-001..P-NAPP-012). This package consumes the registry read-only;
// it does not own the schema or admission policy. Per P-NAPP-012, only
// package_kind=nimi-app rows are admitted; the loader fails closed on
// any other kind.
package appregistrycatalog

import "errors"

type PackageKind string

const PackageKindNimiApp PackageKind = "nimi-app"

func (p PackageKind) Valid() bool {
	return p == PackageKindNimiApp
}

type AdmissionStatus string

const (
	AdmissionStatusAdmitted                AdmissionStatus = "admitted"
	AdmissionStatusGatedByAvatarMasterGate AdmissionStatus = "gated_by_avatar_master_gate"
	AdmissionStatusPendingWave4            AdmissionStatus = "pending_wave_4"
	AdmissionStatusDeferred                AdmissionStatus = "deferred"
	AdmissionStatusRetired                 AdmissionStatus = "retired"
)

func (a AdmissionStatus) Valid() bool {
	switch a {
	case AdmissionStatusAdmitted, AdmissionStatusGatedByAvatarMasterGate,
		AdmissionStatusPendingWave4, AdmissionStatusDeferred, AdmissionStatusRetired:
		return true
	}
	return false
}

type TrustTier string

const (
	TrustTierFirstParty      TrustTier = "nimi-first-party"
	TrustTierVerifiedPartner TrustTier = "nimi-verified-partner"
	TrustTierCommunity       TrustTier = "nimi-community"
)

func (t TrustTier) Valid() bool {
	switch t {
	case TrustTierFirstParty, TrustTierVerifiedPartner, TrustTierCommunity:
		return true
	}
	return false
}

type RuntimeRegistrationMode string

const RuntimeRegistrationModeAppManaged RuntimeRegistrationMode = "app-managed"

func (m RuntimeRegistrationMode) Valid() bool {
	return m == RuntimeRegistrationModeAppManaged
}

type OrdinaryVisibility string

const (
	OrdinaryVisibilityOrdinaryVisible    OrdinaryVisibility = "ordinary-visible"
	OrdinaryVisibilityHiddenInternal     OrdinaryVisibility = "hidden-internal"
	OrdinaryVisibilityDeveloperOnly      OrdinaryVisibility = "developer-only"
	OrdinaryVisibilityNotAdmittedVisible OrdinaryVisibility = "not-admitted-visible"
)

func (v OrdinaryVisibility) Valid() bool {
	switch v {
	case OrdinaryVisibilityOrdinaryVisible, OrdinaryVisibilityHiddenInternal,
		OrdinaryVisibilityDeveloperOnly, OrdinaryVisibilityNotAdmittedVisible:
		return true
	}
	return false
}

// PermissionScopeRef captures a single permission scope row from the
// registry. Wave 5 owns the full grant lifecycle; this struct is the
// registry-side typed reference.
type PermissionScopeRef struct {
	AppID       string
	ScopeFamily string
	ScopeName   string
	Qualifier   string
}

// App is a typed Nimi App registry entry.
type App struct {
	AppID                     string
	DisplayLabel              string
	Publisher                 string
	TrustTierRef              TrustTier
	PackageKind               PackageKind
	PackageSignaturePolicyRef string
	UpdateChannelRef          string
	AIProfileSelectionRef     string
	CapabilitySetRefs         []string
	LocalComputePackRefs      []string
	RuntimeRegistrationMode   RuntimeRegistrationMode
	PermissionScopeRefs       []PermissionScopeRef
	HealthRepairProjection    []string
	OrdinaryVisibility        OrdinaryVisibility
	ReleaseDescriptorRef      string
	InstallStoragePolicyRef   string
	AdmissionStatus           AdmissionStatus
	SourceRule                string
}

type Registry struct {
	Version     int
	TableFamily string
	Owner       string
	CatalogID   string
	Apps        []App
}

var (
	ErrRegistryParse                 = errors.New("nimi-app-registry parse failed")
	ErrRegistryMissingFields         = errors.New("nimi-app-registry missing table_family/owner/catalog_id")
	ErrAppMissingRequiredField       = errors.New("app row missing required field")
	ErrAppUnknownPackageKind         = errors.New("app row package_kind is not nimi-app (public mod / extension admission forbidden)")
	ErrAppUnknownTrustTier           = errors.New("app row trust_tier_ref is not canonical")
	ErrAppUnknownAdmissionStatus     = errors.New("app row admission_status is not canonical")
	ErrAppUnknownRuntimeRegistration = errors.New("app row runtime_registration_mode is not canonical")
	ErrAppUnknownOrdinaryVisibility  = errors.New("app row ordinary_visibility is not canonical")
	ErrAppNotFound                   = errors.New("app not found in registry")
)
