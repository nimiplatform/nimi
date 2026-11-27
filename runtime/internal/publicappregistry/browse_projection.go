package publicappregistry

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/appidentity"
	"github.com/nimiplatform/nimi/runtime/internal/appsafety"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
)

const browseProjectionSchemaVersion = 1

// BrowseProjection is a validated, display-only snapshot of the public App
// Catalog sufficient to render the last store first screen when offline.
// Display records omit install selectors, download URLs, package digests, and
// runtime entrypoints and NEVER grant install, update, or launch authority.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
type BrowseProjection struct {
	SchemaVersion int            `json:"schema_version"`
	Targets       []BrowseTarget `json:"targets"`
}

type BrowseTarget struct {
	ObservedRegistryRevision        string             `json:"observed_registry_revision"`
	DescriptorID                    string             `json:"descriptor_id"`
	AppID                           string             `json:"app_id"`
	DisplayName                     string             `json:"display_name"`
	Version                         string             `json:"version"`
	Origin                          string             `json:"origin,omitempty"`
	Upstream                        *ProductUpstream   `json:"upstream,omitempty"`
	AdmissionTrustTier              string             `json:"admission_trust_tier,omitempty"`
	KillSwitch                      KillSwitch         `json:"kill_switch"`
	PublisherGitHubNamespace        string             `json:"publisher_github_namespace"`
	SourceRepository                string             `json:"source_repository"`
	SourceLicenseSPDXExpression     string             `json:"source_license_spdx_expression"`
	AppAccess                       []string           `json:"app_access"`
	CapabilityContractRefs          []string           `json:"capability_contract_refs"`
	RequiredStandardizedFeatureRefs []string           `json:"required_standardized_feature_refs"`
	StoragePolicy                   StoragePolicy      `json:"storage_policy"`
	TargetID                        string             `json:"target_id"`
	OS                              string             `json:"os"`
	Arch                            string             `json:"arch"`
	AssetName                       string             `json:"asset_name"`
	AssetSize                       int64              `json:"asset_size"`
	ExecutionProfileRef             string             `json:"execution_profile_ref"`
	WindowsCodeSigning              string             `json:"windows_code_signing"`
	ObservedSigningSubject          *string            `json:"observed_signing_subject,omitempty"`
	MacOSNotarization               string             `json:"macos_notarization"`
	MacOSDeveloperIDSubject         *string            `json:"macos_developer_id_subject,omitempty"`
	SafetyProfile                   *appsafety.Profile `json:"safety_profile,omitempty"`
}

// EncodeBrowseProjection validates and serializes a resolved platform catalog
// into a display-only browse projection JSON blob.
func EncodeBrowseProjection(targets []ResolvedApprovedTarget, expectedOS, expectedArch string) ([]byte, string, error) {
	if !validTargetPlatform(expectedOS, expectedArch) {
		return nil, "", fmt.Errorf("encode public App Catalog browse projection: %w", ErrInvalidRegistrySnapshot)
	}
	items := make([]BrowseTarget, 0, len(targets))
	seen := make(map[string]struct{}, len(targets))
	registryRevision := ""
	for _, target := range targets {
		if _, err := target.Selector.Encode(); err != nil ||
			target.DescriptorID != target.Selector.DescriptorID() ||
			target.Target.TargetID != target.Selector.TargetID() ||
			target.RegistryRevision != target.Selector.ObservedRegistryCommit() {
			return nil, "", fmt.Errorf("encode public App Catalog browse projection: %w", ErrInvalidRegistrySnapshot)
		}
		if _, duplicate := seen[target.AppID]; duplicate {
			return nil, "", fmt.Errorf("encode public App Catalog browse projection: duplicate app %s: %w", target.AppID, ErrInvalidRegistrySnapshot)
		}
		seen[target.AppID] = struct{}{}
		item := BrowseTarget{
			ObservedRegistryRevision:        target.RegistryRevision,
			DescriptorID:                    target.DescriptorID,
			AppID:                           target.AppID,
			DisplayName:                     target.DisplayName,
			Version:                         target.Version,
			Origin:                          target.Origin,
			Upstream:                        cloneProductUpstream(target.Upstream),
			AdmissionTrustTier:              target.Admission.TrustTier,
			KillSwitch:                      cloneKillSwitch(target.KillSwitch),
			PublisherGitHubNamespace:        target.Publisher.GitHubNamespace,
			SourceRepository:                target.Source.Repository,
			SourceLicenseSPDXExpression:     target.Source.License.SPDXExpression,
			AppAccess:                       nonNilStrings(target.AppAccess),
			CapabilityContractRefs:          nonNilStrings(target.CapabilityContractRefs),
			RequiredStandardizedFeatureRefs: nonNilStrings(target.RequiredStandardizedFeatureRefs),
			StoragePolicy:                   cloneStoragePolicyNonNil(target.StoragePolicy),
			TargetID:                        target.Target.TargetID,
			OS:                              target.Target.OS,
			Arch:                            target.Target.Arch,
			AssetName:                       target.Target.AssetName,
			AssetSize:                       target.Target.Size,
			ExecutionProfileRef:             target.Target.ExecutionProfileRef,
			WindowsCodeSigning:              target.Target.NativeTrust.WindowsCodeSigning,
			ObservedSigningSubject:          cloneOptionalString(target.Target.NativeTrust.ObservedSubject),
			MacOSNotarization:               target.Target.NativeTrust.MacOSNotarization,
			MacOSDeveloperIDSubject:         cloneOptionalString(target.Target.NativeTrust.MacOSDeveloperIDSubject),
			SafetyProfile:                   appsafety.Clone(target.SafetyProfile),
		}
		if err := item.validate(expectedOS, expectedArch); err != nil {
			return nil, "", fmt.Errorf("encode public App Catalog browse projection: %w", err)
		}
		if registryRevision == "" {
			registryRevision = item.ObservedRegistryRevision
		}
		items = append(items, item)
	}
	raw, err := json.Marshal(BrowseProjection{
		SchemaVersion: browseProjectionSchemaVersion,
		Targets:       items,
	})
	if err != nil {
		return nil, "", fmt.Errorf("marshal public App Catalog browse projection: %w", err)
	}
	return raw, registryRevision, nil
}

// DecodeBrowseProjection strictly decodes and validates a persisted display-only
// public catalog browse projection for the current host platform.
func DecodeBrowseProjection(raw []byte, expectedOS, expectedArch string) (BrowseProjection, error) {
	if len(raw) == 0 || !validTargetPlatform(expectedOS, expectedArch) {
		return BrowseProjection{}, fmt.Errorf("decode public App Catalog browse projection: %w", ErrInvalidRegistrySnapshot)
	}
	var projection BrowseProjection
	if err := jsonstrict.Decode(raw, &projection); err != nil {
		return BrowseProjection{}, fmt.Errorf("decode public App Catalog browse projection: %w", errors.Join(ErrInvalidRegistrySnapshot, err))
	}
	if projection.SchemaVersion != browseProjectionSchemaVersion || projection.Targets == nil {
		return BrowseProjection{}, fmt.Errorf("validate public App Catalog browse projection: %w", ErrInvalidRegistrySnapshot)
	}
	seen := make(map[string]struct{}, len(projection.Targets))
	for index := range projection.Targets {
		item := projection.Targets[index]
		if _, duplicate := seen[item.AppID]; duplicate {
			return BrowseProjection{}, fmt.Errorf("validate public App Catalog browse projection duplicate %s: %w", item.AppID, ErrInvalidRegistrySnapshot)
		}
		seen[item.AppID] = struct{}{}
		if err := item.validate(expectedOS, expectedArch); err != nil {
			return BrowseProjection{}, fmt.Errorf("validate public App Catalog browse projection %s: %w", item.AppID, err)
		}
	}
	return projection, nil
}

func (item BrowseTarget) validate(expectedOS, expectedArch string) error {
	if !commitSHAPattern.MatchString(item.ObservedRegistryRevision) ||
		!validDescriptorID(item.DescriptorID) ||
		!appidentity.Valid(item.AppID) ||
		!exactText(item.DisplayName) ||
		!exactText(item.Version) ||
		item.DescriptorID != item.AppID+"@"+item.Version ||
		!targetIDPattern.MatchString(item.TargetID) ||
		!exactText(item.PublisherGitHubNamespace) ||
		!exactText(item.ExecutionProfileRef) ||
		item.AssetSize < 0 {
		return ErrInvalidRegistrySnapshot
	}
	if !TargetCompatibleWithPlatform(Target{
		TargetID:            item.TargetID,
		OS:                  item.OS,
		Arch:                item.Arch,
		ExecutionProfileRef: item.ExecutionProfileRef,
	}, expectedOS, expectedArch) {
		return ErrInvalidRegistrySnapshot
	}
	if err := validateProductOriginAndUpstream(item.Origin, item.Upstream); err != nil {
		return err
	}
	if item.KillSwitch.Active {
		if item.KillSwitch.Reason == nil || !exactText(*item.KillSwitch.Reason) {
			return ErrInvalidRegistrySnapshot
		}
	} else if item.KillSwitch.Reason != nil {
		return ErrInvalidRegistrySnapshot
	}
	if err := appsafety.Validate(item.SafetyProfile); err != nil {
		return fmt.Errorf("%v: %w", err, ErrInvalidRegistrySnapshot)
	}
	if item.AppAccess == nil || item.CapabilityContractRefs == nil || item.RequiredStandardizedFeatureRefs == nil {
		return ErrInvalidRegistrySnapshot
	}
	return nil
}

func nonNilStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string(nil), values...)
}

func cloneStoragePolicyNonNil(value StoragePolicy) StoragePolicy {
	result := value
	if len(value.OSStorageDisclosure) == 0 {
		result.OSStorageDisclosure = []StorageDisclosure{}
	} else {
		result.OSStorageDisclosure = append([]StorageDisclosure(nil), value.OSStorageDisclosure...)
	}
	return result
}

func cloneOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}
