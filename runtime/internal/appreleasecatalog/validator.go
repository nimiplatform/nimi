package appreleasecatalog

import (
	"fmt"
	"strings"
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
	case SourceKindNimiBundle, SourceKindGitHubRelease, SourceKindGitHubCommit, SourceKindNPMPackage:
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
	if descriptor.DescriptorClass == DescriptorClassExternalImmutableArtifact && mutableSourceRef(descriptor.Source.Kind, descriptor.Source.Ref) {
		return fmt.Errorf("%w: %q", ErrDescriptorMutableSource, descriptor.Source.Ref)
	}
	return nil
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
	default:
		return true
	}
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
