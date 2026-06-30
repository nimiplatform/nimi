package appreleasecatalog

import (
	"fmt"
	"io"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type rawCatalog struct {
	Version     int             `yaml:"version"`
	TableFamily string          `yaml:"table_family"`
	Owner       string          `yaml:"owner"`
	CatalogID   string          `yaml:"catalog_id"`
	Descriptors []rawDescriptor `yaml:"descriptors"`
}

type rawDescriptor struct {
	DescriptorID             string                      `yaml:"descriptor_id"`
	AppID                    string                      `yaml:"app_id"`
	Version                  string                      `yaml:"version"`
	AdmissionTrack           string                      `yaml:"admission_track"`
	DescriptorClass          string                      `yaml:"descriptor_class"`
	Publisher                rawPublisher                `yaml:"publisher"`
	Source                   rawSource                   `yaml:"source"`
	Artifact                 rawArtifact                 `yaml:"artifact"`
	ArtifactMirrorRef        string                      `yaml:"artifact_mirror_ref"`
	MirrorLicenseCleared     *bool                       `yaml:"mirror_license_cleared"`
	BuildAssurance           string                      `yaml:"build_assurance"`
	DependencyAssurance      string                      `yaml:"dependency_assurance"`
	PlatformSigningAssurance rawPlatformSigningAssurance `yaml:"platform_signing_assurance"`
	Runtime                  rawRuntime                  `yaml:"runtime"`
	PermissionsRef           string                      `yaml:"permissions_ref"`
	StoragePolicyRef         yaml.Node                   `yaml:"storage_policy_ref"`
	OSStorageDisclosure      []rawOSStorageDisclosure    `yaml:"os_storage_disclosure"`
	UpdateChannelRef         string                      `yaml:"update_channel_ref"`
	RollbackEligibility      string                      `yaml:"rollback_eligibility"`
	Review                   rawReview                   `yaml:"review"`
	Support                  rawSupport                  `yaml:"support"`
	SourceRule               string                      `yaml:"source_rule"`
}

type rawPublisher struct {
	GitHubNamespace    string `yaml:"github_namespace"`
	NamespaceKind      string `yaml:"namespace_kind"`
	IdentityAssurance  string `yaml:"identity_assurance"`
	VerifiedDomain     string `yaml:"verified_domain"`
	KYCVerificationRef string `yaml:"kyc_verification_ref"`
}

type rawSource struct {
	Kind string `yaml:"kind"`
	Ref  string `yaml:"ref"`
}

type rawArtifact struct {
	Locator                  string    `yaml:"locator"`
	DigestAlgorithm          string    `yaml:"digest_algorithm"`
	SHA256                   string    `yaml:"sha256"`
	Size                     yaml.Node `yaml:"size"`
	SignatureOrProvenanceRef string    `yaml:"signature_or_provenance_ref"`
}

type rawRuntime struct {
	PackageKind string `yaml:"package_kind"`
	EntryRef    string `yaml:"entry_ref"`
	SandboxRef  string `yaml:"sandbox_ref"`
}

type rawReview struct {
	AdmissionPath                     string `yaml:"admission_path"`
	MutableSourceAllowed              *bool  `yaml:"mutable_source_allowed"`
	InstallDigestVerificationRequired string `yaml:"install_digest_verification_required"`
	Decision                          string `yaml:"decision"`
	AdjudicatorKind                   string `yaml:"adjudicator_kind"`
	AdjudicatorRef                    string `yaml:"adjudicator_ref"`
	DecidedAt                         string `yaml:"decided_at"`
}

type rawPlatformSigningAssurance struct {
	MacOSNotarization       string `yaml:"macos_notarization"`
	MacOSDeveloperIDSubject string `yaml:"macos_developer_id_subject"`
	WindowsCodeSigning      string `yaml:"windows_code_signing"`
	InstallerSignature      string `yaml:"installer_signature"`
	EntitlementsRef         string `yaml:"entitlements_ref"`
	SigningSubject          string `yaml:"signing_subject"`
}

type rawSupport struct {
	DiagnosticsBundleFields    []string `yaml:"diagnostics_bundle_fields"`
	RedactionRules             []string `yaml:"redaction_rules"`
	UserVisibleIssueCategories []string `yaml:"user_visible_issue_categories"`
	EscalationPath             string   `yaml:"escalation_path"`
	KillSwitchVisibility       string   `yaml:"kill_switch_visibility"`
	RecoveryInstructions       []string `yaml:"recovery_instructions"`
}

type rawOSStorageDisclosure struct {
	PathPattern      string `yaml:"path_pattern"`
	Purpose          string `yaml:"purpose"`
	ExpectedSizeBand string `yaml:"expected_size_band"`
}

func LoadCatalog(reader io.Reader) (*Catalog, error) {
	if reader == nil {
		return nil, fmt.Errorf("appreleasecatalog LoadCatalog: %w", ErrDescriptorParse)
	}
	bytes, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("appreleasecatalog LoadCatalog read: %w", err)
	}
	var raw rawCatalog
	if err := yaml.Unmarshal(bytes, &raw); err != nil {
		return nil, fmt.Errorf("appreleasecatalog LoadCatalog unmarshal: %w: %w", ErrDescriptorParse, err)
	}
	catalog := &Catalog{
		Version:     raw.Version,
		TableFamily: raw.TableFamily,
		Owner:       raw.Owner,
		CatalogID:   raw.CatalogID,
		Descriptors: make([]Descriptor, 0, len(raw.Descriptors)),
	}
	for index, rawDescriptor := range raw.Descriptors {
		descriptor, err := convertDescriptor(rawDescriptor)
		if err != nil {
			return nil, fmt.Errorf("appreleasecatalog LoadCatalog descriptors[%d] (%q): %w", index, rawDescriptor.DescriptorID, err)
		}
		catalog.Descriptors = append(catalog.Descriptors, descriptor)
	}
	return catalog, nil
}

func LoadCatalogFromFile(path string) (*Catalog, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("appreleasecatalog LoadCatalogFromFile: empty path: %w", ErrDescriptorParse)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("appreleasecatalog LoadCatalogFromFile open: %w", err)
	}
	catalog, loadErr := LoadCatalog(file)
	if closeErr := file.Close(); closeErr != nil && loadErr == nil {
		return nil, fmt.Errorf("appreleasecatalog LoadCatalogFromFile close: %w", closeErr)
	}
	return catalog, loadErr
}

func convertDescriptor(raw rawDescriptor) (Descriptor, error) {
	if raw.Review.MutableSourceAllowed == nil {
		return Descriptor{}, ErrDescriptorMissingFields
	}
	size, sizeBreakdown := convertArtifactSize(raw.Artifact.Size)
	storagePolicyRef, storagePolicyKind := convertStoragePolicyRef(raw.StoragePolicyRef)
	mirrorLicenseCleared := false
	if raw.MirrorLicenseCleared != nil {
		mirrorLicenseCleared = *raw.MirrorLicenseCleared
	}
	descriptor := Descriptor{
		DescriptorID:    strings.TrimSpace(raw.DescriptorID),
		AppID:           strings.TrimSpace(raw.AppID),
		Version:         strings.TrimSpace(raw.Version),
		AdmissionTrack:  AdmissionTrack(strings.TrimSpace(raw.AdmissionTrack)),
		DescriptorClass: DescriptorClass(strings.TrimSpace(raw.DescriptorClass)),
		Publisher: Publisher{
			GitHubNamespace:    strings.TrimSpace(raw.Publisher.GitHubNamespace),
			NamespaceKind:      strings.TrimSpace(raw.Publisher.NamespaceKind),
			IdentityAssurance:  strings.TrimSpace(raw.Publisher.IdentityAssurance),
			VerifiedDomain:     strings.TrimSpace(raw.Publisher.VerifiedDomain),
			KYCVerificationRef: strings.TrimSpace(raw.Publisher.KYCVerificationRef),
		},
		Source: Source{
			Kind: SourceKind(strings.TrimSpace(raw.Source.Kind)),
			Ref:  strings.TrimSpace(raw.Source.Ref),
		},
		Artifact: Artifact{
			Locator:                  strings.TrimSpace(raw.Artifact.Locator),
			DigestAlgorithm:          strings.TrimSpace(raw.Artifact.DigestAlgorithm),
			SHA256:                   strings.TrimSpace(raw.Artifact.SHA256),
			Size:                     size,
			SizeBreakdown:            sizeBreakdown,
			SignatureOrProvenanceRef: strings.TrimSpace(raw.Artifact.SignatureOrProvenanceRef),
		},
		ArtifactMirrorRef:    strings.TrimSpace(raw.ArtifactMirrorRef),
		MirrorLicenseCleared: mirrorLicenseCleared,
		BuildAssurance:       strings.TrimSpace(raw.BuildAssurance),
		DependencyAssurance:  strings.TrimSpace(raw.DependencyAssurance),
		PlatformSigningAssurance: PlatformSigningAssurance{
			MacOSNotarization:       strings.TrimSpace(raw.PlatformSigningAssurance.MacOSNotarization),
			MacOSDeveloperIDSubject: strings.TrimSpace(raw.PlatformSigningAssurance.MacOSDeveloperIDSubject),
			WindowsCodeSigning:      strings.TrimSpace(raw.PlatformSigningAssurance.WindowsCodeSigning),
			InstallerSignature:      strings.TrimSpace(raw.PlatformSigningAssurance.InstallerSignature),
			EntitlementsRef:         strings.TrimSpace(raw.PlatformSigningAssurance.EntitlementsRef),
			SigningSubject:          strings.TrimSpace(raw.PlatformSigningAssurance.SigningSubject),
		},
		Runtime: Runtime{
			PackageKind: strings.TrimSpace(raw.Runtime.PackageKind),
			EntryRef:    strings.TrimSpace(raw.Runtime.EntryRef),
			SandboxRef:  strings.TrimSpace(raw.Runtime.SandboxRef),
		},
		PermissionsRef:      strings.TrimSpace(raw.PermissionsRef),
		StoragePolicyRef:    storagePolicyRef,
		StoragePolicyKind:   storagePolicyKind,
		OSStorageDisclosure: convertOSStorageDisclosure(raw.OSStorageDisclosure),
		UpdateChannelRef:    strings.TrimSpace(raw.UpdateChannelRef),
		RollbackEligibility: strings.TrimSpace(raw.RollbackEligibility),
		Review: Review{
			AdmissionPath:                     strings.TrimSpace(raw.Review.AdmissionPath),
			MutableSourceAllowed:              *raw.Review.MutableSourceAllowed,
			InstallDigestVerificationRequired: strings.TrimSpace(raw.Review.InstallDigestVerificationRequired),
			Decision:                          strings.TrimSpace(raw.Review.Decision),
			AdjudicatorKind:                   strings.TrimSpace(raw.Review.AdjudicatorKind),
			AdjudicatorRef:                    strings.TrimSpace(raw.Review.AdjudicatorRef),
			DecidedAt:                         strings.TrimSpace(raw.Review.DecidedAt),
		},
		Support: Support{
			DiagnosticsBundleFields:    trimStringSlice(raw.Support.DiagnosticsBundleFields),
			RedactionRules:             trimStringSlice(raw.Support.RedactionRules),
			UserVisibleIssueCategories: trimStringSlice(raw.Support.UserVisibleIssueCategories),
			EscalationPath:             strings.TrimSpace(raw.Support.EscalationPath),
			KillSwitchVisibility:       strings.TrimSpace(raw.Support.KillSwitchVisibility),
			RecoveryInstructions:       trimStringSlice(raw.Support.RecoveryInstructions),
		},
		SourceRule: strings.TrimSpace(raw.SourceRule),
	}
	return descriptor, ValidateDescriptor(descriptor)
}

func convertStoragePolicyRef(node yaml.Node) (string, string) {
	switch node.Kind {
	case yaml.ScalarNode:
		return strings.TrimSpace(node.Value), ""
	case yaml.MappingNode:
		var id string
		var kind string
		for index := 0; index+1 < len(node.Content); index += 2 {
			key := strings.TrimSpace(node.Content[index].Value)
			value := node.Content[index+1]
			switch key {
			case "id":
				if value.Kind == yaml.ScalarNode {
					id = strings.TrimSpace(value.Value)
				}
			case "kind":
				if value.Kind == yaml.ScalarNode {
					kind = strings.TrimSpace(value.Value)
				}
			}
		}
		return id, kind
	default:
		return "", ""
	}
}

func convertOSStorageDisclosure(rows []rawOSStorageDisclosure) []OSStorageDisclosure {
	disclosure := make([]OSStorageDisclosure, 0, len(rows))
	for _, row := range rows {
		disclosure = append(disclosure, OSStorageDisclosure{
			PathPattern:      strings.TrimSpace(row.PathPattern),
			Purpose:          strings.TrimSpace(row.Purpose),
			ExpectedSizeBand: strings.TrimSpace(row.ExpectedSizeBand),
		})
	}
	return disclosure
}

func convertArtifactSize(node yaml.Node) (string, ArtifactSize) {
	if node.Kind == yaml.ScalarNode {
		return strings.TrimSpace(node.Value), ArtifactSize{}
	}
	if node.Kind != yaml.MappingNode {
		return "", ArtifactSize{}
	}
	values := map[string]string{}
	for index := 0; index+1 < len(node.Content); index += 2 {
		key := strings.TrimSpace(node.Content[index].Value)
		values[key] = strings.TrimSpace(node.Content[index+1].Value)
	}
	return "typed-artifact-size-breakdown", ArtifactSize{
		Download:   values["download"],
		Installed:  values["installed"],
		UserData:   values["user_data"],
		Cache:      values["cache"],
		SharedDeps: values["shared_deps"],
	}
}

func trimStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func (c *Catalog) FindByID(id string) (*Descriptor, error) {
	if c == nil {
		return nil, fmt.Errorf("appreleasecatalog FindByID: %w", ErrDescriptorNotFound)
	}
	for index := range c.Descriptors {
		if c.Descriptors[index].DescriptorID == id {
			return &c.Descriptors[index], nil
		}
	}
	return nil, fmt.Errorf("appreleasecatalog FindByID (%q): %w", id, ErrDescriptorNotFound)
}
