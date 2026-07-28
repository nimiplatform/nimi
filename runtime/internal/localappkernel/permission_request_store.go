package localappkernel

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"
)

func (store *PermissionGrantStore) CreatePendingRequest(ctx context.Context, input CreatePermissionRequestInput) (PermissionRequest, error) {
	if store == nil || store.kernel == nil {
		return PermissionRequest{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequest(input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, input.DisplayAppID, input.Reason); err != nil {
		return PermissionRequest{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PermissionRequest{}, fmt.Errorf("begin create local-app permission request: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	now := store.kernel.now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_requests(
		local_os_user_anchor, account_id, local_app_principal_id, permission_id, display_app_id,
		reason, revision, requested_unix_nano, created_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID,
		input.PermissionID, input.DisplayAppID, input.Reason, now.UnixNano(), now.UnixNano()); err != nil {
		return PermissionRequest{}, fmt.Errorf("insert local-app permission request: %w", err)
	}
	if err := insertPermissionRequestHistory(ctx, tx, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, input.DisplayAppID, input.Reason, 1, now.UnixNano()); err != nil {
		return PermissionRequest{}, err
	}
	if err := tx.Commit(); err != nil {
		return PermissionRequest{}, fmt.Errorf("commit local-app permission request: %w", err)
	}
	return PermissionRequest{LocalOSUserAnchor: input.LocalOSUserAnchor, AccountID: input.AccountID,
		LocalAppPrincipalID: input.LocalAppPrincipalID, PermissionID: input.PermissionID, DisplayAppID: input.DisplayAppID,
		Reason: input.Reason, Revision: 1, RequestedAt: now, CreatedAt: now}, nil
}

func (store *PermissionGrantStore) GetPendingRequest(ctx context.Context, localOSUserAnchor, accountID, localAppPrincipalID, permissionID string) (PermissionRequest, error) {
	if store == nil || store.kernel == nil {
		return PermissionRequest{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequestIdentity(localOSUserAnchor, accountID, localAppPrincipalID, permissionID); err != nil {
		return PermissionRequest{}, err
	}
	return scanPermissionRequest(store.kernel.db.QueryRowContext(ctx, `SELECT r.local_os_user_anchor, r.account_id,
		r.local_app_principal_id, r.permission_id, r.display_app_id, r.reason, r.revision, r.requested_unix_nano, r.created_unix_nano
		FROM local_app_permission_requests r WHERE r.local_os_user_anchor = ? AND r.account_id = ?
		AND r.local_app_principal_id = ? AND r.permission_id = ? AND NOT EXISTS (
			SELECT 1 FROM local_app_permission_request_decisions d WHERE d.local_os_user_anchor = r.local_os_user_anchor
			AND d.account_id = r.account_id AND d.local_app_principal_id = r.local_app_principal_id AND d.permission_id = r.permission_id
		)`, localOSUserAnchor, accountID, localAppPrincipalID, permissionID))
}

func (store *PermissionGrantStore) RefreshPendingRequest(ctx context.Context, input RefreshPermissionRequestInput) (PermissionRequest, error) {
	if store == nil || store.kernel == nil {
		return PermissionRequest{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if input.ExpectedRevision == 0 {
		return PermissionRequest{}, fmt.Errorf("%w: permission request revision", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequest(input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, input.DisplayAppID, input.Reason); err != nil {
		return PermissionRequest{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PermissionRequest{}, fmt.Errorf("begin refresh local-app permission request: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	current, err := scanPermissionRequest(tx.QueryRowContext(ctx, `SELECT r.local_os_user_anchor, r.account_id,
		r.local_app_principal_id, r.permission_id, r.display_app_id, r.reason, r.revision, r.requested_unix_nano, r.created_unix_nano
		FROM local_app_permission_requests r WHERE r.local_os_user_anchor = ? AND r.account_id = ?
		AND r.local_app_principal_id = ? AND r.permission_id = ? AND NOT EXISTS (
			SELECT 1 FROM local_app_permission_request_decisions d WHERE d.local_os_user_anchor = r.local_os_user_anchor
			AND d.account_id = r.account_id AND d.local_app_principal_id = r.local_app_principal_id AND d.permission_id = r.permission_id
		)`, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID))
	if err != nil {
		return PermissionRequest{}, err
	}
	if current.Revision != input.ExpectedRevision {
		return PermissionRequest{}, ErrPermissionRevisionConflict
	}
	nextRevision := current.Revision + 1
	now := store.kernel.now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE local_app_permission_requests SET display_app_id = ?, reason = ?,
		revision = ?, requested_unix_nano = ? WHERE local_os_user_anchor = ? AND account_id = ?
		AND local_app_principal_id = ? AND permission_id = ? AND revision = ?`, input.DisplayAppID, input.Reason,
		nextRevision, now.UnixNano(), input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, input.ExpectedRevision)
	if err != nil {
		return PermissionRequest{}, fmt.Errorf("refresh local-app permission request: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return PermissionRequest{}, ErrPermissionRevisionConflict
	}
	if err := insertPermissionRequestHistory(ctx, tx, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, input.DisplayAppID, input.Reason, nextRevision, now.UnixNano()); err != nil {
		return PermissionRequest{}, err
	}
	if err := tx.Commit(); err != nil {
		return PermissionRequest{}, fmt.Errorf("commit local-app permission request refresh: %w", err)
	}
	current.DisplayAppID = input.DisplayAppID
	current.Reason = input.Reason
	current.Revision = nextRevision
	current.RequestedAt = now
	return current, nil
}

func (store *PermissionGrantStore) ListPermissionRequestsForPrincipal(ctx context.Context, localOSUserAnchor, accountID, localAppPrincipalID string) ([]PermissionRequest, error) {
	if store == nil || store.kernel == nil {
		return nil, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequestPrincipal(localOSUserAnchor, accountID, localAppPrincipalID); err != nil {
		return nil, err
	}
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT local_os_user_anchor, account_id, local_app_principal_id,
		permission_id, display_app_id, reason, revision, requested_unix_nano, created_unix_nano
		FROM local_app_permission_requests WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ?
		ORDER BY permission_id`, localOSUserAnchor, accountID, localAppPrincipalID)
	if err != nil {
		return nil, fmt.Errorf("list local-app permission requests for principal: %w", err)
	}
	defer func() { _ = rows.Close() }()
	requests := make([]PermissionRequest, 0)
	for rows.Next() {
		request, scanErr := scanPermissionRequest(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		requests = append(requests, request)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read local-app permission requests for principal: %w", err)
	}
	return requests, nil
}

func (store *PermissionGrantStore) ListPendingRequests(ctx context.Context, localOSUserAnchor, accountID string) ([]PermissionRequest, error) {
	if store == nil || store.kernel == nil {
		return nil, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequestPartition(localOSUserAnchor, accountID); err != nil {
		return nil, err
	}
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT r.local_os_user_anchor, r.account_id, r.local_app_principal_id,
		r.permission_id, r.display_app_id, r.reason, r.revision, r.requested_unix_nano, r.created_unix_nano
		FROM local_app_permission_requests r WHERE r.local_os_user_anchor = ? AND r.account_id = ? AND NOT EXISTS (
			SELECT 1 FROM local_app_permission_request_decisions d WHERE d.local_os_user_anchor = r.local_os_user_anchor
			AND d.account_id = r.account_id AND d.local_app_principal_id = r.local_app_principal_id AND d.permission_id = r.permission_id
		) ORDER BY r.requested_unix_nano, r.local_app_principal_id, r.permission_id`, localOSUserAnchor, accountID)
	if err != nil {
		return nil, fmt.Errorf("list pending local-app permission requests: %w", err)
	}
	defer func() { _ = rows.Close() }()
	requests := make([]PermissionRequest, 0)
	for rows.Next() {
		request, scanErr := scanPermissionRequest(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		requests = append(requests, request)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read pending local-app permission requests: %w", err)
	}
	return requests, nil
}

func (store *PermissionGrantStore) GetPermissionRequestDecision(ctx context.Context, localOSUserAnchor, accountID, localAppPrincipalID, permissionID string) (PermissionRequestDecision, error) {
	if store == nil || store.kernel == nil {
		return PermissionRequestDecision{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequestIdentity(localOSUserAnchor, accountID, localAppPrincipalID, permissionID); err != nil {
		return PermissionRequestDecision{}, err
	}
	return scanPermissionRequestDecision(store.kernel.db.QueryRowContext(ctx, `SELECT local_os_user_anchor, account_id,
		local_app_principal_id, permission_id, state, owner_selector_digest, revision, decided_unix_nano
		FROM local_app_permission_request_decisions WHERE local_os_user_anchor = ? AND account_id = ?
		AND local_app_principal_id = ? AND permission_id = ?`, localOSUserAnchor, accountID, localAppPrincipalID, permissionID))
}

func (store *PermissionGrantStore) DecidePendingRequest(ctx context.Context, input DecidePermissionRequestInput) (PermissionRequestDecision, error) {
	if store == nil || store.kernel == nil {
		return PermissionRequestDecision{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequestIdentity(input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID); err != nil {
		return PermissionRequestDecision{}, err
	}
	if input.ExpectedRevision == 0 || (input.State != PermissionGrantStateGranted && input.State != PermissionGrantStateDenied) {
		return PermissionRequestDecision{}, fmt.Errorf("%w: permission request decision", ErrInvalidArgument)
	}
	if input.State == PermissionGrantStateGranted {
		if err := requireExactText("owner_selector_digest", input.OwnerSelectorDigest); err != nil {
			return PermissionRequestDecision{}, err
		}
	} else if input.OwnerSelectorDigest != "" {
		return PermissionRequestDecision{}, fmt.Errorf("%w: denied permission request selector", ErrInvalidArgument)
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("begin decide local-app permission request: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	request, err := scanPermissionRequest(tx.QueryRowContext(ctx, `SELECT r.local_os_user_anchor, r.account_id,
		r.local_app_principal_id, r.permission_id, r.display_app_id, r.reason, r.revision, r.requested_unix_nano, r.created_unix_nano
		FROM local_app_permission_requests r WHERE r.local_os_user_anchor = ? AND r.account_id = ?
		AND r.local_app_principal_id = ? AND r.permission_id = ? AND NOT EXISTS (
			SELECT 1 FROM local_app_permission_request_decisions d WHERE d.local_os_user_anchor = r.local_os_user_anchor
			AND d.account_id = r.account_id AND d.local_app_principal_id = r.local_app_principal_id AND d.permission_id = r.permission_id
		)`, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID))
	if err != nil {
		return PermissionRequestDecision{}, err
	}
	if request.Revision != input.ExpectedRevision {
		return PermissionRequestDecision{}, ErrPermissionRevisionConflict
	}
	nextRevision := request.Revision + 1
	now := store.kernel.now().UTC()
	var selectorDigest any
	if input.OwnerSelectorDigest != "" {
		selectorDigest = input.OwnerSelectorDigest
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_request_decisions(local_os_user_anchor,
		account_id, local_app_principal_id, permission_id, state, owner_selector_digest, revision, decided_unix_nano)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID,
		input.PermissionID, string(input.State), selectorDigest, nextRevision, now.UnixNano()); err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("insert local-app permission request decision: %w", err)
	}
	if input.State == PermissionGrantStateGranted {
		key := PermissionGrantKey{LocalOSUserAnchor: input.LocalOSUserAnchor, AccountID: input.AccountID,
			LocalAppPrincipalID: input.LocalAppPrincipalID, PermissionID: input.PermissionID, OwnerSelectorDigest: input.OwnerSelectorDigest}
		if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_grants(local_os_user_anchor, account_id,
			local_app_principal_id, permission_id, owner_selector_digest, state, revision, expires_unix_nano,
			created_unix_nano, updated_unix_nano) VALUES (?, ?, ?, ?, ?, 'granted', ?, NULL, ?, ?)`,
			key.LocalOSUserAnchor, key.AccountID, key.LocalAppPrincipalID, key.PermissionID, key.OwnerSelectorDigest,
			nextRevision, now.UnixNano(), now.UnixNano()); err != nil {
			return PermissionRequestDecision{}, fmt.Errorf("insert granted local-app permission: %w", err)
		}
		if err := insertPermissionGrantHistory(ctx, tx, key, PermissionGrantStateGranted, nextRevision, nil, now); err != nil {
			return PermissionRequestDecision{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("commit local-app permission request decision: %w", err)
	}
	return PermissionRequestDecision{LocalOSUserAnchor: input.LocalOSUserAnchor, AccountID: input.AccountID,
		LocalAppPrincipalID: input.LocalAppPrincipalID, PermissionID: input.PermissionID, State: input.State,
		OwnerSelectorDigest: input.OwnerSelectorDigest, Revision: nextRevision, DecidedAt: now}, nil
}

func (store *PermissionGrantStore) validatePermissionRequestPartition(localOSUserAnchor, accountID string) error {
	for name, value := range map[string]string{"local_os_user_anchor": localOSUserAnchor, "account_id": accountID} {
		if err := requireExactText(name, value); err != nil {
			return err
		}
	}
	if localOSUserAnchor != store.kernel.anchor {
		return ErrPartitionMismatch
	}
	return nil
}

func (store *PermissionGrantStore) validatePermissionRequestPrincipal(localOSUserAnchor, accountID, localAppPrincipalID string) error {
	if err := store.validatePermissionRequestPartition(localOSUserAnchor, accountID); err != nil {
		return err
	}
	return requireExactText("local_app_principal_id", localAppPrincipalID)
}

func (store *PermissionGrantStore) validatePermissionRequestIdentity(localOSUserAnchor, accountID, localAppPrincipalID, permissionID string) error {
	if err := store.validatePermissionRequestPrincipal(localOSUserAnchor, accountID, localAppPrincipalID); err != nil {
		return err
	}
	for name, value := range map[string]string{"permission_id": permissionID} {
		if err := requireExactText(name, value); err != nil {
			return err
		}
	}
	return nil
}

func (store *PermissionGrantStore) validatePermissionRequest(localOSUserAnchor, accountID, localAppPrincipalID, permissionID, displayAppID, reason string) error {
	if err := store.validatePermissionRequestIdentity(localOSUserAnchor, accountID, localAppPrincipalID, permissionID); err != nil {
		return err
	}
	if err := requireExactText("display_app_id", displayAppID); err != nil {
		return err
	}
	if err := requireExactText("reason", reason); err != nil || !utf8.ValidString(reason) || len([]byte(reason)) > MaxPermissionRequestReasonBytes {
		return fmt.Errorf("%w: permission request reason", ErrInvalidArgument)
	}
	return nil
}

func insertPermissionRequestHistory(ctx context.Context, tx *sql.Tx, localOSUserAnchor, accountID, localAppPrincipalID, permissionID, displayAppID, reason string, revision uint64, requestedUnixNano int64) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_request_history(local_os_user_anchor,
		account_id, local_app_principal_id, permission_id, display_app_id, reason, revision, requested_unix_nano)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, localOSUserAnchor, accountID, localAppPrincipalID, permissionID,
		displayAppID, reason, revision, requestedUnixNano); err != nil {
		return fmt.Errorf("insert local-app permission request history: %w", err)
	}
	return nil
}

func scanPermissionRequestDecision(row interface{ Scan(...any) error }) (PermissionRequestDecision, error) {
	var decision PermissionRequestDecision
	var state string
	var selectorDigest sql.NullString
	var revision int64
	var decidedUnixNano int64
	if err := row.Scan(&decision.LocalOSUserAnchor, &decision.AccountID, &decision.LocalAppPrincipalID,
		&decision.PermissionID, &state, &selectorDigest, &revision, &decidedUnixNano); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PermissionRequestDecision{}, ErrNotFound
		}
		return PermissionRequestDecision{}, fmt.Errorf("scan local-app permission request decision: %w", err)
	}
	decision.State = PermissionGrantState(state)
	decision.OwnerSelectorDigest = selectorDigest.String
	decision.Revision = uint64(revision)
	decision.DecidedAt = time.Unix(0, decidedUnixNano).UTC()
	if decision.Revision < 2 || decision.DecidedAt.IsZero() ||
		(decision.State == PermissionGrantStateGranted && decision.OwnerSelectorDigest == "") ||
		(decision.State == PermissionGrantStateDenied && decision.OwnerSelectorDigest != "") ||
		(decision.State != PermissionGrantStateGranted && decision.State != PermissionGrantStateDenied) {
		return PermissionRequestDecision{}, fmt.Errorf("%w: persisted permission request decision", ErrStateConflict)
	}
	return decision, nil
}

func scanPermissionRequest(row interface{ Scan(...any) error }) (PermissionRequest, error) {
	var request PermissionRequest
	var revision int64
	var requestedUnixNano int64
	var createdUnixNano int64
	if err := row.Scan(&request.LocalOSUserAnchor, &request.AccountID, &request.LocalAppPrincipalID, &request.PermissionID,
		&request.DisplayAppID, &request.Reason, &revision, &requestedUnixNano, &createdUnixNano); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PermissionRequest{}, ErrNotFound
		}
		return PermissionRequest{}, fmt.Errorf("scan local-app permission request: %w", err)
	}
	request.Revision = uint64(revision)
	request.RequestedAt = time.Unix(0, requestedUnixNano).UTC()
	request.CreatedAt = time.Unix(0, createdUnixNano).UTC()
	if request.Revision == 0 || request.RequestedAt.IsZero() || request.CreatedAt.IsZero() {
		return PermissionRequest{}, fmt.Errorf("%w: persisted permission request", ErrStateConflict)
	}
	return request, nil
}
