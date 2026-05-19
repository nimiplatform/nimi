package appregistrycatalog

import (
	"errors"
	"strings"
	"testing"
)

const sampleRegistryYAML = `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_registry
apps:
  - app_id: nimi.avatar
    display_label: Avatar
    publisher: nimi-first-party
    trust_tier_ref: nimi-first-party
    package_kind: nimi-app
    package_signature_policy_ref: nimi-first-party-signature-policy
    update_channel_ref: stable
    ai_profile_selection_ref: local-gpu
    capability_set_refs: [text.generate]
    local_compute_pack_refs: [local-gpu-support]
    runtime_registration_mode: app-managed
    permission_scope_ref: []
    health_repair_projection: unavailable
    ordinary_visibility: hidden-internal
    release_descriptor_ref: nimi.avatar.bundled-with-nimi
    install_storage_policy_ref: nimi-data-app-roots
    admission_status: gated_by_avatar_master_gate
    source_rule: P-NAPP-004

  - app_id: nimi.parentos
    display_label: ParentOS
    publisher: nimi-first-party
    trust_tier_ref: nimi-first-party
    package_kind: nimi-app
    package_signature_policy_ref: nimi-first-party-signature-policy
    update_channel_ref: stable
    ai_profile_selection_ref: cloud-first
    capability_set_refs: [text.generate]
    local_compute_pack_refs: []
    runtime_registration_mode: app-managed
    permission_scope_ref: []
    health_repair_projection: unavailable
    ordinary_visibility: ordinary-visible
    release_descriptor_ref: nimi.parentos.bundled-with-nimi
    install_storage_policy_ref: nimi-data-app-roots
    admission_status: admitted
    source_rule: P-NAPP-004
`

func TestLoadRegistry_ParsesValidYAML(t *testing.T) {
	r, err := LoadRegistry(strings.NewReader(sampleRegistryYAML))
	if err != nil {
		t.Fatalf("LoadRegistry returned error: %v", err)
	}
	if len(r.Apps) != 2 {
		t.Errorf("len(Apps) = %d, want 2", len(r.Apps))
	}
}

func TestLoadRegistry_FailsOnMissingFields(t *testing.T) {
	bad := strings.Replace(sampleRegistryYAML, "table_family: product_catalog\n", "", 1)
	_, err := LoadRegistry(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadRegistry accepted missing table_family")
	}
	if !errors.Is(err, ErrRegistryMissingFields) {
		t.Errorf("error = %v, want wrapped ErrRegistryMissingFields", err)
	}
}

func TestLoadRegistry_RejectsNonNimiAppPackageKind(t *testing.T) {
	bad := strings.Replace(sampleRegistryYAML, "package_kind: nimi-app", "package_kind: public-mod", 1)
	_, err := LoadRegistry(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadRegistry accepted package_kind=public-mod")
	}
	if !errors.Is(err, ErrAppUnknownPackageKind) {
		t.Errorf("error = %v, want wrapped ErrAppUnknownPackageKind", err)
	}
}

func TestLoadRegistry_RejectsNonCanonicalTrustTier(t *testing.T) {
	bad := strings.Replace(sampleRegistryYAML, "trust_tier_ref: nimi-first-party", "trust_tier_ref: nimi-trusted", 1)
	_, err := LoadRegistry(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadRegistry accepted non-canonical trust tier")
	}
	if !errors.Is(err, ErrAppUnknownTrustTier) {
		t.Errorf("error = %v, want wrapped ErrAppUnknownTrustTier", err)
	}
}

func TestLoadRegistry_RejectsNonCanonicalAdmissionStatus(t *testing.T) {
	bad := strings.Replace(sampleRegistryYAML, "admission_status: admitted", "admission_status: best-effort", 1)
	_, err := LoadRegistry(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadRegistry accepted non-canonical admission status")
	}
	if !errors.Is(err, ErrAppUnknownAdmissionStatus) {
		t.Errorf("error = %v, want wrapped ErrAppUnknownAdmissionStatus", err)
	}
}

func TestLoadRegistry_RejectsMissingRequiredField(t *testing.T) {
	bad := strings.Replace(sampleRegistryYAML, "  - app_id: nimi.avatar\n", "  - app_id: \n", 1)
	_, err := LoadRegistry(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadRegistry accepted missing app_id")
	}
	if !errors.Is(err, ErrAppMissingRequiredField) {
		t.Errorf("error = %v, want wrapped ErrAppMissingRequiredField", err)
	}
}

func TestFindByID_ReturnsExisting(t *testing.T) {
	r, _ := LoadRegistry(strings.NewReader(sampleRegistryYAML))
	app, err := r.FindByID("nimi.parentos")
	if err != nil {
		t.Fatalf("FindByID returned error: %v", err)
	}
	if app.DisplayLabel != "ParentOS" {
		t.Errorf("DisplayLabel = %q, want ParentOS", app.DisplayLabel)
	}
}

func TestFindByID_NotFound(t *testing.T) {
	r, _ := LoadRegistry(strings.NewReader(sampleRegistryYAML))
	_, err := r.FindByID("nimi.nonexistent")
	if err == nil {
		t.Fatal("FindByID returned nil error for unknown app")
	}
	if !errors.Is(err, ErrAppNotFound) {
		t.Errorf("error = %v, want wrapped ErrAppNotFound", err)
	}
}

func TestLoadRegistry_RejectsNonCanonicalOrdinaryVisibility(t *testing.T) {
	bad := strings.Replace(sampleRegistryYAML, "ordinary_visibility: ordinary-visible", "ordinary_visibility: public", 1)
	_, err := LoadRegistry(strings.NewReader(bad))
	if err == nil {
		t.Fatal("LoadRegistry accepted non-canonical ordinary visibility")
	}
	if !errors.Is(err, ErrAppUnknownOrdinaryVisibility) {
		t.Errorf("error = %v, want wrapped ErrAppUnknownOrdinaryVisibility", err)
	}
}

func TestPackageKind_RejectsNonNimiApp(t *testing.T) {
	if PackageKind("public-mod").Valid() {
		t.Error("public-mod must not be valid PackageKind")
	}
	if PackageKind("extension").Valid() {
		t.Error("extension must not be valid PackageKind")
	}
	if !PackageKindNimiApp.Valid() {
		t.Error("nimi-app must be valid")
	}
}
