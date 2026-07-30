package localappkernel

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestPermissionLifecycleMigrationKeepsHistoryAndOnlyActiveTruth(t *testing.T) {
	ctx := context.Background()
	identity, err := ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	anchor, err := identity.LocalOSUserAnchor()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "legacy-local-app.db")
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path))
	if err != nil {
		t.Fatal(err)
	}
	statements := []string{
		`CREATE TABLE local_app_principals (
			local_os_user_anchor TEXT NOT NULL, local_app_principal_id TEXT NOT NULL, principal_kind TEXT NOT NULL,
			app_id TEXT NOT NULL, immutable_lineage_id TEXT, development_authorization_id TEXT,
			canonical_project_file_id TEXT, state TEXT NOT NULL, created_unix_nano INTEGER NOT NULL,
			tombstoned_unix_nano INTEGER, PRIMARY KEY(local_os_user_anchor, local_app_principal_id))`,
		`CREATE TABLE local_app_permission_requests (
			local_os_user_anchor TEXT, account_id TEXT, local_app_principal_id TEXT, permission_id TEXT,
			display_app_id TEXT, reason TEXT, revision INTEGER, requested_unix_nano INTEGER, created_unix_nano INTEGER)`,
		`CREATE TABLE local_app_permission_request_history (
			local_os_user_anchor TEXT, account_id TEXT, local_app_principal_id TEXT, permission_id TEXT,
			display_app_id TEXT, reason TEXT, revision INTEGER, requested_unix_nano INTEGER)`,
		`CREATE TABLE local_app_permission_request_decisions (
			local_os_user_anchor TEXT, account_id TEXT, local_app_principal_id TEXT, permission_id TEXT,
			state TEXT, owner_selector_digest TEXT, revision INTEGER, decided_unix_nano INTEGER)`,
		`CREATE TABLE local_app_permission_grants (
			local_os_user_anchor TEXT, account_id TEXT, local_app_principal_id TEXT, permission_id TEXT,
			owner_selector_digest TEXT, state TEXT, revision INTEGER, expires_unix_nano INTEGER,
			created_unix_nano INTEGER, updated_unix_nano INTEGER)`,
		`CREATE TABLE local_app_permission_grant_history (
			local_os_user_anchor TEXT, account_id TEXT, local_app_principal_id TEXT, permission_id TEXT,
			owner_selector_digest TEXT, state TEXT, revision INTEGER, expires_unix_nano INTEGER, recorded_unix_nano INTEGER)`,
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO local_app_principals VALUES (?, 'lap_legacy', 'development',
		'legacy.app', NULL, 'legacy-auth', 'legacy-file', 'active', 1, NULL)`, anchor); err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		permission string
		state      string
		selector   any
	}{
		{permission: "agents.interact", state: "denied", selector: nil},
		{permission: "agents.configure", state: "granted", selector: "selector-legacy"},
	} {
		if _, err := db.ExecContext(ctx, `INSERT INTO local_app_permission_requests VALUES (?, 'account-one', 'lap_legacy', ?,
			'legacy.app', 'Legacy request', 1, 1, 1)`, anchor, row.permission); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO local_app_permission_request_history VALUES (?, 'account-one', 'lap_legacy', ?,
			'legacy.app', 'Legacy request', 1, 1)`, anchor, row.permission); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO local_app_permission_request_decisions VALUES (?, 'account-one', 'lap_legacy', ?, ?, ?, 2, 2)`,
			anchor, row.permission, row.state, row.selector); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO local_app_permission_grants VALUES (?, 'account-one', 'lap_legacy',
		'agents.configure', 'selector-legacy', 'revoked', 3, NULL, 2, 3)`, anchor); err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"granted", "revoked"} {
		revision := 2
		if state == "revoked" {
			revision = 3
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO local_app_permission_grant_history VALUES (?, 'account-one', 'lap_legacy',
			'agents.configure', 'selector-legacy', ?, ?, NULL, ?)`, anchor, state, revision, revision); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	kernel, err := OpenSQLite(ctx, path, identity, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = kernel.Close() }()
	grants, err := kernel.PermissionGrants().ListActive(ctx, anchor, "account-one")
	if err != nil || len(grants) != 0 {
		t.Fatalf("legacy terminal grant became current = (%+v, %v)", grants, err)
	}
	pending, err := kernel.PermissionGrants().ListPendingRequests(ctx, anchor, "account-one")
	if err != nil || len(pending) != 0 {
		t.Fatalf("legacy decided request became pending = (%+v, %v)", pending, err)
	}
	var actions string
	if err := kernel.db.QueryRowContext(ctx, `SELECT group_concat(action, ',') FROM (
		SELECT action FROM local_app_permission_request_decisions ORDER BY sequence)`).Scan(&actions); err != nil {
		t.Fatal(err)
	}
	if actions != "reject,accept,revoke" {
		t.Fatalf("migrated authorization history = %q", actions)
	}
}
