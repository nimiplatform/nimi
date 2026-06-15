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
)

type testRuntimeAccountProjectionProvider struct {
	projection *runtimev1.AccountProjection
	ok         bool
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
