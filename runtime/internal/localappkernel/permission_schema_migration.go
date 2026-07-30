package localappkernel

import (
	"context"
	"fmt"
)

// migratePermissionLifecycleSchema performs the one-way active/none cutover.
// Legacy terminal rows become immutable authorization history; only legacy
// granted rows remain current active truth.
func (kernel *Kernel) migratePermissionLifecycleSchema(ctx context.Context) (returnErr error) {
	var exists int
	if err := kernel.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'local_app_permission_requests'`).Scan(&exists); err != nil {
		return fmt.Errorf("inspect local-app permission schema: %w", err)
	}
	if exists == 0 {
		return nil
	}
	var requestIDColumn int
	if err := kernel.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_table_info('local_app_permission_requests') WHERE name = 'request_id'`).Scan(&requestIDColumn); err != nil {
		return fmt.Errorf("inspect local-app permission request schema: %w", err)
	}
	if requestIDColumn == 1 {
		return nil
	}
	if _, err := kernel.db.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return fmt.Errorf("disable foreign keys for permission lifecycle migration: %w", err)
	}
	defer func() {
		if _, err := kernel.db.ExecContext(ctx, `PRAGMA foreign_keys = ON`); returnErr == nil && err != nil {
			returnErr = fmt.Errorf("restore foreign keys after permission lifecycle migration: %w", err)
		}
	}()
	tx, err := kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin permission lifecycle migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	statements := []string{
		`DROP TRIGGER IF EXISTS local_app_permission_request_history_immutable_update`,
		`DROP TRIGGER IF EXISTS local_app_permission_request_history_immutable_delete`,
		`DROP TRIGGER IF EXISTS local_app_permission_request_decision_immutable_update`,
		`DROP TRIGGER IF EXISTS local_app_permission_request_decision_immutable_delete`,
		`DROP TRIGGER IF EXISTS local_app_permission_grant_history_immutable_update`,
		`DROP TRIGGER IF EXISTS local_app_permission_grant_history_immutable_delete`,
		`ALTER TABLE local_app_permission_requests RENAME TO local_app_permission_requests_legacy`,
		`ALTER TABLE local_app_permission_request_history RENAME TO local_app_permission_request_history_legacy`,
		`ALTER TABLE local_app_permission_request_decisions RENAME TO local_app_permission_request_decisions_legacy`,
		`ALTER TABLE local_app_permission_grants RENAME TO local_app_permission_grants_legacy`,
		`ALTER TABLE local_app_permission_grant_history RENAME TO local_app_permission_grant_history_legacy`,
		`CREATE TABLE local_app_permission_requests (
			local_os_user_anchor TEXT NOT NULL, account_id TEXT NOT NULL, local_app_principal_id TEXT NOT NULL,
			permission_id TEXT NOT NULL, request_id TEXT NOT NULL, display_app_id TEXT NOT NULL, reason TEXT NOT NULL,
			revision INTEGER NOT NULL CHECK(revision > 0), requested_unix_nano INTEGER NOT NULL, created_unix_nano INTEGER NOT NULL,
			PRIMARY KEY(local_os_user_anchor, account_id, local_app_principal_id, permission_id),
			UNIQUE(local_os_user_anchor, account_id, local_app_principal_id, request_id),
			FOREIGN KEY(local_os_user_anchor, local_app_principal_id) REFERENCES local_app_principals(local_os_user_anchor, local_app_principal_id))`,
		`CREATE TABLE local_app_permission_request_history (
			local_os_user_anchor TEXT NOT NULL, account_id TEXT NOT NULL, local_app_principal_id TEXT NOT NULL,
			permission_id TEXT NOT NULL, cycle_request_id TEXT NOT NULL, request_id TEXT NOT NULL,
			display_app_id TEXT NOT NULL, reason TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
			requested_unix_nano INTEGER NOT NULL,
			PRIMARY KEY(local_os_user_anchor, account_id, local_app_principal_id, permission_id, revision))`,
		`CREATE TABLE local_app_permission_request_decisions (
			sequence INTEGER PRIMARY KEY AUTOINCREMENT, local_os_user_anchor TEXT NOT NULL, account_id TEXT NOT NULL,
			local_app_principal_id TEXT NOT NULL, permission_id TEXT NOT NULL, request_id TEXT NOT NULL,
			display_app_id TEXT NOT NULL, reason TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('accept','reject','revoke')),
			owner_selector_digest TEXT, revision INTEGER NOT NULL CHECK(revision > 1), decided_unix_nano INTEGER NOT NULL,
			UNIQUE(local_os_user_anchor, account_id, local_app_principal_id, permission_id, revision),
			CHECK((action = 'reject' AND owner_selector_digest IS NULL) OR (action IN ('accept','revoke') AND owner_selector_digest IS NOT NULL)))`,
		`CREATE TABLE local_app_permission_grants (
			local_os_user_anchor TEXT NOT NULL, account_id TEXT NOT NULL, local_app_principal_id TEXT NOT NULL,
			permission_id TEXT NOT NULL, owner_selector_digest TEXT NOT NULL, request_id TEXT NOT NULL,
			state TEXT NOT NULL CHECK(state = 'granted'), revision INTEGER NOT NULL CHECK(revision > 0), expires_unix_nano INTEGER,
			created_unix_nano INTEGER NOT NULL, updated_unix_nano INTEGER NOT NULL,
			PRIMARY KEY(local_os_user_anchor, account_id, local_app_principal_id, permission_id, owner_selector_digest),
			FOREIGN KEY(local_os_user_anchor, local_app_principal_id) REFERENCES local_app_principals(local_os_user_anchor, local_app_principal_id))`,
		`INSERT INTO local_app_permission_requests
			SELECT r.local_os_user_anchor, r.account_id, r.local_app_principal_id, r.permission_id,
			'legacy-request-' || r.rowid, r.display_app_id, r.reason, r.revision, r.requested_unix_nano, r.created_unix_nano
			FROM local_app_permission_requests_legacy r WHERE NOT EXISTS (
				SELECT 1 FROM local_app_permission_request_decisions_legacy d
				WHERE d.local_os_user_anchor = r.local_os_user_anchor AND d.account_id = r.account_id
				AND d.local_app_principal_id = r.local_app_principal_id AND d.permission_id = r.permission_id)`,
		`INSERT INTO local_app_permission_request_history
			SELECT h.local_os_user_anchor, h.account_id, h.local_app_principal_id, h.permission_id,
			'legacy-request-' || r.rowid, 'legacy-request-' || r.rowid, h.display_app_id, h.reason, h.revision, h.requested_unix_nano
			FROM local_app_permission_request_history_legacy h JOIN local_app_permission_requests_legacy r
			ON r.local_os_user_anchor = h.local_os_user_anchor AND r.account_id = h.account_id
			AND r.local_app_principal_id = h.local_app_principal_id AND r.permission_id = h.permission_id`,
		`INSERT INTO local_app_permission_request_decisions(local_os_user_anchor, account_id, local_app_principal_id,
			permission_id, request_id, display_app_id, reason, action, owner_selector_digest, revision, decided_unix_nano)
			SELECT d.local_os_user_anchor, d.account_id, d.local_app_principal_id, d.permission_id,
			'legacy-request-' || r.rowid, r.display_app_id, r.reason,
			CASE d.state WHEN 'granted' THEN 'accept' ELSE 'reject' END, d.owner_selector_digest, d.revision, d.decided_unix_nano
			FROM local_app_permission_request_decisions_legacy d JOIN local_app_permission_requests_legacy r
			ON r.local_os_user_anchor = d.local_os_user_anchor AND r.account_id = d.account_id
			AND r.local_app_principal_id = d.local_app_principal_id AND r.permission_id = d.permission_id`,
		`INSERT INTO local_app_permission_grants
			SELECT g.local_os_user_anchor, g.account_id, g.local_app_principal_id, g.permission_id, g.owner_selector_digest,
			COALESCE((SELECT 'legacy-request-' || r.rowid FROM local_app_permission_requests_legacy r
				WHERE r.local_os_user_anchor = g.local_os_user_anchor AND r.account_id = g.account_id
				AND r.local_app_principal_id = g.local_app_principal_id AND r.permission_id = g.permission_id),
				'legacy-grant-' || g.rowid), 'granted', g.revision, g.expires_unix_nano, g.created_unix_nano, g.updated_unix_nano
			FROM local_app_permission_grants_legacy g WHERE g.state = 'granted'`,
		`INSERT OR IGNORE INTO local_app_permission_request_decisions(local_os_user_anchor, account_id, local_app_principal_id,
			permission_id, request_id, display_app_id, reason, action, owner_selector_digest, revision, decided_unix_nano)
			SELECT h.local_os_user_anchor, h.account_id, h.local_app_principal_id, h.permission_id,
			COALESCE((SELECT 'legacy-request-' || r.rowid FROM local_app_permission_requests_legacy r
				WHERE r.local_os_user_anchor = h.local_os_user_anchor AND r.account_id = h.account_id
				AND r.local_app_principal_id = h.local_app_principal_id AND r.permission_id = h.permission_id),
				'legacy-grant-history-' || h.rowid), p.app_id, 'Migrated legacy owner revoke', 'revoke',
			h.owner_selector_digest, h.revision, h.recorded_unix_nano
			FROM local_app_permission_grant_history_legacy h JOIN local_app_principals p
			ON p.local_os_user_anchor = h.local_os_user_anchor AND p.local_app_principal_id = h.local_app_principal_id
			WHERE h.state = 'revoked'`,
		`DROP TABLE local_app_permission_grant_history_legacy`,
		`DROP TABLE local_app_permission_request_decisions_legacy`,
		`DROP TABLE local_app_permission_request_history_legacy`,
		`DROP TABLE local_app_permission_grants_legacy`,
		`DROP TABLE local_app_permission_requests_legacy`,
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("migrate permission lifecycle schema: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit permission lifecycle migration: %w", err)
	}
	return nil
}
