package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func newAccountInventoryReadServiceForTest(t *testing.T, accountID string) (*Service, string) {
	t.Helper()
	nimiDir := filepath.Join(t.TempDir(), ".nimi")
	svc := New(testLogger(),
		WithRuntimeAccountProjectionProvider(testRuntimeAccountProjectionProvider{
			projection: &runtimev1.AccountProjection{AccountId: accountID},
			ok:         true,
		}),
		WithAccountAppInventoryStoreForTest(newAccountAppInventoryStoreForTest(nimiDir)),
	)
	return svc, nimiDir
}

func TestGetAccountAppInventoryReturnsAbsentProjection(t *testing.T) {
	svc, _ := newAccountInventoryReadServiceForTest(t, "account_1")

	resp, err := svc.GetAccountAppInventory(context.Background(), &runtimev1.GetAccountAppInventoryRequest{})
	if err != nil {
		t.Fatalf("GetAccountAppInventory: %v", err)
	}
	if resp.GetExists() {
		t.Fatal("expected exists=false for missing account app-inventory projection")
	}
	if resp.GetRecord() != nil {
		t.Fatalf("record = %+v, want nil", resp.GetRecord())
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("reason = %v, want ACTION_EXECUTED", resp.GetReasonCode())
	}
}

func TestGetAccountAppInventoryReturnsValidatedProjection(t *testing.T) {
	svc, nimiDir := newAccountInventoryReadServiceForTest(t, "account/one")
	accountDir := filepath.Join(nimiDir, "accounts", accountPathSegment("account/one"))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "apps", "inventory.json"), `{
  "schemaVersion": 2,
  "accountId": "account/one",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "apps": [{
    "appId": "nimi.example-app",
    "accountState": "verified",
    "installState": "installed",
    "lastOpenedAt": "2026-06-02T00:00:00.000Z",
    "dataPolicy": "keep_on_uninstall",
    "verifiedAt": "2026-06-01T00:00:00.000Z",
    "source": "nimi-account"
  }]
}`)

	resp, err := svc.GetAccountAppInventory(context.Background(), &runtimev1.GetAccountAppInventoryRequest{})
	if err != nil {
		t.Fatalf("GetAccountAppInventory: %v", err)
	}
	if !resp.GetExists() {
		t.Fatal("expected exists=true")
	}
	record := resp.GetRecord()
	if record.GetAccountId() != "account/one" {
		t.Fatalf("accountId = %q", record.GetAccountId())
	}
	if got := record.GetApps()[0].GetAppId(); got != "nimi.example-app" {
		t.Fatalf("appId = %q", got)
	}
	if got := record.GetApps()[0].GetAccountState(); got != runtimev1.AccountAppInventoryState_ACCOUNT_APP_INVENTORY_STATE_VERIFIED {
		t.Fatalf("accountState = %v", got)
	}
	if got := record.GetApps()[0].GetInstallState(); got != runtimev1.AccountAppInstallState_ACCOUNT_APP_INSTALL_STATE_INSTALLED {
		t.Fatalf("installState = %v", got)
	}
}

func TestGetAccountAppInventoryFailsClosedForInvalidProjection(t *testing.T) {
	svc, nimiDir := newAccountInventoryReadServiceForTest(t, "account_1")
	accountDir := filepath.Join(nimiDir, "accounts", accountPathSegment("account_1"))
	if err := os.MkdirAll(filepath.Join(accountDir, "apps"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(accountDir, "apps", "inventory.json"), []byte(`{
  "schemaVersion": 2,
  "accountId": "account_2",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "apps": []
}`), 0o644); err != nil {
		t.Fatalf("write inventory: %v", err)
	}

	_, err := svc.GetAccountAppInventory(context.Background(), &runtimev1.GetAccountAppInventoryRequest{})
	if err == nil {
		t.Fatal("expected invalid account app-inventory projection to fail closed")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID {
		t.Fatalf("reason = %v ok=%v, want APP_OPEN_LIBRARY_STATE_INVALID", reason, ok)
	}
}

func TestGetAccountAppInventoryFailsClosedForDuplicateAppID(t *testing.T) {
	svc, nimiDir := newAccountInventoryReadServiceForTest(t, "account_1")
	accountDir := filepath.Join(nimiDir, "accounts", accountPathSegment("account_1"))
	if err := os.MkdirAll(filepath.Join(accountDir, "apps"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(accountDir, "apps", "inventory.json"), []byte(`{
  "schemaVersion": 2,
  "accountId": "account_1",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "apps": [{
    "appId": "nimi.example-app",
    "accountState": "verified",
    "installState": "installed",
    "dataPolicy": "keep_on_uninstall"
  }, {
    "appId": "nimi.example-app",
    "accountState": "verified",
    "installState": "not-installed",
    "dataPolicy": "keep_on_uninstall"
  }]
}`), 0o644); err != nil {
		t.Fatalf("write inventory: %v", err)
	}

	_, err := svc.GetAccountAppInventory(context.Background(), &runtimev1.GetAccountAppInventoryRequest{})
	if err == nil {
		t.Fatal("expected duplicate appId inventory projection to fail closed")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID {
		t.Fatalf("reason = %v ok=%v, want APP_OPEN_LIBRARY_STATE_INVALID", reason, ok)
	}
}

func TestGetAccountAppInventoryRequiresAuthenticatedRuntimeAccount(t *testing.T) {
	svc := New(testLogger(), WithRuntimeAccountProjectionProvider(testRuntimeAccountProjectionProvider{}))

	_, err := svc.GetAccountAppInventory(context.Background(), &runtimev1.GetAccountAppInventoryRequest{})
	if err == nil {
		t.Fatal("expected unauthenticated account app-inventory read to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("reason = %v ok=%v, want PRINCIPAL_UNAUTHORIZED", reason, ok)
	}
	if !strings.Contains(err.Error(), "Unauthenticated") {
		t.Fatalf("error = %v, want unauthenticated status", err)
	}
}
