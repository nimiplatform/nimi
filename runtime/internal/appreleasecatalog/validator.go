package appreleasecatalog

import (
	"fmt"
	"strings"
	"time"
)

func ValidateDescriptor(descriptor Descriptor) error {
	if descriptor.DescriptorID == "" || descriptor.AppID == "" || descriptor.Version == "" ||
		descriptor.Source.Ref == "" || descriptor.Artifact.Locator == "" ||
		descriptor.Artifact.SHA256 == "" || descriptor.Artifact.Size == "" ||
		descriptor.Artifact.SignatureOrProvenanceRef == "" || descriptor.Runtime.EntryRef == "" ||
		descriptor.Runtime.SandboxRef == "" || descriptor.PermissionsRef == "" ||
		descriptor.StoragePolicyRef == "" || descriptor.SourceRule == "" {
		return ErrDescriptorMissingFields
	}
	if descriptor.Review.AdmissionPath == "" || descriptor.Review.InstallDigestVerificationRequired == "" {
		return ErrDescriptorMissingFields
	}
	switch descriptor.DescriptorClass {
	case DescriptorClassBundledWithNimi, DescriptorClassExternalImmutableArtifact:
	default:
		return fmt.Errorf("%w: %q", ErrDescriptorUnknownClass, descriptor.DescriptorClass)
	}
	switch descriptor.Source.Kind {
	case SourceKindNimiBundle, SourceKindGitHubRelease, SourceKindGitHubCommit, SourceKindNPMPackage, SourceKindAdmissionSandboxHTTPSArtifact:
	default:
		return fmt.Errorf("%w: %q", ErrDescriptorUnknownSourceKind, descriptor.Source.Kind)
	}
	if descriptor.Artifact.DigestAlgorithm != "sha256" {
		return fmt.Errorf("%w: %q", ErrDescriptorDigestUnsupported, descriptor.Artifact.DigestAlgorithm)
	}
	if descriptor.Runtime.PackageKind != "nimi-app" {
		return fmt.Errorf("%w: %q", ErrDescriptorPackageKindInvalid, descriptor.Runtime.PackageKind)
	}
	if descriptor.Review.MutableSourceAllowed {
		return ErrDescriptorMutableSource
	}
	if descriptor.DescriptorClass == DescriptorClassBundledWithNimi && descriptor.Source.Kind != SourceKindNimiBundle {
		return fmt.Errorf("%w: %s cannot use %s", ErrDescriptorClassSourceMismatch, descriptor.DescriptorClass, descriptor.Source.Kind)
	}
	if descriptor.DescriptorClass == DescriptorClassExternalImmutableArtifact && descriptor.Source.Kind == SourceKindNimiBundle {
		return fmt.Errorf("%w: %s cannot use %s", ErrDescriptorClassSourceMismatch, descriptor.DescriptorClass, descriptor.Source.Kind)
	}
	if descriptor.DescriptorClass == DescriptorClassBundledWithNimi {
		return nil
	}
	if err := validateExternalImmutableDescriptor(descriptor); err != nil {
		return err
	}
	if descriptor.DescriptorClass == DescriptorClassExternalImmutableArtifact && mutableSourceRef(descriptor.Source.Kind, descriptor.Source.Ref) {
		return fmt.Errorf("%w: %q", ErrDescriptorMutableSource, descriptor.Source.Ref)
	}
	return nil
}

func validateExternalImmutableDescriptor(descriptor Descriptor) error {
	if descriptor.AdmissionTrack == "" ||
		descriptor.Publisher.GitHubNamespace == "" ||
		descriptor.Publisher.NamespaceKind == "" ||
		descriptor.Publisher.IdentityAssurance == "" ||
		descriptor.ArtifactMirrorRef == "" ||
		descriptor.BuildAssurance == "" ||
		descriptor.DependencyAssurance == "" ||
		descriptor.StoragePolicyKind == "" ||
		descriptor.UpdateChannelRef == "" ||
		descriptor.RollbackEligibility == "" ||
		descriptor.Review.Decision == "" ||
		descriptor.Review.AdjudicatorKind == "" ||
		descriptor.Review.AdjudicatorRef == "" ||
		descriptor.Review.DecidedAt == "" ||
		descriptor.Support.EscalationPath == "" ||
		descriptor.Support.KillSwitchVisibility == "" {
		return ErrDescriptorMissingFields
	}
	if !strings.HasPrefix(descriptor.Publisher.GitHubNamespace, "github.com/") {
		return fmt.Errorf("%w: publisher.github_namespace", ErrDescriptorMissingFields)
	}
	if !exactSemanticVersion(descriptor.Version) {
		return fmt.Errorf("%w: version must be exact semantic version", ErrDescriptorMissingFields)
	}
	if _, err := time.Parse(time.RFC3339, descriptor.Review.DecidedAt); err != nil {
		return fmt.Errorf("%w: review.decided_at must be RFC3339 timestamp", ErrDescriptorMissingFields)
	}
	switch descriptor.Publisher.NamespaceKind {
	case "user", "org":
	default:
		return fmt.Errorf("%w: publisher.namespace_kind", ErrDescriptorMissingFields)
	}
	switch descriptor.Publisher.IdentityAssurance {
	case "pseudonymous":
	case "domain-verified":
		if descriptor.Publisher.VerifiedDomain == "" {
			return fmt.Errorf("%w: publisher.verified_domain", ErrDescriptorMissingFields)
		}
	case "identity-verified":
		if descriptor.Publisher.VerifiedDomain == "" || descriptor.Publisher.KYCVerificationRef == "" {
			return fmt.Errorf("%w: publisher identity assurance", ErrDescriptorMissingFields)
		}
	default:
		return fmt.Errorf("%w: publisher.identity_assurance", ErrDescriptorMissingFields)
	}
	if !descriptor.MirrorLicenseCleared {
		return ErrDescriptorMirrorLicenseUnclear
	}
	if descriptor.BuildAssurance == "checksum-pinned" {
		return ErrDescriptorBuildAssuranceInvalid
	}
	if missingArtifactSizeBreakdown(descriptor.Artifact.SizeBreakdown) {
		return fmt.Errorf("%w: artifact.size", ErrDescriptorMissingFields)
	}
	if missingPlatformSigning(descriptor.PlatformSigningAssurance) {
		return fmt.Errorf("%w: platform_signing_assurance", ErrDescriptorMissingFields)
	}
	if len(descriptor.Support.DiagnosticsBundleFields) == 0 ||
		len(descriptor.Support.RedactionRules) == 0 ||
		len(descriptor.Support.UserVisibleIssueCategories) == 0 ||
		len(descriptor.Support.RecoveryInstructions) == 0 {
		return fmt.Errorf("%w: support", ErrDescriptorMissingFields)
	}
	if err := validateStoragePolicy(descriptor); err != nil {
		return err
	}
	if !strings.HasPrefix(descriptor.Artifact.Locator, "https://") {
		return fmt.Errorf("%w: artifact.locator", ErrDescriptorMutableSource)
	}
	switch descriptor.AdmissionTrack {
	case AdmissionTrackOrdinaryReleaseProof:
		if descriptor.Source.Kind == SourceKindAdmissionSandboxHTTPSArtifact {
			return fmt.Errorf("%w: ordinary-release-proof cannot use %s", ErrDescriptorTrackSourceMismatch, descriptor.Source.Kind)
		}
		if ordinarySigningUsesInternalOrNA(descriptor.PlatformSigningAssurance) {
			return fmt.Errorf("%w: ordinary-release-proof", ErrDescriptorPlatformSigningRequired)
		}
	case AdmissionTrackSandboxCI:
		if descriptor.Source.Kind != SourceKindAdmissionSandboxHTTPSArtifact {
			return fmt.Errorf("%w: admission-sandbox-ci cannot use %s", ErrDescriptorTrackSourceMismatch, descriptor.Source.Kind)
		}
	default:
		return fmt.Errorf("%w: admission_track", ErrDescriptorMissingFields)
	}
	return nil
}

func validateStoragePolicy(descriptor Descriptor) error {
	switch descriptor.StoragePolicyKind {
	case "nimi-mediated-default":
		if descriptor.StoragePolicyRef != "nimi-data-app-roots" {
			return fmt.Errorf("%w: nimi-mediated-default requires nimi-data-app-roots", ErrDescriptorStoragePolicyInvalid)
		}
		if len(descriptor.OSStorageDisclosure) > 0 {
			return fmt.Errorf("%w: os_storage_disclosure must be absent for nimi-mediated-default", ErrDescriptorStoragePolicyInvalid)
		}
	case "app-owned-os-storage":
		if len(descriptor.OSStorageDisclosure) == 0 {
			return fmt.Errorf("%w: os_storage_disclosure missing", ErrDescriptorStoragePolicyInvalid)
		}
		for _, disclosure := range descriptor.OSStorageDisclosure {
			if disclosure.PathPattern == "" || disclosure.Purpose == "" || disclosure.ExpectedSizeBand == "" {
				return fmt.Errorf("%w: os_storage_disclosure incomplete", ErrDescriptorStoragePolicyInvalid)
			}
		}
	default:
		return fmt.Errorf("%w: storage_policy_ref.kind", ErrDescriptorStoragePolicyInvalid)
	}
	return nil
}

func missingArtifactSizeBreakdown(size ArtifactSize) bool {
	return size.Download == "" ||
		size.Installed == "" ||
		size.UserData == "" ||
		size.Cache == "" ||
		size.SharedDeps == ""
}

func missingPlatformSigning(signing PlatformSigningAssurance) bool {
	return signing.MacOSNotarization == "" ||
		signing.MacOSDeveloperIDSubject == "" ||
		signing.WindowsCodeSigning == "" ||
		signing.InstallerSignature == "" ||
		signing.EntitlementsRef == "" ||
		signing.SigningSubject == ""
}

func ordinarySigningUsesInternalOrNA(signing PlatformSigningAssurance) bool {
	return signingValueIsInternalOrNA(signing.MacOSNotarization) ||
		signingValueIsInternalOrNA(signing.WindowsCodeSigning) ||
		signingValueIsInternalOrNA(signing.InstallerSignature)
}

func signingValueIsInternalOrNA(value string) bool {
	switch strings.TrimSpace(value) {
	case "not-applicable", "not-required-internal":
		return true
	default:
		return false
	}
}

func mutableSourceRef(kind SourceKind, ref string) bool {
	normalized := strings.ToLower(strings.TrimSpace(ref))
	if normalized == "" {
		return true
	}
	if normalized == "main" || normalized == "master" || normalized == "latest" || normalized == "next" || normalized == "stable" {
		return true
	}
	if strings.ContainsAny(normalized, "*^~<>|=") || strings.HasPrefix(normalized, "tag:") {
		return true
	}
	if strings.Contains(normalized, "/tree/") ||
		strings.Contains(normalized, "refs/heads/") ||
		strings.Contains(normalized, "refs/tags/") ||
		strings.Contains(normalized, "/releases/tag/") ||
		strings.Contains(normalized, "#main") ||
		strings.Contains(normalized, "#master") ||
		strings.HasSuffix(normalized, "@latest") ||
		strings.HasSuffix(normalized, "@next") ||
		strings.Contains(normalized, "@1.x") ||
		strings.Contains(normalized, "@beta") ||
		strings.Contains(normalized, "@canary") {
		return true
	}
	switch kind {
	case SourceKindNPMPackage:
		return !exactNPMPackageVersionRef(normalized)
	case SourceKindGitHubCommit:
		return !exactGitCommitRef(normalized)
	case SourceKindGitHubRelease:
		return bareGitTagRef(normalized) || !immutableGitHubReleaseArtifactRef(normalized)
	case SourceKindAdmissionSandboxHTTPSArtifact:
		return !immutableHTTPSArtifactRef(normalized)
	default:
		return true
	}
}

func immutableHTTPSArtifactRef(ref string) bool {
	return strings.HasPrefix(ref, "https://") &&
		!strings.Contains(ref, "/latest/") &&
		!strings.Contains(ref, "/main/") &&
		!strings.Contains(ref, "/master/") &&
		!strings.Contains(ref, "/next/") &&
		!strings.Contains(ref, "/stable/")
}

func exactNPMPackageVersionRef(ref string) bool {
	at := strings.LastIndex(ref, "@")
	if at <= 0 || at == len(ref)-1 {
		return false
	}
	version := ref[at+1:]
	core := strings.SplitN(version, "-", 2)[0]
	segments := strings.Split(core, ".")
	if len(segments) != 3 {
		return false
	}
	for _, segment := range segments {
		if segment == "" {
			return false
		}
		for _, r := range segment {
			if r < '0' || r > '9' {
				return false
			}
		}
	}
	return true
}

func exactSemanticVersion(version string) bool {
	core := strings.SplitN(strings.TrimSpace(version), "-", 2)[0]
	segments := strings.Split(core, ".")
	if len(segments) != 3 {
		return false
	}
	for _, segment := range segments {
		if segment == "" {
			return false
		}
		for _, r := range segment {
			if r < '0' || r > '9' {
				return false
			}
		}
	}
	return true
}

func exactGitCommitRef(ref string) bool {
	if len(ref) == 40 && isLowerHex(ref) {
		return true
	}
	parts := strings.Split(ref, "/commit/")
	return len(parts) == 2 && len(parts[1]) == 40 && isLowerHex(parts[1])
}

func bareGitTagRef(ref string) bool {
	if strings.Contains(ref, "/") || strings.Contains(ref, ":") || strings.Contains(ref, "#") {
		return false
	}
	return strings.HasPrefix(ref, "v") || strings.HasPrefix(ref, "release-")
}

func immutableGitHubReleaseArtifactRef(ref string) bool {
	marker := "/releases/download/"
	index := strings.Index(ref, marker)
	if index < 0 {
		return false
	}
	rest := ref[index+len(marker):]
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	switch parts[0] {
	case "latest", "main", "master", "next", "stable":
		return false
	}
	return true
}

func isLowerHex(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return false
		}
	}
	return true
}
