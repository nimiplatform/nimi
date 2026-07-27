// Package appreleasecatalog implements the Runtime-side typed consumer of the
// Platform Nimi App release descriptor catalog.
package appreleasecatalog

import "errors"

type DescriptorClass string

const (
	DescriptorClassBundledWithNimi           DescriptorClass = "bundled-with-nimi"
	DescriptorClassExternalImmutableArtifact DescriptorClass = "external-immutable-artifact"
)

type SourceKind string

const (
	SourceKindNimiBundle    SourceKind = "nimi-bundle"
	SourceKindGitHubRelease SourceKind = "github-release"
	SourceKindGitHubCommit  SourceKind = "github-commit"
	SourceKindNPMPackage    SourceKind = "npm-package"
)

type AdmissionTrack string

const (
	AdmissionTrackOrdinaryReleaseProof AdmissionTrack = "ordinary-release-proof"
)

type Publisher struct {
	GitHubNamespace    string
	NamespaceKind      string
	IdentityAssurance  string
	VerifiedDomain     string
	KYCVerificationRef string
}

type ArtifactSize struct {
	Download   string
	Installed  string
	UserData   string
	Cache      string
	SharedDeps string
}

type Artifact struct {
	Locator                  string
	DigestAlgorithm          string
	SHA256                   string
	Size                     string
	SizeBreakdown            ArtifactSize
	SignatureOrProvenanceRef string
}

type Source struct {
	Kind SourceKind
	Ref  string
}

type Runtime struct {
	PackageKind string
	EntryRef    string
	SandboxRef  string
}

type Review struct {
	AdmissionPath                     string
	MutableSourceAllowed              bool
	InstallDigestVerificationRequired string
	Decision                          string
	AdjudicatorKind                   string
	AdjudicatorRef                    string
	DecidedAt                         string
}

type PlatformSigningAssurance struct {
	MacOSNotarization       string
	MacOSDeveloperIDSubject string
	WindowsCodeSigning      string
	InstallerSignature      string
	EntitlementsRef         string
	SigningSubject          string
}

type Support struct {
	DiagnosticsBundleFields    []string
	RedactionRules             []string
	UserVisibleIssueCategories []string
	EscalationPath             string
	KillSwitchVisibility       string
	RecoveryInstructions       []string
}

type OSStorageDisclosure struct {
	PathPattern      string
	Purpose          string
	ExpectedSizeBand string
}

type Descriptor struct {
	DescriptorID             string
	AppID                    string
	Version                  string
	AdmissionTrack           AdmissionTrack
	DescriptorClass          DescriptorClass
	Publisher                Publisher
	Source                   Source
	Artifact                 Artifact
	ArtifactMirrorRef        string
	MirrorLicenseCleared     bool
	BuildAssurance           string
	DependencyAssurance      string
	PlatformSigningAssurance PlatformSigningAssurance
	Runtime                  Runtime
	PermissionsRef           string
	StoragePolicyRef         string
	StoragePolicyKind        string
	OSStorageDisclosure      []OSStorageDisclosure
	UpdateChannelRef         string
	RollbackEligibility      string
	Review                   Review
	Support                  Support
	SourceRule               string
}

type Catalog struct {
	Version     int
	TableFamily string
	Owner       string
	CatalogID   string
	Descriptors []Descriptor
}

var (
	ErrDescriptorParse                   = errors.New("nimi-app-release-descriptors parse failed")
	ErrDescriptorMissingFields           = errors.New("release descriptor missing required field")
	ErrDescriptorUnknownClass            = errors.New("release descriptor class is not canonical")
	ErrDescriptorUnknownSourceKind       = errors.New("release descriptor source.kind is not canonical")
	ErrDescriptorDigestUnsupported       = errors.New("release descriptor digest algorithm must be sha256")
	ErrDescriptorPackageKindInvalid      = errors.New("release descriptor runtime.package_kind must be nimi-app")
	ErrDescriptorMutableSource           = errors.New("release descriptor source is mutable or unpinned")
	ErrDescriptorClassSourceMismatch     = errors.New("release descriptor class/source pairing is invalid")
	ErrDescriptorMirrorLicenseUnclear    = errors.New("release descriptor mirror license is not cleared")
	ErrDescriptorBuildAssuranceInvalid   = errors.New("release descriptor build assurance is invalid")
	ErrDescriptorPlatformSigningRequired = errors.New("release descriptor platform signing is required")
	ErrDescriptorStoragePolicyInvalid    = errors.New("release descriptor storage policy is invalid")
	ErrDescriptorNotFound                = errors.New("release descriptor not found")
)
