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
	DescriptorID     string      `yaml:"descriptor_id"`
	AppID            string      `yaml:"app_id"`
	Version          string      `yaml:"version"`
	DescriptorClass  string      `yaml:"descriptor_class"`
	Source           rawSource   `yaml:"source"`
	Artifact         rawArtifact `yaml:"artifact"`
	Runtime          rawRuntime  `yaml:"runtime"`
	PermissionsRef   string      `yaml:"permissions_ref"`
	StoragePolicyRef string      `yaml:"storage_policy_ref"`
	Review           rawReview   `yaml:"review"`
	SourceRule       string      `yaml:"source_rule"`
}

type rawSource struct {
	Kind string `yaml:"kind"`
	Ref  string `yaml:"ref"`
}

type rawArtifact struct {
	Locator                  string `yaml:"locator"`
	DigestAlgorithm          string `yaml:"digest_algorithm"`
	SHA256                   string `yaml:"sha256"`
	Size                     string `yaml:"size"`
	SignatureOrProvenanceRef string `yaml:"signature_or_provenance_ref"`
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
	defer file.Close()
	return LoadCatalog(file)
}

func convertDescriptor(raw rawDescriptor) (Descriptor, error) {
	if raw.Review.MutableSourceAllowed == nil {
		return Descriptor{}, ErrDescriptorMissingFields
	}
	descriptor := Descriptor{
		DescriptorID:    strings.TrimSpace(raw.DescriptorID),
		AppID:           strings.TrimSpace(raw.AppID),
		Version:         strings.TrimSpace(raw.Version),
		DescriptorClass: DescriptorClass(strings.TrimSpace(raw.DescriptorClass)),
		Source: Source{
			Kind: SourceKind(strings.TrimSpace(raw.Source.Kind)),
			Ref:  strings.TrimSpace(raw.Source.Ref),
		},
		Artifact: Artifact{
			Locator:                  strings.TrimSpace(raw.Artifact.Locator),
			DigestAlgorithm:          strings.TrimSpace(raw.Artifact.DigestAlgorithm),
			SHA256:                   strings.TrimSpace(raw.Artifact.SHA256),
			Size:                     strings.TrimSpace(raw.Artifact.Size),
			SignatureOrProvenanceRef: strings.TrimSpace(raw.Artifact.SignatureOrProvenanceRef),
		},
		Runtime: Runtime{
			PackageKind: strings.TrimSpace(raw.Runtime.PackageKind),
			EntryRef:    strings.TrimSpace(raw.Runtime.EntryRef),
			SandboxRef:  strings.TrimSpace(raw.Runtime.SandboxRef),
		},
		PermissionsRef:   strings.TrimSpace(raw.PermissionsRef),
		StoragePolicyRef: strings.TrimSpace(raw.StoragePolicyRef),
		Review: Review{
			AdmissionPath:                     strings.TrimSpace(raw.Review.AdmissionPath),
			MutableSourceAllowed:              *raw.Review.MutableSourceAllowed,
			InstallDigestVerificationRequired: strings.TrimSpace(raw.Review.InstallDigestVerificationRequired),
		},
		SourceRule: strings.TrimSpace(raw.SourceRule),
	}
	return descriptor, ValidateDescriptor(descriptor)
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
