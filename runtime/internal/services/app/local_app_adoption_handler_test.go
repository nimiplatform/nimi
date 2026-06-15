package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
)

func newLocalAdoptionTestService(t *testing.T, appID string, installState string) (*Service, string, string) {
	t.Helper()
	svc, dataRoot := newBundledInstallService(t)
	nimiDir := filepath.Join(t.TempDir(), ".nimi")
	accountProjection := testRuntimeAccountProjectionProvider{
		projection: &runtimev1.AccountProjection{AccountId: "account_1"},
		ok:         true,
	}
	svc.accountProjection = accountProjection
	svc.openReadiness = NewAccountProjectionOpenAppReadinessVerifier(
		accountProjection,
		WithOpenAppReadinessNimiDirForTest(nimiDir),
	)
	svc.accountInventory = newAccountAppInventoryStoreForTest(nimiDir)
	svc.localAdoptions = newLocalAppAdoptionStoreForTest(nimiDir)
	seedAccountInventoryForTest(t, nimiDir, "account_1", appID, installState)
	return svc, dataRoot, nimiDir
}

func writeLocalAppManifest(t *testing.T, root string, appID string) {
	t.Helper()
	writeLocalAppManifestWithEntryRef(t, root, appID, "app://"+appID+"/main")
}

func writeLocalAppManifestWithEntryRef(t *testing.T, root string, appID string, entryRef string) {
	t.Helper()
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("mkdir local app: %v", err)
	}
	body := []byte(`app_id: ` + appID + `
display_name: Local Notes
version: 1.0.0
entry_ref: ` + entryRef + `
permission_scope_ref: account:account.session.read
storage_policy_ref: nimi-data-app-roots
`)
	if err := os.WriteFile(filepath.Join(root, "nimi.app.yaml"), body, 0o644); err != nil {
		t.Fatalf("write local app manifest: %v", err)
	}
}

func seedAccountGrantForLocalAdoptionTest(t *testing.T, nimiDir string, accountID string, appID string) {
	t.Helper()
	accountDir := filepath.Join(nimiDir, "accounts", accountPathSegment(accountID))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "permissions", "grants.json"), fmt.Sprintf(`{
  "schemaVersion": 1,
  "accountId": %q,
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "grants": [{
    "grantId": "grant-local-adoption",
    "subjectAccountId": %q,
    "appId": %q,
    "scopeFamily": "account",
    "scopeName": "account.session.read",
    "qualifier": null,
    "state": "granted",
    "expiresAt": null,
    "version": 1
  }]
}`, accountID, accountID, appID))
}

func requireAccountInstallStateForTest(t *testing.T, svc *Service, appID string, want string) {
	t.Helper()
	record, err := svc.accountInventory.readOrEmpty("account_1")
	if err != nil {
		t.Fatalf("read account inventory: %v", err)
	}
	for _, row := range record.Apps {
		if row.AppID == appID {
			if row.InstallState != want {
				t.Fatalf("installState for %s = %q, want %q", appID, row.InstallState, want)
			}
			return
		}
	}
	t.Fatalf("account inventory row for %s is missing", appID)
}

func TestAdoptLocalAppRejectsMissingManifest(t *testing.T) {
	appID := "local.notes"
	svc, _, _ := newLocalAdoptionTestService(t, appID, accountAppInstallStateNotInstalled)
	root := filepath.Join(t.TempDir(), "local-notes")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("mkdir local app root: %v", err)
	}

	_, err := svc.AdoptLocalApp(context.Background(), &runtimev1.AdoptLocalAppRequest{
		RootPath:      root,
		ExpectedAppId: appID,
	})
	if err == nil {
		t.Fatal("AdoptLocalApp accepted a local root without a manifest")
	}
}

func TestAdoptLocalAppRejectsUnsafeEntryRef(t *testing.T) {
	tests := []struct {
		name     string
		entryRef string
	}{
		{name: "wrong-app-uri-host", entryRef: "app://other.app/main"},
		{name: "uri-query", entryRef: "app://local.notes/main?debug=1"},
		{name: "uri-path-traversal", entryRef: "app://local.notes/../main"},
		{name: "relative-path-traversal", entryRef: "../main.js"},
		{name: "absolute-path", entryRef: "/tmp/main.js"},
		{name: "unsupported-scheme", entryRef: "file:///tmp/main.js"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			appID := "local.notes"
			svc, _, _ := newLocalAdoptionTestService(t, appID, accountAppInstallStateNotInstalled)
			root := filepath.Join(t.TempDir(), "local-notes")
			writeLocalAppManifestWithEntryRef(t, root, appID, tt.entryRef)

			_, err := svc.AdoptLocalApp(context.Background(), &runtimev1.AdoptLocalAppRequest{
				RootPath:      root,
				ExpectedAppId: appID,
			})
			if err == nil {
				t.Fatalf("AdoptLocalApp accepted unsafe entryRef %q", tt.entryRef)
			}
		})
	}
}

func TestAdoptLocalAppAcceptsContainedRelativeEntryRef(t *testing.T) {
	appID := "local.notes"
	svc, _, _ := newLocalAdoptionTestService(t, appID, accountAppInstallStateNotInstalled)
	root := filepath.Join(t.TempDir(), "local-notes")
	writeLocalAppManifestWithEntryRef(t, root, appID, "dist/main.js")

	resp, err := svc.AdoptLocalApp(context.Background(), &runtimev1.AdoptLocalAppRequest{
		RootPath:      root,
		ExpectedAppId: appID,
	})
	if err != nil {
		t.Fatalf("AdoptLocalApp with contained relative entryRef: %v", err)
	}
	if got := resp.GetAdoption().GetEntryRef(); got != "dist/main.js" {
		t.Fatalf("entryRef = %q, want dist/main.js", got)
	}
}

func TestAdoptLocalAppUpdatesAccountInventoryAndOpenUsesLocalMaterialization(t *testing.T) {
	appID := "local.notes"
	svc, _, nimiDir := newLocalAdoptionTestService(t, appID, accountAppInstallStateNotInstalled)
	root := filepath.Join(t.TempDir(), "local-notes")
	writeLocalAppManifest(t, root, appID)

	adoptResp, err := svc.AdoptLocalApp(context.Background(), &runtimev1.AdoptLocalAppRequest{
		RootPath:      root,
		ExpectedAppId: appID,
	})
	if err != nil {
		t.Fatalf("AdoptLocalApp: %v", err)
	}
	if adoptResp.GetAdoption().GetState() != runtimev1.LocalAppAdoptionState_LOCAL_APP_ADOPTION_STATE_ADOPTED {
		t.Fatalf("adoption state = %v, want ADOPTED", adoptResp.GetAdoption().GetState())
	}
	requireAccountInstallStateForTest(t, svc, appID, accountAppInstallStateAdoptedLocal)

	listCtx := envelope.WithMetadata(context.Background(), envelope.Metadata{
		AppID:      "nimi.desktop",
		CallerKind: "desktop-core",
		CallerID:   "desktop.apps.test",
		SurfaceID:  "desktop.apps",
	})
	listResp, err := svc.ListLocalAppAdoptions(listCtx, &runtimev1.ListLocalAppAdoptionsRequest{})
	if err != nil {
		t.Fatalf("ListLocalAppAdoptions: %v", err)
	}
	if len(listResp.GetAdoptions()) != 1 || listResp.GetAdoptions()[0].GetAppId() != appID {
		t.Fatalf("adoptions = %#v, want one %s adoption", listResp.GetAdoptions(), appID)
	}

	seedAccountGrantForLocalAdoptionTest(t, nimiDir, "account_1", appID)
	openResp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: appID,
		Scope: &runtimev1.AppOpenScopeRef{
			Kind:    "app",
			OwnerId: appID,
		},
	})
	if err != nil {
		t.Fatalf("OpenApp local adopted: %v", err)
	}
	if openResp.GetProjection().GetState() != runtimev1.AppOpenState_APP_OPEN_STATE_LAUNCHED {
		t.Fatalf("OpenApp state = %v detail=%q, want LAUNCHED", openResp.GetProjection().GetState(), openResp.GetProjection().GetDetail())
	}
}

func TestRemoveLocalAppAdoptionUpdatesAccountInventory(t *testing.T) {
	appID := "local.notes"
	svc, _, _ := newLocalAdoptionTestService(t, appID, accountAppInstallStateNotInstalled)
	root := filepath.Join(t.TempDir(), "local-notes")
	writeLocalAppManifest(t, root, appID)
	if _, err := svc.AdoptLocalApp(context.Background(), &runtimev1.AdoptLocalAppRequest{
		RootPath:      root,
		ExpectedAppId: appID,
	}); err != nil {
		t.Fatalf("AdoptLocalApp: %v", err)
	}
	requireAccountInstallStateForTest(t, svc, appID, accountAppInstallStateAdoptedLocal)

	resp, err := svc.RemoveLocalAppAdoption(context.Background(), &runtimev1.RemoveLocalAppAdoptionRequest{AppId: appID})
	if err != nil {
		t.Fatalf("RemoveLocalAppAdoption: %v", err)
	}
	if resp.GetAdoption().GetState() != runtimev1.LocalAppAdoptionState_LOCAL_APP_ADOPTION_STATE_REMOVED {
		t.Fatalf("adoption state = %v, want REMOVED", resp.GetAdoption().GetState())
	}
	requireAccountInstallStateForTest(t, svc, appID, accountAppInstallStateNotInstalled)
}

func TestRemoveLocalAppAdoptionWithDataDeleteMarksAccountInventoryRemoved(t *testing.T) {
	appID := "local.notes"
	svc, _, _ := newLocalAdoptionTestService(t, appID, accountAppInstallStateNotInstalled)
	root := filepath.Join(t.TempDir(), "local-notes")
	writeLocalAppManifest(t, root, appID)
	if _, err := svc.AdoptLocalApp(context.Background(), &runtimev1.AdoptLocalAppRequest{
		RootPath:      root,
		ExpectedAppId: appID,
	}); err != nil {
		t.Fatalf("AdoptLocalApp: %v", err)
	}

	resp, err := svc.RemoveLocalAppAdoption(context.Background(), &runtimev1.RemoveLocalAppAdoptionRequest{
		AppId:                      appID,
		DeleteDurableDataConfirmed: true,
	})
	if err != nil {
		t.Fatalf("RemoveLocalAppAdoption destructive: %v", err)
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("reason = %v, want ACTION_EXECUTED", resp.GetReasonCode())
	}
	requireAccountInstallStateForTest(t, svc, appID, accountAppInstallStateRemoved)
}

func TestAdoptLocalAppFailsClosedWhenAccountInventoryMutationFails(t *testing.T) {
	appID := "local.notes"
	svc, _, _ := newLocalAdoptionTestService(t, appID, accountAppInstallStateNotInstalled)
	root := filepath.Join(t.TempDir(), "local-notes")
	writeLocalAppManifest(t, root, appID)
	svc.accountInventory.now = func() string { return "" }

	_, err := svc.AdoptLocalApp(context.Background(), &runtimev1.AdoptLocalAppRequest{
		RootPath:      root,
		ExpectedAppId: appID,
	})
	if err == nil {
		t.Fatal("expected AdoptLocalApp to fail when account inventory mutation fails")
	}
	rows, listErr := svc.localAdoptions.list()
	if listErr != nil {
		t.Fatalf("list local adoptions: %v", listErr)
	}
	if len(rows) != 1 || rows[0].State != "removed" {
		t.Fatalf("adoption rows after failed mutation = %+v, want one removed row", rows)
	}
}
