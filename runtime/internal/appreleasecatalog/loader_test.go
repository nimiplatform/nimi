package appreleasecatalog

import (
	"errors"
	"strings"
	"testing"
)

const sampleReleaseDescriptorsYAML = `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_release_descriptors
descriptors:
  - descriptor_id: nimi.example-app.bundled-with-nimi
    app_id: nimi.example-app
    version: bundled-with-current-nimi-release
    descriptor_class: bundled-with-nimi
    source:
      kind: nimi-bundle
      ref: current-atomic-nimi-release
    artifact:
      locator: current-nimi-release-bundle
      digest_algorithm: sha256
      sha256: inherited-from-atomic-nimi-release-manifest
      size: inherited-from-atomic-nimi-release-manifest
      signature_or_provenance_ref: nimi-first-party-signature-policy
    runtime:
      package_kind: nimi-app
      entry_ref: example-app-runtime-registration
      sandbox_ref: first-party-bundled-app
    permissions_ref: nimi.example-app.permission_scope_ref
    storage_policy_ref: nimi-data-app-roots
    review:
      admission_path: first-party-bundled-release
      mutable_source_allowed: false
      install_digest_verification_required: inherited_from_atomic_bundle
    source_rule: P-NAPP-014
`

func TestLoadCatalog_ParsesValidDescriptor(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(sampleReleaseDescriptorsYAML))
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	if len(catalog.Descriptors) != 1 {
		t.Fatalf("len(Descriptors) = %d, want 1", len(catalog.Descriptors))
	}
	descriptor, err := catalog.FindByID("nimi.example-app.bundled-with-nimi")
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if descriptor.StoragePolicyRef != "nimi-data-app-roots" {
		t.Fatalf("storage policy = %q", descriptor.StoragePolicyRef)
	}
}

func TestLoadCatalog_RejectsMutableExternalSource(t *testing.T) {
	yaml := strings.Replace(sampleReleaseDescriptorsYAML, "descriptor_class: bundled-with-nimi", "descriptor_class: external-immutable-artifact", 1)
	yaml = strings.Replace(yaml, "kind: nimi-bundle", "kind: npm-package", 1)
	yaml = strings.Replace(yaml, "ref: current-atomic-nimi-release", "ref: latest", 1)
	_, err := LoadCatalog(strings.NewReader(yaml))
	if err == nil {
		t.Fatal("expected mutable external source to fail")
	}
	if !errors.Is(err, ErrDescriptorMutableSource) {
		t.Fatalf("error = %v, want ErrDescriptorMutableSource", err)
	}
}

func TestLoadCatalog_RejectsMutableExternalSourceRefs(t *testing.T) {
	cases := []string{
		"main",
		"refs/heads/main",
		"github.com/example/app/tree/main",
		"tag:v1.0.0",
		"refs/tags/v1.0.0",
		"github.com/example/app/releases/tag/v1.0.0",
		"github.com/example/app/releases/download/latest/app.tgz",
		"github.com/example/app/releases/download/main/app.tgz",
		"github.com/example/app/releases/download/next/app.tgz",
		"github.com/example/app/releases/download/stable/app.tgz",
		"github:org/repo#main",
		"git+https://github.com/org/repo#main",
		"pkg@latest",
		"pkg@next",
		"pkg@1.x",
		"^1.0.0",
		"~1.0.0",
		">=1.0.0",
	}
	for _, sourceRef := range cases {
		t.Run(sourceRef, func(t *testing.T) {
			yaml := strings.Replace(sampleReleaseDescriptorsYAML, "descriptor_class: bundled-with-nimi", "descriptor_class: external-immutable-artifact", 1)
			yaml = strings.Replace(yaml, "kind: nimi-bundle", "kind: github-release", 1)
			yaml = strings.Replace(yaml, "ref: current-atomic-nimi-release", "ref: \""+sourceRef+"\"", 1)
			_, err := LoadCatalog(strings.NewReader(yaml))
			if err == nil {
				t.Fatal("expected mutable external source to fail")
			}
			if !errors.Is(err, ErrDescriptorMutableSource) {
				t.Fatalf("error = %v, want ErrDescriptorMutableSource", err)
			}
		})
	}
}

func TestLoadCatalog_RejectsNonDescriptorInstallSourceKinds(t *testing.T) {
	cases := []string{"npx", "git-clone", "install-script"}
	for _, sourceKind := range cases {
		t.Run(sourceKind, func(t *testing.T) {
			yaml := strings.Replace(sampleReleaseDescriptorsYAML, "descriptor_class: bundled-with-nimi", "descriptor_class: external-immutable-artifact", 1)
			yaml = strings.Replace(yaml, "kind: nimi-bundle", "kind: "+sourceKind, 1)
			yaml = strings.Replace(yaml, "ref: current-atomic-nimi-release", "ref: github.com/example/app/releases/download/v1.0.0/app.tgz", 1)
			_, err := LoadCatalog(strings.NewReader(yaml))
			if err == nil {
				t.Fatal("expected non-descriptor install source kind to fail")
			}
			if !errors.Is(err, ErrDescriptorUnknownSourceKind) {
				t.Fatalf("error = %v, want ErrDescriptorUnknownSourceKind", err)
			}
		})
	}
}

func TestLoadCatalog_RejectsMutableNPMSourceRefs(t *testing.T) {
	cases := []string{"pkg", "pkg@beta", "pkg@canary", "pkg@1", "pkg@1.2", "pkg@1.x"}
	for _, sourceRef := range cases {
		t.Run(sourceRef, func(t *testing.T) {
			yaml := strings.Replace(sampleReleaseDescriptorsYAML, "descriptor_class: bundled-with-nimi", "descriptor_class: external-immutable-artifact", 1)
			yaml = strings.Replace(yaml, "kind: nimi-bundle", "kind: npm-package", 1)
			yaml = strings.Replace(yaml, "ref: current-atomic-nimi-release", "ref: \""+sourceRef+"\"", 1)
			_, err := LoadCatalog(strings.NewReader(yaml))
			if err == nil {
				t.Fatal("expected mutable npm source to fail")
			}
			if !errors.Is(err, ErrDescriptorMutableSource) {
				t.Fatalf("error = %v, want ErrDescriptorMutableSource", err)
			}
		})
	}
}

func TestLoadCatalog_AcceptsExactNPMSourceRef(t *testing.T) {
	yaml := strings.Replace(sampleReleaseDescriptorsYAML, "descriptor_class: bundled-with-nimi", "descriptor_class: external-immutable-artifact", 1)
	yaml = strings.Replace(yaml, "kind: nimi-bundle", "kind: npm-package", 1)
	yaml = strings.Replace(yaml, "ref: current-atomic-nimi-release", "ref: \"@scope/pkg@1.2.3\"", 1)
	if _, err := LoadCatalog(strings.NewReader(yaml)); err != nil {
		t.Fatalf("exact npm source ref should load: %v", err)
	}
}

func TestLoadCatalog_RejectsNonNimiAppPackageKind(t *testing.T) {
	yaml := strings.Replace(sampleReleaseDescriptorsYAML, "package_kind: nimi-app", "package_kind: external-app", 1)
	_, err := LoadCatalog(strings.NewReader(yaml))
	if err == nil {
		t.Fatal("expected invalid package kind")
	}
	if !errors.Is(err, ErrDescriptorPackageKindInvalid) {
		t.Fatalf("error = %v, want ErrDescriptorPackageKindInvalid", err)
	}
}

func TestLoadCatalog_RejectsMissingReviewAdmissionPath(t *testing.T) {
	yaml := strings.Replace(sampleReleaseDescriptorsYAML, "      admission_path: first-party-bundled-release\n", "", 1)
	_, err := LoadCatalog(strings.NewReader(yaml))
	if err == nil {
		t.Fatal("expected missing review admission path")
	}
	if !errors.Is(err, ErrDescriptorMissingFields) {
		t.Fatalf("error = %v, want ErrDescriptorMissingFields", err)
	}
}

func TestLoadCatalog_RejectsMissingMutableSourceAllowedReviewField(t *testing.T) {
	yaml := strings.Replace(sampleReleaseDescriptorsYAML, "      mutable_source_allowed: false\n", "", 1)
	_, err := LoadCatalog(strings.NewReader(yaml))
	if err == nil {
		t.Fatal("expected missing mutable_source_allowed review field")
	}
	if !errors.Is(err, ErrDescriptorMissingFields) {
		t.Fatalf("error = %v, want ErrDescriptorMissingFields", err)
	}
}

func TestLoadCatalog_RejectsBundledDescriptorWithExternalSource(t *testing.T) {
	yaml := strings.Replace(sampleReleaseDescriptorsYAML, "kind: nimi-bundle", "kind: npm-package", 1)
	_, err := LoadCatalog(strings.NewReader(yaml))
	if err == nil {
		t.Fatal("expected invalid descriptor class/source pairing")
	}
	if !errors.Is(err, ErrDescriptorClassSourceMismatch) {
		t.Fatalf("error = %v, want ErrDescriptorClassSourceMismatch", err)
	}
}
