package localappkernel

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestPermissionGrantStorePersistsOnlyActiveGrantAndAuthorizationHistory(t *testing.T) {
	ctx := context.Background()
	identity, err := ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "local-app.db")
	now := testNow
	kernel, err := OpenSQLite(ctx, path, identity, Options{Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	principal, err := kernel.Principals().Create(ctx, CreatePrincipalInput{
		Kind: PrincipalKindDevelopment, AppID: "com.example.app",
		DevelopmentAuthorizationID: "dev-auth:permission", CanonicalProjectFileID: "file-id:permission",
	})
	if err != nil {
		t.Fatal(err)
	}
	rejectedRequest, err := kernel.PermissionGrants().CreatePendingRequest(ctx, CreatePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", RequestID: "request-reject-1", DisplayAppID: principal.AppID, Reason: "Open conversations",
	})
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	if _, err := kernel.PermissionGrants().DecidePendingRequest(ctx, DecidePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", ExpectedRevision: rejectedRequest.Revision, State: PermissionGrantStateDenied,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := kernel.PermissionGrants().GetRecentPermissionRequestDecisionByRequestID(ctx, kernel.LocalOSUserAnchor(),
		"account-one", principal.LocalAppPrincipalID, "request-reject-1", now.Add(-time.Minute)); err != nil {
		t.Fatalf("recent request-id decision was not deduplicated: %v", err)
	}
	if _, err := kernel.PermissionGrants().GetRecentPermissionRequestDecisionByRequestID(ctx, kernel.LocalOSUserAnchor(),
		"account-one", principal.LocalAppPrincipalID, "request-reject-1", now.Add(time.Nanosecond)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired request-id dedup remained active: %v", err)
	}
	now = now.Add(time.Second)
	request, err := kernel.PermissionGrants().CreatePendingRequest(ctx, CreatePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", RequestID: "request-accept-1", DisplayAppID: principal.AppID, Reason: "Open conversations after user retry",
	})
	if err != nil || request.Revision != 3 {
		t.Fatalf("second cycle request = (%+v, %v)", request, err)
	}
	now = now.Add(time.Second)
	decision, err := kernel.PermissionGrants().DecidePendingRequest(ctx, DecidePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", ExpectedRevision: request.Revision, State: PermissionGrantStateGranted,
		OwnerSelectorDigest: "selector-digest-one",
	})
	if err != nil {
		t.Fatal(err)
	}
	key := PermissionGrantKey{LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one",
		LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact", OwnerSelectorDigest: "selector-digest-one"}
	grant, err := kernel.PermissionGrants().Get(ctx, key)
	if err != nil || grant.State != PermissionGrantStateGranted || grant.RequestID != "request-accept-1" || grant.Revision != decision.Revision {
		t.Fatalf("active grant = (%+v, %v)", grant, err)
	}
	now = now.Add(time.Second)
	revoked, err := kernel.PermissionGrants().Revoke(ctx, RevokePermissionGrantInput{Key: key, ExpectedRevision: grant.Revision})
	if err != nil || revoked.Action != PermissionAuthorizationActionRevoke || revoked.Revision != 5 {
		t.Fatalf("revoke = (%+v, %v)", revoked, err)
	}
	if _, err := kernel.PermissionGrants().Get(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked grant remained active: %v", err)
	}
	var actions string
	if err := kernel.db.QueryRowContext(ctx, `SELECT group_concat(action, ',') FROM local_app_permission_request_decisions
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND permission_id = ? ORDER BY revision`,
		key.LocalOSUserAnchor, key.AccountID, key.LocalAppPrincipalID, key.PermissionID).Scan(&actions); err != nil {
		t.Fatal(err)
	}
	if actions != "reject,accept,revoke" {
		t.Fatalf("authorization history actions = %q", actions)
	}
	if _, err := kernel.db.ExecContext(ctx, `UPDATE local_app_permission_request_decisions SET reason = 'mutated' WHERE sequence = 1`); err == nil {
		t.Fatal("authorization history update unexpectedly succeeded")
	}
	if _, err := kernel.db.ExecContext(ctx, `DELETE FROM local_app_permission_request_decisions WHERE sequence = 1`); err == nil {
		t.Fatal("authorization history delete unexpectedly succeeded")
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenSQLite(ctx, path, identity, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopened.Close() }()
	if _, err := reopened.PermissionGrants().Get(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reopened revoked grant became active: %v", err)
	}
	var historyCount int
	if err := reopened.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM local_app_permission_request_decisions`).Scan(&historyCount); err != nil || historyCount != 3 {
		t.Fatalf("reopened authorization history = (%d, %v)", historyCount, err)
	}
}

func TestPermissionGrantStoreRejectsMissingOrWrongPartitionBindings(t *testing.T) {
	kernel := openTestKernel(t, Options{})
	defer func() { _ = kernel.Close() }()
	base := PermissionGrantKey{LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one",
		LocalAppPrincipalID: "lap_v1_missing", PermissionID: "agents.interact", OwnerSelectorDigest: "selector-one"}
	missing := base
	missing.AccountID = ""
	if _, err := kernel.PermissionGrants().Get(context.Background(), missing); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("missing binding error = %v", err)
	}
	wrongAnchor := base
	wrongAnchor.LocalOSUserAnchor = "loua_v1_other"
	if _, err := kernel.PermissionGrants().Get(context.Background(), wrongAnchor); !errors.Is(err, ErrPartitionMismatch) {
		t.Fatalf("wrong anchor error = %v", err)
	}
}
