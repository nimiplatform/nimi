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

type Artifact struct {
	Locator                  string
	DigestAlgorithm          string
	SHA256                   string
	Size                     string
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
}

type Descriptor struct {
	DescriptorID     string
	AppID            string
	Version          string
	DescriptorClass  DescriptorClass
	Source           Source
	Artifact         Artifact
	Runtime          Runtime
	PermissionsRef   string
	StoragePolicyRef string
	Review           Review
	SourceRule       string
}

type Catalog struct {
	Version     int
	TableFamily string
	Owner       string
	CatalogID   string
	Descriptors []Descriptor
}

var (
	ErrDescriptorParse               = errors.New("nimi-app-release-descriptors parse failed")
	ErrDescriptorMissingFields       = errors.New("release descriptor missing required field")
	ErrDescriptorUnknownClass        = errors.New("release descriptor class is not canonical")
	ErrDescriptorUnknownSourceKind   = errors.New("release descriptor source.kind is not canonical")
	ErrDescriptorDigestUnsupported   = errors.New("release descriptor digest algorithm must be sha256")
	ErrDescriptorPackageKindInvalid  = errors.New("release descriptor runtime.package_kind must be nimi-app")
	ErrDescriptorMutableSource       = errors.New("release descriptor source is mutable or unpinned")
	ErrDescriptorClassSourceMismatch = errors.New("release descriptor class/source pairing is invalid")
	ErrDescriptorNotFound            = errors.New("release descriptor not found")
)
