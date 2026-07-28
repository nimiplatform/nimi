package localappkernel

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// PermissionGrantStore owns the durable five-binding Runtime permission truth.
// Its SQLite connection and OS-user partition are the same ones used by the
// local-app principal and lifecycle stores.
type PermissionGrantStore struct {
	kernel *Kernel
}

func (store *PermissionGrantStore) CreatePending(ctx context.Context, input CreatePermissionGrantInput) (PermissionGrant, error) {
	if store == nil || store.kernel == nil {
		return PermissionGrant{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validateKey(input.Key); err != nil {
		return PermissionGrant{}, err
	}
	expiresAt, err := canonicalOptionalTime(input.ExpiresAt)
	if err != nil {
		return PermissionGrant{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PermissionGrant{}, fmt.Errorf("begin create local-app permission grant: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	now := store.kernel.now().UTC()
	key := input.Key
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_grants(
		local_os_user_anchor, account_id, local_app_principal_id, permission_id, owner_selector_digest,
		state, revision, expires_unix_nano, created_unix_nano, updated_unix_nano
	) VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)`, key.LocalOSUserAnchor, key.AccountID,
		key.LocalAppPrincipalID, key.PermissionID, key.OwnerSelectorDigest, nullableUnixNano(expiresAt), now.UnixNano(), now.UnixNano()); err != nil {
		return PermissionGrant{}, fmt.Errorf("insert local-app permission grant: %w", err)
	}
	if err := insertPermissionGrantHistory(ctx, tx, key, PermissionGrantStatePending, 1, expiresAt, now); err != nil {
		return PermissionGrant{}, err
	}
	if err := tx.Commit(); err != nil {
		return PermissionGrant{}, fmt.Errorf("commit local-app permission grant: %w", err)
	}
	return PermissionGrant{Key: key, State: PermissionGrantStatePending, Revision: 1, ExpiresAt: expiresAt, CreatedAt: now, UpdatedAt: now}, nil
}

func (store *PermissionGrantStore) Get(ctx context.Context, key PermissionGrantKey) (PermissionGrant, error) {
	if store == nil || store.kernel == nil {
		return PermissionGrant{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validateKey(key); err != nil {
		return PermissionGrant{}, err
	}
	return scanPermissionGrant(store.kernel.db.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, account_id, local_app_principal_id, permission_id, owner_selector_digest,
		state, revision, expires_unix_nano, created_unix_nano, updated_unix_nano
		FROM local_app_permission_grants
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ?
		AND permission_id = ? AND owner_selector_digest = ?`, key.LocalOSUserAnchor, key.AccountID,
		key.LocalAppPrincipalID, key.PermissionID, key.OwnerSelectorDigest))
}

func (store *PermissionGrantStore) ListForPrincipal(ctx context.Context, localOSUserAnchor string, accountID string, localAppPrincipalID string, permissionID string) ([]PermissionGrant, error) {
	if store == nil || store.kernel == nil {
		return nil, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	for name, value := range map[string]string{"local_os_user_anchor": localOSUserAnchor, "account_id": accountID, "local_app_principal_id": localAppPrincipalID, "permission_id": permissionID} {
		if err := requireExactText(name, value); err != nil {
			return nil, err
		}
	}
	if localOSUserAnchor != store.kernel.anchor {
		return nil, ErrPartitionMismatch
	}
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT
		local_os_user_anchor, account_id, local_app_principal_id, permission_id, owner_selector_digest,
		state, revision, expires_unix_nano, created_unix_nano, updated_unix_nano
		FROM local_app_permission_grants
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND permission_id = ?
		ORDER BY updated_unix_nano DESC, owner_selector_digest`, localOSUserAnchor, accountID, localAppPrincipalID, permissionID)
	if err != nil {
		return nil, fmt.Errorf("list local-app permission grants: %w", err)
	}
	defer func() { _ = rows.Close() }()
	grants := make([]PermissionGrant, 0)
	for rows.Next() {
		grant, scanErr := scanPermissionGrant(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		grants = append(grants, grant)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read local-app permission grants: %w", err)
	}
	return grants, nil
}

func (store *PermissionGrantStore) Transition(ctx context.Context, input TransitionPermissionGrantInput) (PermissionGrant, error) {
	if store == nil || store.kernel == nil {
		return PermissionGrant{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validateKey(input.Key); err != nil {
		return PermissionGrant{}, err
	}
	if input.ExpectedRevision == 0 || !validPermissionGrantState(input.State) {
		return PermissionGrant{}, fmt.Errorf("%w: permission state or expected revision", ErrInvalidArgument)
	}
	expiresAt, err := canonicalOptionalTime(input.ExpiresAt)
	if err != nil {
		return PermissionGrant{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PermissionGrant{}, fmt.Errorf("begin transition local-app permission grant: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	current, err := scanPermissionGrant(tx.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, account_id, local_app_principal_id, permission_id, owner_selector_digest,
		state, revision, expires_unix_nano, created_unix_nano, updated_unix_nano
		FROM local_app_permission_grants
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ?
		AND permission_id = ? AND owner_selector_digest = ?`, input.Key.LocalOSUserAnchor, input.Key.AccountID,
		input.Key.LocalAppPrincipalID, input.Key.PermissionID, input.Key.OwnerSelectorDigest))
	if err != nil {
		return PermissionGrant{}, err
	}
	if current.Revision != input.ExpectedRevision {
		return PermissionGrant{}, ErrPermissionRevisionConflict
	}
	nextRevision := current.Revision + 1
	now := store.kernel.now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE local_app_permission_grants
		SET state = ?, revision = ?, expires_unix_nano = ?, updated_unix_nano = ?
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ?
		AND permission_id = ? AND owner_selector_digest = ? AND revision = ?`, string(input.State), nextRevision,
		nullableUnixNano(expiresAt), now.UnixNano(), input.Key.LocalOSUserAnchor, input.Key.AccountID,
		input.Key.LocalAppPrincipalID, input.Key.PermissionID, input.Key.OwnerSelectorDigest, input.ExpectedRevision)
	if err != nil {
		return PermissionGrant{}, fmt.Errorf("update local-app permission grant: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return PermissionGrant{}, ErrPermissionRevisionConflict
	}
	if err := insertPermissionGrantHistory(ctx, tx, input.Key, input.State, nextRevision, expiresAt, now); err != nil {
		return PermissionGrant{}, err
	}
	if err := tx.Commit(); err != nil {
		return PermissionGrant{}, fmt.Errorf("commit local-app permission transition: %w", err)
	}
	current.State = input.State
	current.Revision = nextRevision
	current.ExpiresAt = expiresAt
	current.UpdatedAt = now
	return current, nil
}

func (store *PermissionGrantStore) validateKey(key PermissionGrantKey) error {
	if err := validatePermissionGrantKey(key); err != nil {
		return err
	}
	if key.LocalOSUserAnchor != store.kernel.anchor {
		return ErrPartitionMismatch
	}
	return nil
}

func insertPermissionGrantHistory(ctx context.Context, tx *sql.Tx, key PermissionGrantKey, state PermissionGrantState, revision uint64, expiresAt *time.Time, recordedAt time.Time) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_grant_history(
		local_os_user_anchor, account_id, local_app_principal_id, permission_id, owner_selector_digest,
		state, revision, expires_unix_nano, recorded_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, key.LocalOSUserAnchor, key.AccountID, key.LocalAppPrincipalID,
		key.PermissionID, key.OwnerSelectorDigest, string(state), revision, nullableUnixNano(expiresAt), recordedAt.UnixNano()); err != nil {
		return fmt.Errorf("insert local-app permission grant history: %w", err)
	}
	return nil
}

func scanPermissionGrant(row interface{ Scan(...any) error }) (PermissionGrant, error) {
	var grant PermissionGrant
	var state string
	var revision int64
	var expiresUnixNano sql.NullInt64
	var createdUnixNano int64
	var updatedUnixNano int64
	if err := row.Scan(&grant.Key.LocalOSUserAnchor, &grant.Key.AccountID, &grant.Key.LocalAppPrincipalID,
		&grant.Key.PermissionID, &grant.Key.OwnerSelectorDigest, &state, &revision, &expiresUnixNano,
		&createdUnixNano, &updatedUnixNano); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PermissionGrant{}, ErrNotFound
		}
		return PermissionGrant{}, fmt.Errorf("scan local-app permission grant: %w", err)
	}
	grant.State = PermissionGrantState(state)
	grant.Revision = uint64(revision)
	grant.CreatedAt = time.Unix(0, createdUnixNano).UTC()
	grant.UpdatedAt = time.Unix(0, updatedUnixNano).UTC()
	if expiresUnixNano.Valid {
		expiresAt := time.Unix(0, expiresUnixNano.Int64).UTC()
		grant.ExpiresAt = &expiresAt
	}
	if !validPermissionGrantState(grant.State) || grant.Revision == 0 {
		return PermissionGrant{}, fmt.Errorf("%w: persisted permission grant", ErrStateConflict)
	}
	return grant, nil
}

func canonicalOptionalTime(value *time.Time) (*time.Time, error) {
	if value == nil {
		return nil, nil
	}
	if value.IsZero() || value.Location() != time.UTC {
		return nil, fmt.Errorf("%w: permission expiry must be a UTC instant", ErrInvalidArgument)
	}
	canonical := value.UTC()
	return &canonical, nil
}

func nullableUnixNano(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UnixNano()
}
