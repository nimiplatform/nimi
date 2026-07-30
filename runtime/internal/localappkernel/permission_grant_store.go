package localappkernel

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// PermissionGrantStore owns active Runtime permission truth plus append-only
// request and authorization history. A missing active row is the only
// non-granted current state.
type PermissionGrantStore struct {
	kernel *Kernel
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
		request_id, state, revision, expires_unix_nano, created_unix_nano, updated_unix_nano
		FROM local_app_permission_grants
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ?
		AND permission_id = ? AND owner_selector_digest = ?`, key.LocalOSUserAnchor, key.AccountID,
		key.LocalAppPrincipalID, key.PermissionID, key.OwnerSelectorDigest))
}

func (store *PermissionGrantStore) ListForPrincipal(ctx context.Context, localOSUserAnchor, accountID, localAppPrincipalID, permissionID string) ([]PermissionGrant, error) {
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
	return store.listGrants(ctx, `WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND permission_id = ?
		ORDER BY updated_unix_nano DESC, owner_selector_digest`, localOSUserAnchor, accountID, localAppPrincipalID, permissionID)
}

func (store *PermissionGrantStore) ListActiveForPrincipal(ctx context.Context, localOSUserAnchor, accountID, localAppPrincipalID string) ([]PermissionGrant, error) {
	if err := store.validatePermissionRequestPrincipal(localOSUserAnchor, accountID, localAppPrincipalID); err != nil {
		return nil, err
	}
	return store.listGrants(ctx, `WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ?
		ORDER BY permission_id, updated_unix_nano DESC`, localOSUserAnchor, accountID, localAppPrincipalID)
}

func (store *PermissionGrantStore) ListActive(ctx context.Context, localOSUserAnchor, accountID string) ([]PermissionGrant, error) {
	if err := store.validatePermissionRequestPartition(localOSUserAnchor, accountID); err != nil {
		return nil, err
	}
	return store.listGrants(ctx, `WHERE local_os_user_anchor = ? AND account_id = ?
		ORDER BY local_app_principal_id, permission_id, updated_unix_nano DESC`, localOSUserAnchor, accountID)
}

func (store *PermissionGrantStore) listGrants(ctx context.Context, suffix string, args ...any) ([]PermissionGrant, error) {
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT local_os_user_anchor, account_id, local_app_principal_id,
		permission_id, owner_selector_digest, request_id, state, revision, expires_unix_nano, created_unix_nano, updated_unix_nano
		FROM local_app_permission_grants `+suffix, args...)
	if err != nil {
		return nil, fmt.Errorf("list active local-app permission grants: %w", err)
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
		return nil, fmt.Errorf("read active local-app permission grants: %w", err)
	}
	return grants, nil
}

func (store *PermissionGrantStore) Revoke(ctx context.Context, input RevokePermissionGrantInput) (PermissionRequestDecision, error) {
	if store == nil || store.kernel == nil {
		return PermissionRequestDecision{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validateKey(input.Key); err != nil {
		return PermissionRequestDecision{}, err
	}
	if input.ExpectedRevision == 0 {
		return PermissionRequestDecision{}, fmt.Errorf("%w: permission grant revision", ErrInvalidArgument)
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("begin revoke local-app permission grant: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	grant, err := scanPermissionGrant(tx.QueryRowContext(ctx, `SELECT local_os_user_anchor, account_id,
		local_app_principal_id, permission_id, owner_selector_digest, request_id, state, revision, expires_unix_nano,
		created_unix_nano, updated_unix_nano FROM local_app_permission_grants WHERE local_os_user_anchor = ?
		AND account_id = ? AND local_app_principal_id = ? AND permission_id = ? AND owner_selector_digest = ?`,
		input.Key.LocalOSUserAnchor, input.Key.AccountID, input.Key.LocalAppPrincipalID, input.Key.PermissionID, input.Key.OwnerSelectorDigest))
	if err != nil {
		return PermissionRequestDecision{}, err
	}
	if grant.Revision != input.ExpectedRevision {
		return PermissionRequestDecision{}, ErrPermissionRevisionConflict
	}
	nextRevision := grant.Revision + 1
	now := store.kernel.now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_request_decisions(local_os_user_anchor,
		account_id, local_app_principal_id, permission_id, request_id, display_app_id, reason, action,
		owner_selector_digest, revision, decided_unix_nano)
		SELECT ?, ?, ?, ?, ?, p.app_id, 'Owner revoked active permission', 'revoke', ?, ?, ?
		FROM local_app_principals p WHERE p.local_os_user_anchor = ? AND p.local_app_principal_id = ?`,
		input.Key.LocalOSUserAnchor, input.Key.AccountID, input.Key.LocalAppPrincipalID, input.Key.PermissionID,
		grant.RequestID, input.Key.OwnerSelectorDigest, nextRevision, now.UnixNano(), input.Key.LocalOSUserAnchor,
		input.Key.LocalAppPrincipalID); err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("append local-app permission revoke history: %w", err)
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM local_app_permission_grants WHERE local_os_user_anchor = ?
		AND account_id = ? AND local_app_principal_id = ? AND permission_id = ? AND owner_selector_digest = ? AND revision = ?`,
		input.Key.LocalOSUserAnchor, input.Key.AccountID, input.Key.LocalAppPrincipalID, input.Key.PermissionID,
		input.Key.OwnerSelectorDigest, input.ExpectedRevision)
	if err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("remove active local-app permission: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return PermissionRequestDecision{}, ErrPermissionRevisionConflict
	}
	if err := tx.Commit(); err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("commit local-app permission revoke: %w", err)
	}
	return PermissionRequestDecision{LocalOSUserAnchor: input.Key.LocalOSUserAnchor, AccountID: input.Key.AccountID,
		LocalAppPrincipalID: input.Key.LocalAppPrincipalID, PermissionID: input.Key.PermissionID, RequestID: grant.RequestID,
		Action: PermissionAuthorizationActionRevoke, State: PermissionGrantStateRevoked,
		OwnerSelectorDigest: input.Key.OwnerSelectorDigest, Revision: nextRevision, DecidedAt: now}, nil
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

func scanPermissionGrant(row interface{ Scan(...any) error }) (PermissionGrant, error) {
	var grant PermissionGrant
	var state string
	var revision int64
	var expiresUnixNano sql.NullInt64
	var createdUnixNano int64
	var updatedUnixNano int64
	if err := row.Scan(&grant.Key.LocalOSUserAnchor, &grant.Key.AccountID, &grant.Key.LocalAppPrincipalID,
		&grant.Key.PermissionID, &grant.Key.OwnerSelectorDigest, &grant.RequestID, &state, &revision, &expiresUnixNano,
		&createdUnixNano, &updatedUnixNano); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PermissionGrant{}, ErrNotFound
		}
		return PermissionGrant{}, fmt.Errorf("scan active local-app permission grant: %w", err)
	}
	grant.State = PermissionGrantState(state)
	grant.Revision = uint64(revision)
	grant.CreatedAt = time.Unix(0, createdUnixNano).UTC()
	grant.UpdatedAt = time.Unix(0, updatedUnixNano).UTC()
	if expiresUnixNano.Valid {
		expiresAt := time.Unix(0, expiresUnixNano.Int64).UTC()
		grant.ExpiresAt = &expiresAt
	}
	if grant.State != PermissionGrantStateGranted || grant.RequestID == "" || grant.Revision == 0 {
		return PermissionGrant{}, fmt.Errorf("%w: persisted active permission grant", ErrStateConflict)
	}
	return grant, nil
}
