package localappkernel

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type PrincipalStore struct {
	kernel *Kernel
}

func (store *PrincipalStore) Create(ctx context.Context, input CreatePrincipalInput) (Principal, error) {
	if store == nil || store.kernel == nil {
		return Principal{}, fmt.Errorf("%w: principal store", ErrInvalidArgument)
	}
	if err := validatePrincipalInput(input); err != nil {
		return Principal{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	identifier, err := store.kernel.nextIdentifier("lap_v1_", func(candidate string) (bool, error) {
		var found int
		err := store.kernel.db.QueryRowContext(ctx, `SELECT 1 FROM local_app_principals WHERE local_app_principal_id = ?`, candidate).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	})
	if err != nil {
		return Principal{}, fmt.Errorf("create local-app principal: %w", err)
	}
	now := store.kernel.now().UTC()
	if _, err := store.kernel.db.ExecContext(ctx, `INSERT INTO local_app_principals(
		local_os_user_anchor, local_app_principal_id, principal_kind, app_id,
		immutable_lineage_id, development_authorization_id, canonical_project_file_id,
		state, created_unix_nano, tombstoned_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)`,
		store.kernel.anchor, identifier, string(input.Kind), input.AppID,
		nullableText(input.ImmutableLineageID), nullableText(input.DevelopmentAuthorizationID), nullableText(input.CanonicalProjectFileID), now.UnixNano()); err != nil {
		return Principal{}, fmt.Errorf("insert local-app principal: %w", err)
	}
	return Principal{
		LocalOSUserAnchor:          store.kernel.anchor,
		LocalAppPrincipalID:        identifier,
		Kind:                       input.Kind,
		AppID:                      input.AppID,
		ImmutableLineageID:         input.ImmutableLineageID,
		DevelopmentAuthorizationID: input.DevelopmentAuthorizationID,
		CanonicalProjectFileID:     input.CanonicalProjectFileID,
		State:                      PrincipalStateActive,
		CreatedAt:                  now,
	}, nil
}

func (store *PrincipalStore) Get(ctx context.Context, principalID string) (Principal, error) {
	if store == nil || store.kernel == nil {
		return Principal{}, fmt.Errorf("%w: principal store", ErrInvalidArgument)
	}
	if err := requireExactText("local_app_principal_id", principalID); err != nil {
		return Principal{}, err
	}
	return scanPrincipal(store.kernel.db.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, local_app_principal_id, principal_kind, app_id,
		immutable_lineage_id, development_authorization_id, canonical_project_file_id,
		state, created_unix_nano, tombstoned_unix_nano
		FROM local_app_principals WHERE local_os_user_anchor = ? AND local_app_principal_id = ?`, store.kernel.anchor, principalID))
}

// Tombstone permanently retires the principal and removes its current
// lifecycle record. Existing grant rows remain historical K-GRANT truth and
// cannot authorize because all positive grant reads require an active principal.
func (store *PrincipalStore) Tombstone(ctx context.Context, principalID string) (Principal, error) {
	if store == nil || store.kernel == nil {
		return Principal{}, fmt.Errorf("%w: principal store", ErrInvalidArgument)
	}
	if err := requireExactText("local_app_principal_id", principalID); err != nil {
		return Principal{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return Principal{}, fmt.Errorf("begin tombstone principal: %w", err)
	}
	defer tx.Rollback()
	principal, err := scanPrincipal(tx.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, local_app_principal_id, principal_kind, app_id,
		immutable_lineage_id, development_authorization_id, canonical_project_file_id,
		state, created_unix_nano, tombstoned_unix_nano
		FROM local_app_principals WHERE local_os_user_anchor = ? AND local_app_principal_id = ?`, store.kernel.anchor, principalID))
	if err != nil {
		return Principal{}, err
	}
	if principal.State == PrincipalStateTombstoned {
		return Principal{}, ErrPrincipalTombstoned
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM local_app_records WHERE local_os_user_anchor = ? AND local_app_principal_id = ?`, store.kernel.anchor, principalID); err != nil {
		return Principal{}, fmt.Errorf("remove tombstoned local-app record: %w", err)
	}
	now := store.kernel.now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE local_app_principals SET state = 'tombstoned', tombstoned_unix_nano = ?
		WHERE local_os_user_anchor = ? AND local_app_principal_id = ? AND state = 'active'`, now.UnixNano(), store.kernel.anchor, principalID)
	if err != nil {
		return Principal{}, fmt.Errorf("tombstone local-app principal: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return Principal{}, ErrStateConflict
	}
	if err := tx.Commit(); err != nil {
		return Principal{}, fmt.Errorf("commit tombstone principal: %w", err)
	}
	principal.State = PrincipalStateTombstoned
	principal.TombstonedAt = &now
	return principal, nil
}

func scanPrincipal(row interface{ Scan(...any) error }) (Principal, error) {
	var principal Principal
	var kind string
	var state string
	var immutableLineage sql.NullString
	var developmentAuthorization sql.NullString
	var canonicalProjectFile sql.NullString
	var createdUnixNano int64
	var tombstonedUnixNano sql.NullInt64
	if err := row.Scan(
		&principal.LocalOSUserAnchor, &principal.LocalAppPrincipalID, &kind, &principal.AppID,
		&immutableLineage, &developmentAuthorization, &canonicalProjectFile,
		&state, &createdUnixNano, &tombstonedUnixNano,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Principal{}, ErrNotFound
		}
		return Principal{}, fmt.Errorf("scan local-app principal: %w", err)
	}
	principal.Kind = PrincipalKind(kind)
	principal.State = PrincipalState(state)
	principal.ImmutableLineageID = immutableLineage.String
	principal.DevelopmentAuthorizationID = developmentAuthorization.String
	principal.CanonicalProjectFileID = canonicalProjectFile.String
	principal.CreatedAt = time.Unix(0, createdUnixNano).UTC()
	if tombstonedUnixNano.Valid {
		tombstonedAt := time.Unix(0, tombstonedUnixNano.Int64).UTC()
		principal.TombstonedAt = &tombstonedAt
	}
	return principal, nil
}
