package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type testRuntimeAccountProjectionProvider struct {
	projection *runtimev1.AccountProjection
	ok         bool
}

type testRuntimeAccountSecurityProjectionProvider struct {
	projection *runtimev1.AccountProjection
	generation uint64
	ok         bool
}

func (p testRuntimeAccountSecurityProjectionProvider) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	return p.projection, p.ok
}

func (p testRuntimeAccountSecurityProjectionProvider) AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	return p.projection, p.generation, p.ok
}

func (p testRuntimeAccountProjectionProvider) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	return p.projection, p.ok
}

func newProjectionOpenReadinessVerifierForTest(t *testing.T, accountID string) (OpenAppReadinessVerifier, string) {
	t.Helper()
	nimiDir := filepath.Join(t.TempDir(), ".nimi")
	verifier := NewAccountProjectionOpenAppReadinessVerifier(
		testRuntimeAccountProjectionProvider{
			projection: &runtimev1.AccountProjection{AccountId: accountID},
			ok:         true,
		},
		WithOpenAppReadinessNimiDirForTest(nimiDir),
		WithOpenAppReadinessClockForTest(func() time.Time {
			return time.Date(2026, 6, 2, 0, 0, 0, 0, time.UTC)
		}),
	)
	return verifier, nimiDir
}

func writeRuntimeProjectionJSON(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir projection dir: %v", err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write projection: %v", err)
	}
}

func runtimeProjectionAccountSegment(accountID string) string {
	return accountPathSegment(accountID)
}

func TestOpenAppReadinessVerifierAllowsEnabledInstalledAppAndGrantedPermissions(t *testing.T) {
	verifier, nimiDir := newProjectionOpenReadinessVerifierForTest(t, "account/one")
	accountDir := filepath.Join(nimiDir, "accounts", runtimeProjectionAccountSegment("account/one"))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "apps", "inventory.json"), `{
  "schemaVersion": 2,
  "accountId": "account/one",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "apps": [{
    "appId": "nimi.example-app",
    "accountState": "verified",
    "installState": "installed",
    "lastOpenedAt": null,
    "dataPolicy": "keep_on_uninstall",
    "verifiedAt": "2026-06-01T00:00:00.000Z",
    "source": "nimi-account"
  }]
}`)
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "permissions", "grants.json"), `{
  "schemaVersion": 1,
  "accountId": "account/one",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "grants": [{
    "grantId": "grant-1",
    "subjectAccountId": "account/one",
    "appId": "nimi.example-app",
    "scopeFamily": "account",
    "scopeName": "account.session.read",
    "qualifier": null,
    "state": "granted",
    "expiresAt": null,
    "version": 1
  }]
}`)
	app := appregistrycatalog.App{
		AppID: "nimi.example-app",
		PermissionScopeRefs: []appregistrycatalog.PermissionScopeRef{{
			AppID:       "nimi.example-app",
			ScopeFamily: "account",
			ScopeName:   "account.session.read",
		}},
	}
	inventory, err := verifier.VerifyOpenAccountInventory(context.Background(), app)
	if err != nil {
		t.Fatalf("VerifyOpenAccountInventory: %v", err)
	}
	if !inventory.Allowed {
		t.Fatalf("inventory gate blocked: %+v", inventory)
	}
	permissions, err := verifier.VerifyOpenPermissions(context.Background(), app)
	if err != nil {
		t.Fatalf("VerifyOpenPermissions: %v", err)
	}
	if !permissions.Allowed {
		t.Fatalf("permission gate blocked: %+v", permissions)
	}
}

func TestOpenAppReadinessVerifierFailsClosedOnMissingInventoryAndExpiredGrant(t *testing.T) {
	verifier, nimiDir := newProjectionOpenReadinessVerifierForTest(t, "account_1")
	app := appregistrycatalog.App{
		AppID: "nimi.example-app",
		PermissionScopeRefs: []appregistrycatalog.PermissionScopeRef{{
			AppID:       "nimi.example-app",
			ScopeFamily: "account",
			ScopeName:   "account.session.read",
		}},
	}
	inventory, err := verifier.VerifyOpenAccountInventory(context.Background(), app)
	if err != nil {
		t.Fatalf("VerifyOpenAccountInventory: %v", err)
	}
	if inventory.Allowed || !strings.Contains(inventory.Detail, "missing") {
		t.Fatalf("expected missing inventory fail-closed decision, got %+v", inventory)
	}

	accountDir := filepath.Join(nimiDir, "accounts", runtimeProjectionAccountSegment("account_1"))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "permissions", "grants.json"), `{
  "schemaVersion": 1,
  "accountId": "account_1",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "grants": [{
    "grantId": "grant-1",
    "subjectAccountId": "account_1",
    "appId": "nimi.example-app",
    "scopeFamily": "account",
    "scopeName": "account.session.read",
    "qualifier": null,
    "state": "granted",
    "expiresAt": "2026-06-01T00:00:00.000Z",
    "version": 1
  }]
}`)
	permissions, err := verifier.VerifyOpenPermissions(context.Background(), app)
	if err != nil {
		t.Fatalf("VerifyOpenPermissions: %v", err)
	}
	if permissions.Allowed || !strings.Contains(permissions.Detail, "expired") {
		t.Fatalf("expected expired grant fail-closed decision, got %+v", permissions)
	}
}

func TestOpenAppReadinessVerifierFailsClosedForPermissionFabricPendingRef(t *testing.T) {
	verifier, _ := newProjectionOpenReadinessVerifierForTest(t, "account_1")
	decision, err := verifier.VerifyOpenPermissions(context.Background(), appregistrycatalog.App{
		AppID:                     "nimi.example-app",
		PermissionScopeRefPending: true,
	})
	if err != nil {
		t.Fatalf("VerifyOpenPermissions: %v", err)
	}
	if decision.Allowed || !strings.Contains(decision.Detail, "permission_fabric_pending") {
		t.Fatalf("expected pending permission fabric fail-closed decision, got %+v", decision)
	}
}

func TestOpenAppReadinessVerifierMatchesQualifiedScopeExactly(t *testing.T) {
	verifier, nimiDir := newProjectionOpenReadinessVerifierForTest(t, "account_1")
	accountDir := filepath.Join(nimiDir, "accounts", runtimeProjectionAccountSegment("account_1"))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "permissions", "grants.json"), `{
  "schemaVersion": 1,
  "accountId": "account_1",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "grants": [{
    "grantId": "grant-1",
    "subjectAccountId": "account_1",
    "appId": "nimi.example-app",
    "scopeFamily": "memory",
    "scopeName": "memory.read.bounded",
    "qualifier": null,
    "state": "granted",
    "expiresAt": null,
    "version": 1
  }]
}`)
	app := appregistrycatalog.App{
		AppID: "nimi.example-app",
		PermissionScopeRefs: []appregistrycatalog.PermissionScopeRef{{
			AppID:       "nimi.example-app",
			ScopeFamily: "memory",
			ScopeName:   "memory.read.bounded",
			Qualifier:   "persona-scoped",
		}},
	}
	decision, err := verifier.VerifyOpenPermissions(context.Background(), app)
	if err != nil {
		t.Fatalf("VerifyOpenPermissions: %v", err)
	}
	if decision.Allowed || !strings.Contains(decision.Detail, "qualifier persona-scoped") {
		t.Fatalf("expected missing qualifier to fail closed, got %+v", decision)
	}

	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "permissions", "grants.json"), `{
  "schemaVersion": 1,
  "accountId": "account_1",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "grants": [{
    "grantId": "grant-1",
    "subjectAccountId": "account_1",
    "appId": "nimi.example-app",
    "scopeFamily": "memory",
    "scopeName": "memory.read.bounded",
    "qualifier": "persona-scoped",
    "state": "granted",
    "expiresAt": null,
    "version": 2
  }]
}`)
	decision, err = verifier.VerifyOpenPermissions(context.Background(), app)
	if err != nil {
		t.Fatalf("VerifyOpenPermissions: %v", err)
	}
	if !decision.Allowed {
		t.Fatalf("expected exact qualified scope to pass, got %+v", decision)
	}
}

func TestOpenAppReadinessVerifierFailsClosedForUnknownGrantState(t *testing.T) {
	verifier, nimiDir := newProjectionOpenReadinessVerifierForTest(t, "account_1")
	accountDir := filepath.Join(nimiDir, "accounts", runtimeProjectionAccountSegment("account_1"))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "permissions", "grants.json"), `{
  "schemaVersion": 1,
  "accountId": "account_1",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "grants": [{
    "grantId": "grant-1",
    "subjectAccountId": "account_1",
    "appId": "nimi.example-app",
    "scopeFamily": "account",
    "scopeName": "account.session.read",
    "qualifier": null,
    "state": "active",
    "expiresAt": null,
    "version": 1
  }]
}`)
	decision, err := verifier.VerifyOpenPermissions(context.Background(), appregistrycatalog.App{
		AppID: "nimi.example-app",
		PermissionScopeRefs: []appregistrycatalog.PermissionScopeRef{{
			AppID:       "nimi.example-app",
			ScopeFamily: "account",
			ScopeName:   "account.session.read",
		}},
	})
	if err != nil {
		t.Fatalf("VerifyOpenPermissions: %v", err)
	}
	if decision.Allowed || !strings.Contains(decision.Detail, "unknown state") {
		t.Fatalf("expected unknown grant state to fail closed, got %+v", decision)
	}
}

func TestOpenAppReadinessVerifierFailsClosedForEmptyGrantQualifier(t *testing.T) {
	verifier, nimiDir := newProjectionOpenReadinessVerifierForTest(t, "account_1")
	accountDir := filepath.Join(nimiDir, "accounts", runtimeProjectionAccountSegment("account_1"))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "permissions", "grants.json"), `{
  "schemaVersion": 1,
  "accountId": "account_1",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "grants": [{
    "grantId": "grant-1",
    "subjectAccountId": "account_1",
    "appId": "nimi.example-app",
    "scopeFamily": "account",
    "scopeName": "account.session.read",
    "qualifier": "",
    "state": "granted",
    "expiresAt": null,
    "version": 1
  }]
}`)
	decision, err := verifier.VerifyOpenPermissions(context.Background(), appregistrycatalog.App{
		AppID: "nimi.example-app",
		PermissionScopeRefs: []appregistrycatalog.PermissionScopeRef{{
			AppID:       "nimi.example-app",
			ScopeFamily: "account",
			ScopeName:   "account.session.read",
		}},
	})
	if err != nil {
		t.Fatalf("VerifyOpenPermissions: %v", err)
	}
	if decision.Allowed || !strings.Contains(decision.Detail, "qualifier must be omitted or a non-empty value") {
		t.Fatalf("expected empty qualifier to fail closed, got %+v", decision)
	}
}

func TestOpenAppReadinessVerifierRequiresAuthenticatedRuntimeAccount(t *testing.T) {
	verifier := NewAccountProjectionOpenAppReadinessVerifier(testRuntimeAccountProjectionProvider{})
	decision, err := verifier.VerifyOpenAccountInventory(context.Background(), appregistrycatalog.App{AppID: "nimi.example-app"})
	if err != nil {
		t.Fatalf("VerifyOpenAccountInventory: %v", err)
	}
	if decision.Allowed || !strings.Contains(decision.Detail, "authenticated Runtime account session") {
		t.Fatalf("expected authenticated account fail-closed decision, got %+v", decision)
	}
}

func TestInstalledOperationPolicySourceRevalidatesGrantCeilingAndActiveRelease(t *testing.T) {
	registry := bundledRegistryWithArtifactPermission(t)
	svc, _, nimiDir := newBundledInstallServiceWithRegistryAndAccountRow(
		t,
		registry,
		allowOpenReadinessVerifier{},
		accountAppInventoryStateVerified,
		accountAppInstallStateNotInstalled,
	)
	installBundledAppForOpen(t, svc)

	verifier := NewAccountProjectionOpenAppReadinessVerifier(
		testRuntimeAccountSecurityProjectionProvider{projection: &runtimev1.AccountProjection{AccountId: "account_1"}, generation: 12, ok: true},
		WithOpenAppReadinessNimiDirForTest(nimiDir),
		WithOpenAppReadinessClockForTest(func() time.Time { return time.Date(2026, 6, 2, 0, 0, 0, 0, time.UTC) }),
		WithOpenAppReadinessCatalog(registry),
		WithOpenAppReadinessInstallRuntime(svc.installRuntime),
	)
	policy, ok := verifier.(accountservice.InstalledOperationPolicySource)
	if !ok {
		t.Fatal("open readiness verifier does not expose the Account-owned policy fact source")
	}
	accountDir := filepath.Join(nimiDir, "accounts", runtimeProjectionAccountSegment("account_1"))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "permissions", "grants.json"), `{
  "schemaVersion": 1,
  "accountId": "account_1",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "grants": [{
    "grantId": "grant-artifact-v1",
    "subjectAccountId": "account_1",
    "appId": "nimi.example-app",
    "scopeFamily": "data",
    "scopeName": "data.scope.read",
    "qualifier": "runtime.artifacts",
    "state": "granted",
    "expiresAt": null,
    "version": 1
  }]
}`)

	_, descriptor, err := svc.installRuntime.resolveDescriptor("nimi.example-app")
	if err != nil {
		t.Fatal(err)
	}
	plan, err := svc.installRuntime.plan(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	resolved, blocked := verifyOpenPackage(svc.installRuntime, plan, descriptor)
	if blocked != nil {
		t.Fatalf("resolve installed release: %+v", blocked)
	}
	release, err := installedReleaseDigest(resolved.Evidence.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	query := accountservice.InstalledOperationPolicyQuery{
		Operation:         accountservice.InstalledOperationReadArtifactBytes,
		AccountID:         "account_1",
		AccountGeneration: 12,
		AppID:             "nimi.example-app",
		ReleaseDigest:     release,
		ScopeFamily:       "data",
		ScopeName:         "data.scope.read",
		Qualifier:         "runtime.artifacts",
	}
	snapshot, err := policy.ResolveInstalledOperationPolicy(context.Background(), query)
	if err != nil {
		t.Fatalf("resolve installed operation policy: %v", err)
	}
	if !snapshot.CatalogPermissionPresent || snapshot.CurrentAccountGeneration != 12 || snapshot.InventoryAccountState != accountservice.InstalledInventoryAccountStateVerified ||
		snapshot.InventoryInstallState != accountservice.InstalledInventoryInstallStateInstalled || snapshot.ActiveReleaseDigest != release ||
		snapshot.GrantID != "grant-artifact-v1" || snapshot.GrantState != accountservice.InstalledGrantStateGranted || snapshot.GrantVersion != 1 {
		t.Fatalf("unexpected installed operation snapshot: %+v", snapshot)
	}

	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "permissions", "grants.json"), `{
  "schemaVersion": 1,
  "accountId": "account_1",
  "updatedAt": "2026-06-02T00:00:01.000Z",
  "grants": [
    {"grantId":"grant-artifact-v1","subjectAccountId":"account_1","appId":"nimi.example-app","scopeFamily":"data","scopeName":"data.scope.read","qualifier":"runtime.artifacts","state":"granted","expiresAt":null,"version":1},
    {"grantId":"grant-artifact-v2","subjectAccountId":"account_1","appId":"nimi.example-app","scopeFamily":"data","scopeName":"data.scope.read","qualifier":"runtime.artifacts","state":"revoked","expiresAt":null,"version":2}
  ]
}`)
	snapshot, err = policy.ResolveInstalledOperationPolicy(context.Background(), query)
	if err != nil {
		t.Fatalf("resolve revoked policy: %v", err)
	}
	if snapshot.GrantState != accountservice.InstalledGrantStateRevoked || snapshot.GrantVersion != 2 {
		t.Fatalf("highest grant version was not selected: %+v", snapshot)
	}
	registryApp, err := registry.FindByID("nimi.example-app")
	if err != nil {
		t.Fatal(err)
	}
	openDecision, err := verifier.VerifyOpenPermissions(context.Background(), *registryApp)
	if err != nil {
		t.Fatalf("verify OpenApp permissions after revoke: %v", err)
	}
	if openDecision.Allowed {
		t.Fatalf("OpenApp accepted an older granted row after a newer revoke: %+v", openDecision)
	}

	query.Qualifier = "another-audience"
	snapshot, err = policy.ResolveInstalledOperationPolicy(context.Background(), query)
	if err != nil {
		t.Fatalf("resolve outside catalog ceiling: %v", err)
	}
	if snapshot.CatalogPermissionPresent {
		t.Fatalf("catalog ceiling admitted an undeclared qualifier: %+v", snapshot)
	}
}

func bundledRegistryWithArtifactPermission(t *testing.T) *appregistrycatalog.Registry {
	t.Helper()
	body := `version: 1
table_family: product_catalog
owner: platform
catalog_id: test_nimi_app_registry
apps:
  - app_id: nimi.example-app
    display_label: Example App
    publisher: nimi-first-party
    trust_tier_ref: nimi-first-party
    package_kind: nimi-app
    runtime_registration_mode: app-managed
    permission_scope_ref:
      - { appId: nimi.example-app, scopeFamily: data, scopeName: data.scope.read, qualifier: runtime.artifacts }
    ordinary_visibility: ordinary-visible
    release_descriptor_ref: nimi.example-app.bundled-with-nimi
    install_storage_policy_ref: nimi-data-app-roots
    admission_status: admitted
    source_rule: P-NAPP-011
`
	registry, err := appregistrycatalog.LoadRegistry(stringReader(body))
	if err != nil {
		t.Fatalf("load registry with artifact permission: %v", err)
	}
	return registry
}
