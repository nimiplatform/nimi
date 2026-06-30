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

const sampleSandboxExternalDescriptorYAML = `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_release_descriptors
descriptors:
  - descriptor_id: community.nimi.fixture.platform-proof.0.1.0-sandbox
    app_id: community.nimi.fixture.platform-proof
    version: 0.1.0-sandbox
    admission_track: admission-sandbox-ci
    descriptor_class: external-immutable-artifact
    publisher:
      github_namespace: github.com/nimiplatform-fixtures
      namespace_kind: org
      identity_assurance: domain-verified
      verified_domain: fixtures.nimi.test
      kyc_verification_ref: ci-kyc-deferred
    source:
      kind: admission-sandbox-https-artifact
      ref: https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/app.tgz
    artifact:
      locator: https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/app.tgz
      digest_algorithm: sha256
      sha256: 6f1ed002ab5595859014ebf0951522d9b604294d9ad9e4d12d85bc8f0d0bb8a1
      size:
        download: "1024"
        installed: "4096"
        user_data: "2048"
        cache: "512"
        shared_deps: "0"
      signature_or_provenance_ref: ci-provenance/platform-proof/0.1.0-sandbox
    artifact_mirror_ref: nimi-ci-mirror://platform-proof/0.1.0-sandbox
    mirror_license_cleared: true
    build_assurance: reproducible-build
    dependency_assurance: lockfile-and-scanner-evidence
    platform_signing_assurance:
      macos_notarization: not-required-internal
      macos_developer_id_subject: not-required-internal
      windows_code_signing: not-required-internal
      installer_signature: not-required-internal
      entitlements_ref: ci-entitlements/platform-proof
      signing_subject: nimi
    runtime:
      package_kind: nimi-app
      entry_ref: dist/index.html
      sandbox_ref: installed-nimi-app-standard-shell-v1
    permissions_ref: community.nimi.fixture.platform-proof.permission_scope_ref
    storage_policy_ref:
      id: nimi-data-app-roots
      kind: nimi-mediated-default
    update_channel_ref: platform-proof-sandbox-channel
    rollback_eligibility: previous-admitted-descriptor
    review:
      admission_path: admission-sandbox-ci
      mutable_source_allowed: false
      install_digest_verification_required: required
      decision: approved
      adjudicator_kind: platform-review-bot
      adjudicator_ref: ci/platform-proof
      decided_at: "2026-06-30T00:00:00Z"
    support:
      diagnostics_bundle_fields:
        - runtime
        - storage
      redaction_rules:
        - strip-account-token
      user_visible_issue_categories:
        - launch-failed
      escalation_path: ci-fixture-support
      kill_switch_visibility: developer-only
      recovery_instructions:
        - reinstall
    source_rule: P-NAPP-033
`

func sampleOrdinaryExternalDescriptorYAML() string {
	yaml := strings.Replace(sampleSandboxExternalDescriptorYAML, "admission_track: admission-sandbox-ci", "admission_track: ordinary-release-proof", 1)
	yaml = strings.Replace(yaml, "kind: admission-sandbox-https-artifact", "kind: github-release", 1)
	yaml = strings.Replace(yaml, "ref: https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/app.tgz", "ref: github.com/nimiplatform-fixtures/platform-proof/releases/download/v0.1.0/app.tgz", 1)
	yaml = strings.Replace(yaml, "locator: https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/app.tgz", "locator: https://github.com/nimiplatform-fixtures/platform-proof/releases/download/v0.1.0/app.tgz", 1)
	yaml = strings.Replace(yaml, "macos_notarization: not-required-internal", "macos_notarization: notarized", 1)
	yaml = strings.Replace(yaml, "macos_developer_id_subject: not-required-internal", "macos_developer_id_subject: \"Developer ID Application: Nimi Fixture\"", 1)
	yaml = strings.Replace(yaml, "windows_code_signing: not-required-internal", "windows_code_signing: signed", 1)
	yaml = strings.Replace(yaml, "installer_signature: not-required-internal", "installer_signature: signed", 1)
	yaml = strings.Replace(yaml, "signing_subject: nimi", "signing_subject: publisher", 1)
	yaml = strings.Replace(yaml, "admission_path: admission-sandbox-ci", "admission_path: ordinary-release-proof", 1)
	return yaml
}

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

func TestLoadCatalog_AcceptsSandboxExternalDescriptor(t *testing.T) {
	catalog, err := LoadCatalog(strings.NewReader(sampleSandboxExternalDescriptorYAML))
	if err != nil {
		t.Fatalf("LoadCatalog sandbox descriptor: %v", err)
	}
	descriptor, err := catalog.FindByID("community.nimi.fixture.platform-proof.0.1.0-sandbox")
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if descriptor.AdmissionTrack != AdmissionTrackSandboxCI {
		t.Fatalf("admission track = %q, want %q", descriptor.AdmissionTrack, AdmissionTrackSandboxCI)
	}
	if descriptor.Source.Kind != SourceKindAdmissionSandboxHTTPSArtifact {
		t.Fatalf("source kind = %q, want %q", descriptor.Source.Kind, SourceKindAdmissionSandboxHTTPSArtifact)
	}
	if descriptor.StoragePolicyRef != "nimi-data-app-roots" {
		t.Fatalf("storage policy ref = %q, want nimi-data-app-roots", descriptor.StoragePolicyRef)
	}
}

func TestLoadCatalog_RejectsExternalDescriptorWithoutAdmissionTrack(t *testing.T) {
	yaml := strings.Replace(sampleSandboxExternalDescriptorYAML, "    admission_track: admission-sandbox-ci\n", "", 1)
	_, err := LoadCatalog(strings.NewReader(yaml))
	if err == nil {
		t.Fatal("expected missing admission_track to fail")
	}
	if !errors.Is(err, ErrDescriptorMissingFields) {
		t.Fatalf("error = %v, want ErrDescriptorMissingFields", err)
	}
}

func TestLoadCatalog_RejectsOrdinaryDescriptorWithSandboxSourceKind(t *testing.T) {
	yaml := strings.Replace(sampleSandboxExternalDescriptorYAML, "admission_track: admission-sandbox-ci", "admission_track: ordinary-release-proof", 1)
	_, err := LoadCatalog(strings.NewReader(yaml))
	if err == nil {
		t.Fatal("expected ordinary descriptor with sandbox source kind to fail")
	}
	if !strings.Contains(err.Error(), "admission track/source pairing") {
		t.Fatalf("error = %v, want admission track/source pairing failure", err)
	}
}

func TestLoadCatalog_RejectsSandboxDescriptorWithOrdinarySourceKind(t *testing.T) {
	yaml := strings.Replace(sampleSandboxExternalDescriptorYAML, "kind: admission-sandbox-https-artifact", "kind: github-release", 1)
	yaml = strings.Replace(yaml, "ref: https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/app.tgz", "ref: github.com/nimiplatform-fixtures/platform-proof/releases/download/v0.1.0/app.tgz", 1)
	_, err := LoadCatalog(strings.NewReader(yaml))
	if err == nil {
		t.Fatal("expected sandbox descriptor with ordinary source kind to fail")
	}
	if !strings.Contains(err.Error(), "admission track/source pairing") {
		t.Fatalf("error = %v, want admission track/source pairing failure", err)
	}
}

func TestLoadCatalog_RejectsOrdinaryDescriptorWithInternalSigning(t *testing.T) {
	yaml := strings.Replace(sampleSandboxExternalDescriptorYAML, "admission_track: admission-sandbox-ci", "admission_track: ordinary-release-proof", 1)
	yaml = strings.Replace(yaml, "kind: admission-sandbox-https-artifact", "kind: github-release", 1)
	yaml = strings.Replace(yaml, "ref: https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/app.tgz", "ref: github.com/nimiplatform-fixtures/platform-proof/releases/download/v0.1.0/app.tgz", 1)
	_, err := LoadCatalog(strings.NewReader(yaml))
	if err == nil {
		t.Fatal("expected ordinary descriptor with internal signing to fail")
	}
	if !strings.Contains(err.Error(), "platform signing") {
		t.Fatalf("error = %v, want platform signing failure", err)
	}
}

func TestLoadCatalog_RejectsExternalDescriptorFloorViolations(t *testing.T) {
	cases := []struct {
		name      string
		mutate    func(string) string
		wantError error
		contains  string
	}{
		{
			name: "missing publisher namespace",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "      github_namespace: github.com/nimiplatform-fixtures\n", "", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "invalid publisher namespace kind",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "namespace_kind: org", "namespace_kind: team", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "domain verified without domain",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "      verified_domain: fixtures.nimi.test\n", "", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "identity verified without kyc",
			mutate: func(yaml string) string {
				yaml = strings.Replace(yaml, "identity_assurance: domain-verified", "identity_assurance: identity-verified", 1)
				return strings.Replace(yaml, "      kyc_verification_ref: ci-kyc-deferred\n", "", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "missing artifact signature provenance",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "      signature_or_provenance_ref: ci-provenance/platform-proof/0.1.0-sandbox\n", "", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "missing artifact mirror",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "    artifact_mirror_ref: nimi-ci-mirror://platform-proof/0.1.0-sandbox\n", "", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "mirror license false",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "mirror_license_cleared: true", "mirror_license_cleared: false", 1)
			},
			wantError: ErrDescriptorMirrorLicenseUnclear,
		},
		{
			name: "collapsed artifact size",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "      size:\n        download: \"1024\"\n        installed: \"4096\"\n        user_data: \"2048\"\n        cache: \"512\"\n        shared_deps: \"0\"", "      size: \"7168\"", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "checksum pinned build assurance",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "build_assurance: reproducible-build", "build_assurance: checksum-pinned", 1)
			},
			wantError: ErrDescriptorBuildAssuranceInvalid,
		},
		{
			name: "missing dependency assurance",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "    dependency_assurance: lockfile-and-scanner-evidence\n", "", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "missing review decision",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "      decision: approved\n", "", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "missing support diagnostics fields",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "      diagnostics_bundle_fields:\n        - runtime\n        - storage\n", "", 1)
			},
			wantError: ErrDescriptorMissingFields,
		},
		{
			name: "non https artifact locator",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "locator: https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/app.tgz", "locator: file:///tmp/app.tgz", 1)
			},
			wantError: ErrDescriptorMutableSource,
		},
		{
			name: "collapsed version",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "version: 0.1.0-sandbox", "version: latest", 1)
			},
			contains: "version",
		},
		{
			name: "collapsed review date",
			mutate: func(yaml string) string {
				return strings.Replace(yaml, "decided_at: \"2026-06-30T00:00:00Z\"", "decided_at: \"today\"", 1)
			},
			contains: "decided_at",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := LoadCatalog(strings.NewReader(tc.mutate(sampleSandboxExternalDescriptorYAML)))
			if err == nil {
				t.Fatal("expected descriptor floor violation")
			}
			if tc.wantError != nil && !errors.Is(err, tc.wantError) {
				t.Fatalf("error = %v, want %v", err, tc.wantError)
			}
			if tc.contains != "" && !strings.Contains(err.Error(), tc.contains) {
				t.Fatalf("error = %v, want substring %q", err, tc.contains)
			}
		})
	}
}

func TestLoadCatalog_RejectsMutableExternalSource(t *testing.T) {
	yaml := sampleOrdinaryExternalDescriptorYAML()
	yaml = strings.Replace(yaml, "kind: github-release", "kind: npm-package", 1)
	yaml = strings.Replace(yaml, "ref: github.com/nimiplatform-fixtures/platform-proof/releases/download/v0.1.0/app.tgz", "ref: latest", 1)
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
			yaml := sampleOrdinaryExternalDescriptorYAML()
			yaml = strings.Replace(yaml, "ref: github.com/nimiplatform-fixtures/platform-proof/releases/download/v0.1.0/app.tgz", "ref: \""+sourceRef+"\"", 1)
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
			yaml := sampleOrdinaryExternalDescriptorYAML()
			yaml = strings.Replace(yaml, "kind: github-release", "kind: npm-package", 1)
			yaml = strings.Replace(yaml, "ref: github.com/nimiplatform-fixtures/platform-proof/releases/download/v0.1.0/app.tgz", "ref: \""+sourceRef+"\"", 1)
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
	yaml := sampleOrdinaryExternalDescriptorYAML()
	yaml = strings.Replace(yaml, "kind: github-release", "kind: npm-package", 1)
	yaml = strings.Replace(yaml, "ref: github.com/nimiplatform-fixtures/platform-proof/releases/download/v0.1.0/app.tgz", "ref: \"@scope/pkg@1.2.3\"", 1)
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
