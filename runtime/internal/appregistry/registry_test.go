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

func TestRegistryAdmissionDistinguishesFirstPartyAndDeveloperInstances(t *testing.T) {
	registry := New()
	manifest := &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}
	if err := registry.UpsertInstanceWithAdmission("nimi.tester", "nimi.tester.local-developer", "developer-device", manifest, nil, true); err != nil {
		t.Fatalf("UpsertInstanceWithAdmission developer: %v", err)
	}
	if registry.AdmitLocalFirstPartyInstance("nimi.tester", "nimi.tester.local-developer") {
		t.Fatalf("developer-registration instance must not be admitted as local first-party")
	}
	if !registry.AdmitLocalDeveloperInstance("nimi.tester", "nimi.tester.local-developer") {
		t.Fatalf("developer-registration instance should be admitted as local developer")
	}

	if err := registry.UpsertInstance("nimi.avatar", "nimi.avatar.local-first-party", "avatar-device", manifest, nil); err != nil {
		t.Fatalf("UpsertInstance first-party: %v", err)
	}
	if !registry.AdmitLocalFirstPartyInstance("nimi.avatar", "nimi.avatar.local-first-party") {
		t.Fatalf("registry-admitted first-party instance should be admitted as local first-party")
	}
	if registry.AdmitLocalDeveloperInstance("nimi.avatar", "nimi.avatar.local-first-party") {
		t.Fatalf("first-party instance must not be admitted as local developer")
	}
}

func TestRegistryInstancesRetainIndependentCapabilities(t *testing.T) {
	registry := New()
	manifest := &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_RENDER,
	}
	if err := registry.UpsertInstance("nimi.desktop", "nimi.desktop.local-first-party", "desktop-shell", manifest, []string{"account.session.read", "realm_source.snapshot.bind"}); err != nil {
		t.Fatalf("register Desktop account instance: %v", err)
	}
	if err := registry.UpsertInstance("nimi.desktop", "nimi.desktop.runtime-agent", "runtime-agent", manifest, []string{"runtime.agent.read"}); err != nil {
		t.Fatalf("register Desktop Runtime Agent instance: %v", err)
	}

	record, ok := registry.Get("nimi.desktop")
	if !ok {
		t.Fatal("expected Desktop registry record")
	}
	accountInstance := record.Instances["nimi.desktop.local-first-party"]
	runtimeAgentInstance := record.Instances["nimi.desktop.runtime-agent"]
	if len(accountInstance.Capabilities) != 2 || accountInstance.Capabilities[1] != "realm_source.snapshot.bind" {
		t.Fatalf("Desktop account instance capabilities were overwritten: %#v", accountInstance.Capabilities)
	}
	if len(runtimeAgentInstance.Capabilities) != 1 || runtimeAgentInstance.Capabilities[0] != "runtime.agent.read" {
		t.Fatalf("Desktop Runtime Agent instance capabilities mismatch: %#v", runtimeAgentInstance.Capabilities)
	}
}

func TestRegistryAdmissionDistinguishesDesktopLaunchedInstalledNimiApps(t *testing.T) {
	registry := New()
	manifest := &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}
	admission := DesktopLaunchedNimiAppAdmission{
		PlatformRegistryAdmitted: true,
		ReleaseDescriptorRef:     "community.nimi.fixture.platform-proof.0.1.0-sandbox",
		ActiveReleaseRoot:        "D:/nimi-data/apps/community.nimi.fixture.platform-proof/releases/0.1.0",
		LaunchHostID:             DesktopInstalledAppLaunchHostID,
		LaunchNonce:              "launch-nonce-1",
		AccountInventoryEntitled: true,
		LocalMaterialized:        true,
	}
	if err := registry.UpsertDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.instance",
		"fixture.device",
		manifest,
		[]string{"runtime.account.status"},
		admission,
	); err != nil {
		t.Fatalf("UpsertDesktopLaunchedNimiAppInstance: %v", err)
	}
	if !registry.AdmitDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.instance",
		"fixture.device",
		DesktopInstalledAppLaunchHostID,
		"launch-nonce-1",
		"community.nimi.fixture.platform-proof.0.1.0-sandbox",
	) {
		t.Fatalf("installed app launch evidence should admit desktop-launched Nimi App posture")
	}
	if registry.AdmitDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.instance",
		"other-device",
		DesktopInstalledAppLaunchHostID,
		"launch-nonce-1",
		"community.nimi.fixture.platform-proof.0.1.0-sandbox",
	) {
		t.Fatalf("installed app admission must bind the Runtime device identity")
	}
	if registry.AdmitDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.instance",
		"fixture.device",
		DesktopInstalledAppLaunchHostID,
		"wrong-launch-nonce",
		"community.nimi.fixture.platform-proof.0.1.0-sandbox",
	) {
		t.Fatalf("installed app admission must bind the Runtime launch nonce")
	}
	if registry.AdmitDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.instance",
		"fixture.device",
		DesktopInstalledAppLaunchHostID,
		"launch-nonce-1",
		"other.descriptor",
	) {
		t.Fatalf("installed app admission must bind the Runtime release descriptor")
	}
	if registry.AdmitLocalFirstPartyInstance("community.nimi.fixture.platform-proof", "fixture.instance") {
		t.Fatalf("installed app launch evidence must not become local first-party admission")
	}
	if registry.AdmitLocalDeveloperInstance("community.nimi.fixture.platform-proof", "fixture.instance") {
		t.Fatalf("installed app launch evidence must not become local developer admission")
	}

	missingRelease := admission
	missingRelease.ReleaseDescriptorRef = ""
	if err := registry.UpsertDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.missing-release",
		"fixture.device",
		manifest,
		nil,
		missingRelease,
	); err != nil {
		t.Fatalf("UpsertDesktopLaunchedNimiAppInstance missing release: %v", err)
	}
	if registry.AdmitDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.missing-release",
		"fixture.device",
		DesktopInstalledAppLaunchHostID,
		"launch-nonce-1",
		"community.nimi.fixture.platform-proof.0.1.0-sandbox",
	) {
		t.Fatalf("installed app admission must require release descriptor evidence")
	}

	wrongHost := admission
	wrongHost.LaunchHostID = "desktop-shell"
	if err := registry.UpsertDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.wrong-host",
		"fixture.device",
		manifest,
		nil,
		wrongHost,
	); err != nil {
		t.Fatalf("UpsertDesktopLaunchedNimiAppInstance wrong host: %v", err)
	}
	if registry.AdmitDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.wrong-host",
		"fixture.device",
		DesktopInstalledAppLaunchHostID,
		"launch-nonce-1",
		"community.nimi.fixture.platform-proof.0.1.0-sandbox",
	) {
		t.Fatalf("installed app admission must require the Desktop installed app launch host")
	}

	noInventory := admission
	noInventory.AccountInventoryEntitled = false
	if err := registry.UpsertDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.no-inventory",
		"fixture.device",
		manifest,
		nil,
		noInventory,
	); err != nil {
		t.Fatalf("UpsertDesktopLaunchedNimiAppInstance no inventory: %v", err)
	}
	if registry.AdmitDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"fixture.no-inventory",
		"fixture.device",
		DesktopInstalledAppLaunchHostID,
		"launch-nonce-1",
		"community.nimi.fixture.platform-proof.0.1.0-sandbox",
	) {
		t.Fatalf("installed app admission must require account inventory entitlement")
	}
}

func TestRegistryPreservesDesktopLaunchAdmissionAcrossRegisterAppUpsert(t *testing.T) {
	registry := New()
	manifest := &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}
	admission := DesktopLaunchedNimiAppAdmission{
		PlatformRegistryAdmitted: true,
		ReleaseDescriptorRef:     "community.nimi.fixture.platform-proof.0.1.0-sandbox",
		ActiveReleaseRoot:        "D:/nimi-data/apps/community.nimi.fixture.platform-proof/releases/0.1.0",
		LaunchHostID:             DesktopInstalledAppLaunchHostID,
		LaunchNonce:              "launch-nonce-1",
		AccountInventoryEntitled: true,
		LocalMaterialized:        true,
	}
	if err := registry.UpsertDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"community.nimi.fixture.platform-proof.desktop-host",
		"desktop-installed-app-host-device",
		manifest,
		[]string{"runtime.account.status"},
		admission,
	); err != nil {
		t.Fatalf("UpsertDesktopLaunchedNimiAppInstance: %v", err)
	}
	if err := registry.UpsertInstanceWithAdmission(
		"community.nimi.fixture.platform-proof",
		"community.nimi.fixture.platform-proof.desktop-host",
		"desktop-installed-app-host-device",
		manifest,
		[]string{"runtime.account.status"},
		false,
	); err != nil {
		t.Fatalf("UpsertInstanceWithAdmission: %v", err)
	}
	if !registry.AdmitDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"community.nimi.fixture.platform-proof.desktop-host",
		"desktop-installed-app-host-device",
		DesktopInstalledAppLaunchHostID,
		"launch-nonce-1",
		"community.nimi.fixture.platform-proof.0.1.0-sandbox",
	) {
		t.Fatalf("RegisterApp upsert must preserve matching Desktop launch admission")
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
