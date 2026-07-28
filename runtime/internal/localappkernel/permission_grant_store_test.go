package localappkernel

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestPermissionGrantStorePersistsFiveBindingsAndMonotonicHistory(t *testing.T) {
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
	key := PermissionGrantKey{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one",
		LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact",
		OwnerSelectorDigest: "selector-digest-one",
	}
	pending, err := kernel.PermissionGrants().CreatePending(ctx, CreatePermissionGrantInput{Key: key})
	if err != nil {
		t.Fatal(err)
	}
	if pending.State != PermissionGrantStatePending || pending.Revision != 1 {
		t.Fatalf("pending grant = %+v", pending)
	}
	if _, err := kernel.PermissionGrants().CreatePending(ctx, CreatePermissionGrantInput{Key: key}); err == nil {
		t.Fatal("duplicate five-binding grant was created")
	}
	now = now.Add(time.Second)
	granted, err := kernel.PermissionGrants().Transition(ctx, TransitionPermissionGrantInput{
		Key: key, ExpectedRevision: 1, State: PermissionGrantStateGranted,
	})
	if err != nil {
		t.Fatal(err)
	}
	if granted.Revision != 2 || granted.State != PermissionGrantStateGranted {
		t.Fatalf("granted = %+v", granted)
	}
	if _, err := kernel.PermissionGrants().Transition(ctx, TransitionPermissionGrantInput{
		Key: key, ExpectedRevision: 1, State: PermissionGrantStateRevoked,
	}); !errors.Is(err, ErrPermissionRevisionConflict) {
		t.Fatalf("stale transition error = %v", err)
	}
	now = now.Add(time.Second)
	revoked, err := kernel.PermissionGrants().Transition(ctx, TransitionPermissionGrantInput{
		Key: key, ExpectedRevision: 2, State: PermissionGrantStateRevoked,
	})
	if err != nil {
		t.Fatal(err)
	}
	if revoked.Revision != 3 || revoked.State != PermissionGrantStateRevoked {
		t.Fatalf("revoked = %+v", revoked)
	}
	var historyCount int
	if err := kernel.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM local_app_permission_grant_history
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ?
		AND permission_id = ? AND owner_selector_digest = ?`, key.LocalOSUserAnchor, key.AccountID,
		key.LocalAppPrincipalID, key.PermissionID, key.OwnerSelectorDigest).Scan(&historyCount); err != nil {
		t.Fatal(err)
	}
	if historyCount != 3 {
		t.Fatalf("history count = %d, want 3", historyCount)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenSQLite(ctx, path, identity, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopened.Close() }()
	persisted, err := reopened.PermissionGrants().Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.State != PermissionGrantStateRevoked || persisted.Revision != 3 || persisted.Key != key {
		t.Fatalf("persisted grant = %+v", persisted)
	}
}

func TestPermissionGrantStoreRejectsMissingOrWrongPartitionBindings(t *testing.T) {
	kernel := openTestKernel(t, Options{})
	defer func() { _ = kernel.Close() }()
	base := PermissionGrantKey{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one",
		LocalAppPrincipalID: "lap_v1_missing", PermissionID: "agents.interact", OwnerSelectorDigest: "selector-one",
	}
	missing := base
	missing.AccountID = ""
	if _, err := kernel.PermissionGrants().CreatePending(context.Background(), CreatePermissionGrantInput{Key: missing}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("missing binding error = %v", err)
	}
	wrongAnchor := base
	wrongAnchor.LocalOSUserAnchor = "loua_v1_other"
	if _, err := kernel.PermissionGrants().CreatePending(context.Background(), CreatePermissionGrantInput{Key: wrongAnchor}); !errors.Is(err, ErrPartitionMismatch) {
		t.Fatalf("wrong anchor error = %v", err)
	}
}
