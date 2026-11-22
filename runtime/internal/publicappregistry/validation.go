package publicappregistry

import (
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/runtime/internal/appidentity"
	"github.com/nimiplatform/nimi/runtime/internal/appsafety"
)

const maxStorefrontMediaBytes = int64(8 * 1024 * 1024)

func validateProductOriginAndUpstream(origin string, upstream *ProductUpstream) error {
	if origin != "" {
		switch origin {
		case "nimi-official", "open-source-adapted", "community":
		default:
			return ErrInvalidRegistrySnapshot
		}
	}
	if origin == "open-source-adapted" && upstream == nil {
		return ErrInvalidRegistrySnapshot
	}
	if upstream != nil {
		if origin != "open-source-adapted" {
			return ErrInvalidRegistrySnapshot
		}
		if !exactText(upstream.Name) || utf8.RuneCountInString(upstream.Name) > 120 || !validHTTPSURL(upstream.URL) {
			return ErrInvalidRegistrySnapshot
		}
	}
	return nil
}

func validHTTPSURL(raw string) bool {
	if !exactText(raw) || utf8.RuneCountInString(raw) > 2048 {
		return false
	}
	parsed, err := url.Parse(raw)
	return err == nil && parsed.Scheme == "https" && parsed.Hostname() != "" && parsed.User == nil
}

func validateIndex(index registryIndexDocument) error {
	if index.SchemaVersion != 1 || index.Apps == nil {
		return fmt.Errorf("validate public App Registry index: %w", ErrInvalidRegistrySnapshot)
	}
	for appID, row := range index.Apps {
		if !appidentity.Valid(appID) || !exactText(row.DisplayName) ||
			(row.Visibility != "public" && row.Visibility != "hidden") || row.AdmissionStatus != "approved" ||
			len(row.LatestAdmittedReleaseByTarget) == 0 {
			return fmt.Errorf("validate public App Registry index row %s: %w", appID, ErrInvalidRegistrySnapshot)
		}
		if err := validateProductOriginAndUpstream(row.Origin, row.Upstream); err != nil {
			return fmt.Errorf("validate public App Registry origin %s: %w", appID, err)
		}
		if row.KillSwitch.Active {
			if row.KillSwitch.Reason == nil || !exactText(*row.KillSwitch.Reason) {
				return fmt.Errorf("validate public App Registry kill switch %s: %w", appID, ErrInvalidRegistrySnapshot)
			}
		} else if row.KillSwitch.Reason != nil {
			return fmt.Errorf("validate public App Registry kill switch %s: %w", appID, ErrInvalidRegistrySnapshot)
		}
		for targetID, pointer := range row.LatestAdmittedReleaseByTarget {
			if !targetIDPattern.MatchString(targetID) {
				return fmt.Errorf("validate public App Registry target pointer %s/%s: %w", appID, targetID, ErrInvalidRegistrySnapshot)
			}
			if err := validateDescriptorPointer(appID, pointer); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateDescriptorPointer(appID string, pointer descriptorPointer) error {
	pointerAppID, ok := descriptorAppID(pointer.DescriptorID)
	match := descriptorPathRegexp.FindStringSubmatch(pointer.Path)
	if !ok || pointerAppID != appID || len(match) != 3 || match[1] != appID ||
		pointer.Path != expectedDescriptorPath(pointerAppID, pointer.DescriptorID[len(pointerAppID)+1:]) {
		return fmt.Errorf("validate public App Registry descriptor pointer %s: %w", appID, ErrInvalidRegistrySnapshot)
	}
	return nil
}

func validateDescriptor(descriptor approvedDescriptorDocument, descriptorPath, appID, targetID string) (Target, error) {
	candidate := descriptor.Candidate
	expectedID := candidate.AppID + "@" + candidate.Version
	if descriptor.SchemaVersion != 1 || descriptor.DescriptorID != expectedID || descriptorPath != expectedDescriptorPath(candidate.AppID, candidate.Version) ||
		candidate.AppID != appID || descriptor.Admission.Review.Decision != "approved" ||
		!descriptor.Admission.OrdinaryReleaseProof || descriptor.Admission.BuildAssurance != "developer-attested" ||
		!descriptor.Admission.DependencyAssurance.LockfileReviewed {
		return Target{}, fmt.Errorf("validate approved App descriptor identity: %w", ErrInvalidRegistrySnapshot)
	}
	if err := validateCandidateFacts(candidate); err != nil {
		return Target{}, err
	}
	var selected *Target
	for index := range candidate.Targets {
		if candidate.Targets[index].TargetID == targetID {
			selected = &candidate.Targets[index]
			break
		}
	}
	if selected == nil {
		return Target{}, fmt.Errorf("resolve approved App target: %w", ErrCatalogTargetNotFound)
	}
	return cloneTarget(*selected), nil
}

func validateCandidateFacts(candidate approvedCandidate) error {
	if !appidentity.Valid(candidate.AppID) || !exactText(candidate.DisplayName) || !exactText(candidate.Version) ||
		candidate.Release.Tag != "v"+candidate.Version || !candidate.Release.Immutable || candidate.Release.Prerelease ||
		!commitSHAPattern.MatchString(candidate.Release.CommitSHA) || candidate.Package.Kind != "nimiapp" ||
		(candidate.Package.RuntimeKind != "native" && candidate.Package.RuntimeKind != "managed-web") ||
		candidate.Package.RegistrationMode != "app-managed" ||
		candidate.Targets == nil || len(candidate.Targets) == 0 || candidate.Source.License.Files == nil ||
		candidate.AppAccess == nil || candidate.CapabilityContractRefs == nil || candidate.RequiredStandardizedFeatureRefs == nil {
		return fmt.Errorf("validate approved App candidate: %w", ErrInvalidRegistrySnapshot)
	}
	if candidate.Package.RuntimeKind == "managed-web" {
		if len(candidate.Targets) != 1 || candidate.StoragePolicy.Kind != "nimi-mediated-default" {
			return fmt.Errorf("validate approved managed-web App candidate: %w", ErrInvalidRegistrySnapshot)
		}
	}
	owner, err := githubRepositoryOwner(candidate.Source.Repository)
	if err != nil || !strings.EqualFold(owner, candidate.Publisher.GitHubNamespace) {
		return fmt.Errorf("validate approved App source publisher: %w", ErrInvalidRegistrySnapshot)
	}
	if candidate.Release.ReleaseURL != candidate.Source.Repository+"/releases/tag/"+candidate.Release.Tag {
		return fmt.Errorf("validate approved App Release locator: %w", ErrInvalidRegistrySnapshot)
	}
	if err := appsafety.Validate(candidate.SafetyProfile); err != nil {
		return fmt.Errorf("validate approved App safety declaration %v: %w", err, ErrInvalidRegistrySnapshot)
	}
	if err := validateAsset(candidate.Aggregate.AssetID, candidate.Aggregate.AssetName, candidate.Aggregate.AssetURL,
		candidate.Aggregate.Size, candidate.Aggregate.SHA256, candidate.Source.Repository, candidate.Release.Tag); err != nil {
		return fmt.Errorf("validate approved App aggregate: %w", err)
	}
	licensePaths := make(map[string]struct{}, len(candidate.Source.License.Files))
	for _, file := range candidate.Source.License.Files {
		if !exactText(file.Path) || !sha256Text(file.SHA256) {
			return fmt.Errorf("validate approved App license: %w", ErrInvalidRegistrySnapshot)
		}
		if _, exists := licensePaths[file.Path]; exists {
			return fmt.Errorf("validate approved App license: %w", ErrInvalidRegistrySnapshot)
		}
		licensePaths[file.Path] = struct{}{}
	}
	targetIDs := make(map[string]struct{}, len(candidate.Targets))
	assetIDs := map[int64]struct{}{candidate.Aggregate.AssetID: {}}
	assetNames := map[string]struct{}{candidate.Aggregate.AssetName: {}}
	if sm := candidate.StorefrontMedia; sm != nil {
		expectedName := candidate.AppID + "-" + candidate.Version + "-storefront-media.zip"
		if sm.AssetName != expectedName || sm.Size > maxStorefrontMediaBytes {
			return fmt.Errorf("validate approved App storefront media: %w", ErrInvalidRegistrySnapshot)
		}
		if _, exists := assetIDs[sm.AssetID]; exists {
			return fmt.Errorf("validate approved App storefront media asset id: %w", ErrInvalidRegistrySnapshot)
		}
		if _, exists := assetNames[sm.AssetName]; exists {
			return fmt.Errorf("validate approved App storefront media asset name: %w", ErrInvalidRegistrySnapshot)
		}
		if err := validateAsset(sm.AssetID, sm.AssetName, sm.AssetURL, sm.Size, sm.SHA256, candidate.Source.Repository, candidate.Release.Tag); err != nil {
			return fmt.Errorf("validate approved App storefront media: %w", err)
		}
		assetIDs[sm.AssetID] = struct{}{}
		assetNames[sm.AssetName] = struct{}{}
	}
	for _, target := range candidate.Targets {
		if _, exists := targetIDs[target.TargetID]; exists {
			return fmt.Errorf("validate approved App targets: %w", ErrInvalidRegistrySnapshot)
		}
		if _, exists := assetIDs[target.AssetID]; exists {
			return fmt.Errorf("validate approved App target asset id: %w", ErrInvalidRegistrySnapshot)
		}
		if _, exists := assetNames[target.AssetName]; exists {
			return fmt.Errorf("validate approved App target asset name: %w", ErrInvalidRegistrySnapshot)
		}
		info := target.AppInfo
		if info.AssetName != candidate.AppID+"-"+candidate.Version+"-"+target.TargetID+".app-info.json" || info.Size > 1024*1024 || info.AssetID == target.AssetID {
			return fmt.Errorf("validate approved App info: %w", ErrInvalidRegistrySnapshot)
		}
		if _, exists := assetIDs[info.AssetID]; exists {
			return ErrInvalidRegistrySnapshot
		}
		if _, exists := assetNames[info.AssetName]; exists {
			return ErrInvalidRegistrySnapshot
		}
		if err := validateAsset(info.AssetID, info.AssetName, info.AssetURL, info.Size, info.SHA256, candidate.Source.Repository, candidate.Release.Tag); err != nil {
			return fmt.Errorf("validate approved App info: %w", err)
		}
		assetIDs[info.AssetID] = struct{}{}
		assetNames[info.AssetName] = struct{}{}
		targetIDs[target.TargetID] = struct{}{}
		assetIDs[target.AssetID] = struct{}{}
		assetNames[target.AssetName] = struct{}{}
		if !targetIDPattern.MatchString(target.TargetID) || !strings.HasPrefix(target.RuntimeEntry, "payload/") ||
			target.ProvenanceAttestationRefs == nil ||
			len(target.ProvenanceAttestationRefs) == 0 || !exactText(target.ExecutionProfileRef) {
			return fmt.Errorf("validate approved App target %s: %w", target.TargetID, ErrInvalidRegistrySnapshot)
		}
		if candidate.Package.RuntimeKind == "managed-web" {
			if target.TargetID != ManagedWebTargetID || target.OS != "any" || target.Arch != "any" ||
				target.RuntimeEntry != ManagedWebRuntimeEntry || target.ExecutionProfileRef != ManagedWebExecutionProfileRef ||
				target.NativeTrust.WindowsCodeSigning != "not-applicable" || target.NativeTrust.MacOSNotarization != "not-applicable" ||
				target.NativeTrust.SigningSubject != nil || target.NativeTrust.ObservedSubject != nil ||
				target.NativeTrust.MacOSDeveloperIDSubject != nil || target.NativeTrust.EntitlementsRef != nil {
				return fmt.Errorf("validate approved managed-web target %s: %w", target.TargetID, ErrInvalidRegistrySnapshot)
			}
		} else if target.TargetID == ManagedWebTargetID || target.OS == "any" || target.Arch == "any" || target.ExecutionProfileRef == ManagedWebExecutionProfileRef {
			return fmt.Errorf("validate approved native target %s: %w", target.TargetID, ErrInvalidRegistrySnapshot)
		}
		if err := validateAsset(target.AssetID, target.AssetName, target.AssetURL, target.Size, target.SHA256, candidate.Source.Repository, candidate.Release.Tag); err != nil {
			return fmt.Errorf("validate approved App target %s: %w", target.TargetID, err)
		}
	}
	return nil
}

func validateAsset(assetID int64, name, rawURL string, size int64, sha256, sourceRepository, tag string) error {
	if assetID <= 0 || size <= 0 || !exactText(name) || !sha256Text(sha256) {
		return ErrInvalidRegistrySnapshot
	}
	if err := validateTaggedReleaseAssetURL(sourceRepository, tag, rawURL, name); err != nil {
		return ErrInvalidRegistrySnapshot
	}
	return nil
}

func validateTaggedReleaseAssetURL(sourceRepository, tag, rawURL, assetName string) error {
	if strings.Contains(rawURL, "\\") {
		return ErrInvalidRegistrySnapshot
	}
	source, sourceErr := url.Parse(sourceRepository)
	asset, assetErr := url.Parse(rawURL)
	if sourceErr != nil || assetErr != nil || asset.Scheme != "https" || asset.Host != "github.com" ||
		asset.User != nil || asset.RawQuery != "" || asset.Fragment != "" {
		return ErrInvalidRegistrySnapshot
	}
	sourceSegments := strings.Split(strings.TrimPrefix(source.EscapedPath(), "/"), "/")
	rawSegments := strings.Split(asset.EscapedPath(), "/")
	if len(sourceSegments) != 2 || len(rawSegments) != 7 || rawSegments[0] != "" {
		return ErrInvalidRegistrySnapshot
	}
	segments := make([]string, 0, 6)
	for _, rawSegment := range rawSegments[1:] {
		segment, err := url.PathUnescape(rawSegment)
		if err != nil || segment == "" || segment == "." || segment == ".." || strings.ContainsAny(segment, "/\\") {
			return ErrInvalidRegistrySnapshot
		}
		segments = append(segments, segment)
	}
	expected := []string{sourceSegments[0], sourceSegments[1], "releases", "download", tag, assetName}
	for index := range expected {
		if segments[index] != expected[index] {
			return ErrInvalidRegistrySnapshot
		}
	}
	return nil
}

func githubRepositoryOwner(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" || strings.HasSuffix(parsed.Path, "/") {
		return "", ErrInvalidRegistrySnapshot
	}
	segments := strings.Split(strings.TrimPrefix(parsed.Path, "/"), "/")
	if len(segments) != 2 || !exactText(segments[0]) || !exactText(segments[1]) {
		return "", ErrInvalidRegistrySnapshot
	}
	return segments[0], nil
}

func exactText(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && !strings.ContainsAny(value, "\x00\r\n")
}

func sha256Text(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
