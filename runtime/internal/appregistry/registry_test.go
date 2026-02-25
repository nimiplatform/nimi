package appregistry

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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
