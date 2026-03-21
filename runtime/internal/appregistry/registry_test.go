package appregistry

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestRegistryUpsertAndGetRoundTrip(t *testing.T) {
	registry := New()
	manifest := &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_RENDER,
	}
	if err := registry.Upsert("nimi.desktop", manifest, []string{"runtime.ai.generate"}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	record, ok := registry.Get("nimi.desktop")
	if !ok {
		t.Fatalf("expected registry hit")
	}
	if record.AppID != "nimi.desktop" {
		t.Fatalf("unexpected app id: %q", record.AppID)
	}
	if record.Manifest == nil || record.Manifest.GetAppMode() != runtimev1.AppMode_APP_MODE_FULL {
		t.Fatalf("unexpected manifest: %#v", record.Manifest)
	}
	if len(record.Capabilities) != 1 || record.Capabilities[0] != "runtime.ai.generate" {
		t.Fatalf("unexpected capabilities: %#v", record.Capabilities)
	}

	record.Manifest.AppMode = runtimev1.AppMode_APP_MODE_LITE
	record.Capabilities[0] = "realm.chat.read"

	stored, ok := registry.Get("nimi.desktop")
	if !ok {
		t.Fatalf("expected registry hit after defensive copy mutation")
	}
	if stored.Manifest.GetAppMode() != runtimev1.AppMode_APP_MODE_FULL {
		t.Fatalf("registry manifest should not be mutated through caller copy")
	}
	if stored.Capabilities[0] != "runtime.ai.generate" {
		t.Fatalf("registry capabilities should not be mutated through caller copy")
	}
}

func TestRegistryUpsertRejectsEmptyAppID(t *testing.T) {
	registry := New()
	if err := registry.Upsert("   ", nil, nil); err == nil {
		t.Fatalf("expected empty app id error")
	}
	if _, ok := registry.Get("   "); ok {
		t.Fatalf("empty app id should not be retrievable")
	}
}

func TestValidateManifestRejectsLiteExtensionWorldRelation(t *testing.T) {
	reasonCode, actionHint, ok := ValidateManifest(&runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_LITE,
		RuntimeRequired: false,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_EXTENSION,
	})
	if ok {
		t.Fatalf("expected lite+extension manifest rejected")
	}
	if reasonCode != runtimev1.ReasonCode_APP_MODE_WORLD_RELATION_FORBIDDEN {
		t.Fatalf("unexpected reason code: %v", reasonCode)
	}
	if actionHint != "set_world_relation_render_or_none_or_switch_mode" {
		t.Fatalf("unexpected action hint: %s", actionHint)
	}
}

func TestValidateDomainAndScopesRejectsModeViolationsWithActionHint(t *testing.T) {
	lite := &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_LITE,
		RuntimeRequired: false,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}
	reasonCode, actionHint, ok := ValidateDomainAndScopes(lite, "runtime.ai", []string{"runtime.ai.generate"})
	if ok {
		t.Fatalf("expected lite runtime domain rejected")
	}
	if reasonCode != runtimev1.ReasonCode_APP_MODE_DOMAIN_FORBIDDEN {
		t.Fatalf("unexpected reason code: %v", reasonCode)
	}
	if actionHint != "remove_runtime_scopes_or_switch_mode_full" {
		t.Fatalf("unexpected action hint: %s", actionHint)
	}
	reasonCode, actionHint, ok = ValidateDomainAndScopes(lite, "realm.social", []string{"runtime.ai.generate"})
	if ok {
		t.Fatalf("expected lite runtime scope rejected")
	}
	if reasonCode != runtimev1.ReasonCode_APP_MODE_SCOPE_FORBIDDEN {
		t.Fatalf("unexpected reason code: %v", reasonCode)
	}
	if actionHint != "adjust_scopes_for_app_mode" {
		t.Fatalf("unexpected action hint: %s", actionHint)
	}

	coreOnly := &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_CORE_ONLY,
		RuntimeRequired: true,
		RealmRequired:   false,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}
	reasonCode, actionHint, ok = ValidateDomainAndScopes(coreOnly, "realm.social", []string{"realm.chat.read"})
	if ok {
		t.Fatalf("expected core-only realm domain rejected")
	}
	if reasonCode != runtimev1.ReasonCode_APP_MODE_DOMAIN_FORBIDDEN {
		t.Fatalf("unexpected reason code: %v", reasonCode)
	}
	if actionHint != "remove_realm_scopes_or_switch_mode_full" {
		t.Fatalf("unexpected action hint: %s", actionHint)
	}

	reasonCode, actionHint, ok = ValidateDomainAndScopes(coreOnly, "runtime.ai", []string{"realm.chat.read"})
	if ok {
		t.Fatalf("expected core-only realm scope rejected")
	}
	if reasonCode != runtimev1.ReasonCode_APP_MODE_SCOPE_FORBIDDEN {
		t.Fatalf("unexpected reason code: %v", reasonCode)
	}
	if actionHint != "adjust_scopes_for_app_mode" {
		t.Fatalf("unexpected action hint: %s", actionHint)
	}
}

func TestValidateDomainAndScopesRejectsEmptyDomain(t *testing.T) {
	manifest := &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}
	reasonCode, actionHint, ok := ValidateDomainAndScopes(manifest, "   ", []string{"runtime.ai.generate"})
	if ok {
		t.Fatalf("expected empty domain rejected")
	}
	if reasonCode != runtimev1.ReasonCode_APP_MODE_DOMAIN_FORBIDDEN {
		t.Fatalf("unexpected reason code: %v", reasonCode)
	}
	if actionHint != "provide_domain_for_scope_validation" {
		t.Fatalf("unexpected action hint: %s", actionHint)
	}
}
