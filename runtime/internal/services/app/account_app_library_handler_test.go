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

func newAccountLibraryReadServiceForTest(t *testing.T, accountID string) (*Service, string) {
	t.Helper()
	nimiDir := filepath.Join(t.TempDir(), ".nimi")
	svc := New(testLogger(),
		WithRuntimeAccountProjectionProvider(testRuntimeAccountProjectionProvider{
			projection: &runtimev1.AccountProjection{AccountId: accountID},
			ok:         true,
		}),
		WithAccountAppLibraryStoreForTest(newAccountAppLibraryStoreForTest(nimiDir)),
	)
	return svc, nimiDir
}

func TestGetAccountAppLibraryReturnsAbsentProjection(t *testing.T) {
	svc, _ := newAccountLibraryReadServiceForTest(t, "account_1")

	resp, err := svc.GetAccountAppLibrary(context.Background(), &runtimev1.GetAccountAppLibraryRequest{})
	if err != nil {
		t.Fatalf("GetAccountAppLibrary: %v", err)
	}
	if resp.GetExists() {
		t.Fatal("expected exists=false for missing account app-library projection")
	}
	if resp.GetRecord() != nil {
		t.Fatalf("record = %+v, want nil", resp.GetRecord())
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("reason = %v, want ACTION_EXECUTED", resp.GetReasonCode())
	}
}

func TestGetAccountAppLibraryReturnsValidatedProjection(t *testing.T) {
	svc, nimiDir := newAccountLibraryReadServiceForTest(t, "account/one")
	accountDir := filepath.Join(nimiDir, "accounts", accountPathSegment("account/one"))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "apps", "library.json"), `{
  "schemaVersion": 1,
  "accountId": "account/one",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "apps": [{
    "appId": "nimi.example-app",
    "libraryState": "enabled",
    "installed": true,
    "lastOpenedAt": "2026-06-02T00:00:00.000Z",
    "dataPolicy": "keep_on_uninstall"
  }]
}`)

	resp, err := svc.GetAccountAppLibrary(context.Background(), &runtimev1.GetAccountAppLibraryRequest{})
	if err != nil {
		t.Fatalf("GetAccountAppLibrary: %v", err)
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
	if got := record.GetApps()[0].GetLibraryState(); got != accountAppLibraryStateEnabled {
		t.Fatalf("libraryState = %q", got)
	}
}

func TestGetAccountAppLibraryFailsClosedForInvalidProjection(t *testing.T) {
	svc, nimiDir := newAccountLibraryReadServiceForTest(t, "account_1")
	accountDir := filepath.Join(nimiDir, "accounts", accountPathSegment("account_1"))
	if err := os.MkdirAll(filepath.Join(accountDir, "apps"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(accountDir, "apps", "library.json"), []byte(`{
  "schemaVersion": 1,
  "accountId": "account_2",
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "apps": []
}`), 0o644); err != nil {
		t.Fatalf("write library: %v", err)
	}

	_, err := svc.GetAccountAppLibrary(context.Background(), &runtimev1.GetAccountAppLibraryRequest{})
	if err == nil {
		t.Fatal("expected invalid account app-library projection to fail closed")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID {
		t.Fatalf("reason = %v ok=%v, want APP_OPEN_LIBRARY_STATE_INVALID", reason, ok)
	}
}

func TestGetAccountAppLibraryRequiresAuthenticatedRuntimeAccount(t *testing.T) {
	svc := New(testLogger(), WithRuntimeAccountProjectionProvider(testRuntimeAccountProjectionProvider{}))

	_, err := svc.GetAccountAppLibrary(context.Background(), &runtimev1.GetAccountAppLibraryRequest{})
	if err == nil {
		t.Fatal("expected unauthenticated account app-library read to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("reason = %v ok=%v, want PRINCIPAL_UNAUTHORIZED", reason, ok)
	}
	if !strings.Contains(err.Error(), "Unauthenticated") {
		t.Fatalf("error = %v, want unauthenticated status", err)
	}
}
