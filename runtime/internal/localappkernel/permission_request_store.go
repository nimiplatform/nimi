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
	if err := store.validatePermissionRequest(input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, input.RequestID, input.DisplayAppID, input.Reason); err != nil {
		return PermissionRequest{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PermissionRequest{}, fmt.Errorf("begin create local-app permission request: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	revision, err := nextPermissionRevision(ctx, tx, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID)
	if err != nil {
		return PermissionRequest{}, err
	}
	now := store.kernel.now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_requests(
		local_os_user_anchor, account_id, local_app_principal_id, permission_id, request_id, display_app_id,
		reason, revision, requested_unix_nano, created_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID,
		input.PermissionID, input.RequestID, input.DisplayAppID, input.Reason, revision, now.UnixNano(), now.UnixNano()); err != nil {
		return PermissionRequest{}, fmt.Errorf("insert local-app permission request: %w", err)
	}
	if err := insertPermissionRequestHistory(ctx, tx, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID,
		input.PermissionID, input.RequestID, input.RequestID, input.DisplayAppID, input.Reason, revision, now.UnixNano()); err != nil {
		return PermissionRequest{}, err
	}
	if err := tx.Commit(); err != nil {
		return PermissionRequest{}, fmt.Errorf("commit local-app permission request: %w", err)
	}
	return PermissionRequest{LocalOSUserAnchor: input.LocalOSUserAnchor, AccountID: input.AccountID,
		LocalAppPrincipalID: input.LocalAppPrincipalID, PermissionID: input.PermissionID, RequestID: input.RequestID,
		DisplayAppID: input.DisplayAppID, Reason: input.Reason, Revision: revision, RequestedAt: now, CreatedAt: now}, nil
}

func (store *PermissionGrantStore) NextPermissionRequestRevision(ctx context.Context, localOSUserAnchor, accountID, localAppPrincipalID, permissionID string) (uint64, error) {
	if store == nil || store.kernel == nil {
		return 0, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequestIdentity(localOSUserAnchor, accountID, localAppPrincipalID, permissionID); err != nil {
		return 0, err
	}
	var revision int64
	if err := store.kernel.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision), 0) FROM (
		SELECT revision FROM local_app_permission_request_decisions WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND permission_id = ?
		UNION ALL SELECT revision FROM local_app_permission_requests WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND permission_id = ?
	)`, localOSUserAnchor, accountID, localAppPrincipalID, permissionID,
		localOSUserAnchor, accountID, localAppPrincipalID, permissionID).Scan(&revision); err != nil {
		return 0, fmt.Errorf("read next local-app permission revision: %w", err)
	}
	return uint64(revision) + 1, nil
}

func (store *PermissionGrantStore) GetPendingRequest(ctx context.Context, localOSUserAnchor, accountID, localAppPrincipalID, permissionID string) (PermissionRequest, error) {
	if store == nil || store.kernel == nil {
		return PermissionRequest{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequestIdentity(localOSUserAnchor, accountID, localAppPrincipalID, permissionID); err != nil {
		return PermissionRequest{}, err
	}
	return scanPermissionRequest(store.kernel.db.QueryRowContext(ctx, `SELECT local_os_user_anchor, account_id,
		local_app_principal_id, permission_id, request_id, display_app_id, reason, revision, requested_unix_nano, created_unix_nano
		FROM local_app_permission_requests WHERE local_os_user_anchor = ? AND account_id = ?
		AND local_app_principal_id = ? AND permission_id = ?`, localOSUserAnchor, accountID, localAppPrincipalID, permissionID))
}

func (store *PermissionGrantStore) RefreshPendingRequest(ctx context.Context, input RefreshPermissionRequestInput) (PermissionRequest, error) {
	if store == nil || store.kernel == nil {
		return PermissionRequest{}, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if input.ExpectedRevision == 0 {
		return PermissionRequest{}, fmt.Errorf("%w: permission request revision", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequest(input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, input.RequestID, input.DisplayAppID, input.Reason); err != nil {
		return PermissionRequest{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PermissionRequest{}, fmt.Errorf("begin refresh local-app permission request: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	current, err := scanPermissionRequest(tx.QueryRowContext(ctx, `SELECT local_os_user_anchor, account_id,
		local_app_principal_id, permission_id, request_id, display_app_id, reason, revision, requested_unix_nano, created_unix_nano
		FROM local_app_permission_requests WHERE local_os_user_anchor = ? AND account_id = ?
		AND local_app_principal_id = ? AND permission_id = ?`, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID))
	if err != nil {
		return PermissionRequest{}, err
	}
	if current.Revision != input.ExpectedRevision {
		return PermissionRequest{}, ErrPermissionRevisionConflict
	}
	var priorCycle string
	lookupErr := tx.QueryRowContext(ctx, `SELECT cycle_request_id FROM local_app_permission_request_history
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND request_id = ?
		ORDER BY revision DESC LIMIT 1`,
		input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.RequestID).Scan(&priorCycle)
	if lookupErr == nil && priorCycle != current.RequestID {
		return PermissionRequest{}, ErrStateConflict
	}
	if lookupErr != nil && !errors.Is(lookupErr, sql.ErrNoRows) {
		return PermissionRequest{}, fmt.Errorf("read local-app permission request idempotency history: %w", lookupErr)
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
	if err := insertPermissionRequestHistory(ctx, tx, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID,
		input.PermissionID, current.RequestID, input.RequestID, input.DisplayAppID, input.Reason, nextRevision, now.UnixNano()); err != nil {
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
	return store.listPermissionRequests(ctx, `WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? ORDER BY permission_id`, localOSUserAnchor, accountID, localAppPrincipalID)
}

func (store *PermissionGrantStore) ListPermissionRequests(ctx context.Context, localOSUserAnchor, accountID string) ([]PermissionRequest, error) {
	if store == nil || store.kernel == nil {
		return nil, fmt.Errorf("%w: permission grant store", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequestPartition(localOSUserAnchor, accountID); err != nil {
		return nil, err
	}
	return store.listPermissionRequests(ctx, `WHERE local_os_user_anchor = ? AND account_id = ? ORDER BY display_app_id, local_app_principal_id, permission_id`, localOSUserAnchor, accountID)
}

func (store *PermissionGrantStore) ListPendingRequests(ctx context.Context, localOSUserAnchor, accountID string) ([]PermissionRequest, error) {
	return store.ListPermissionRequests(ctx, localOSUserAnchor, accountID)
}

func (store *PermissionGrantStore) listPermissionRequests(ctx context.Context, suffix string, args ...any) ([]PermissionRequest, error) {
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT local_os_user_anchor, account_id, local_app_principal_id,
		permission_id, request_id, display_app_id, reason, revision, requested_unix_nano, created_unix_nano
		FROM local_app_permission_requests `+suffix, args...)
	if err != nil {
		return nil, fmt.Errorf("list local-app permission requests: %w", err)
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
		return nil, fmt.Errorf("read local-app permission requests: %w", err)
	}
	return requests, nil
}

func (store *PermissionGrantStore) GetRecentPermissionRequestDecisionByRequestID(ctx context.Context, localOSUserAnchor, accountID, localAppPrincipalID, requestID string, decidedAfter time.Time) (PermissionRequestDecision, error) {
	if store == nil || store.kernel == nil || decidedAfter.IsZero() || decidedAfter.Location() != time.UTC {
		return PermissionRequestDecision{}, fmt.Errorf("%w: permission request decision lookup", ErrInvalidArgument)
	}
	if err := store.validatePermissionRequestPrincipal(localOSUserAnchor, accountID, localAppPrincipalID); err != nil {
		return PermissionRequestDecision{}, err
	}
	if err := validatePermissionRequestID(requestID); err != nil {
		return PermissionRequestDecision{}, err
	}
	return scanPermissionRequestDecision(store.kernel.db.QueryRowContext(ctx, `SELECT d.local_os_user_anchor, d.account_id,
		d.local_app_principal_id, d.permission_id, d.request_id, d.action, d.owner_selector_digest, d.revision, d.decided_unix_nano
		FROM local_app_permission_request_history h JOIN local_app_permission_request_decisions d
		ON d.local_os_user_anchor = h.local_os_user_anchor AND d.account_id = h.account_id
		AND d.local_app_principal_id = h.local_app_principal_id AND d.request_id = h.cycle_request_id
		WHERE h.local_os_user_anchor = ? AND h.account_id = ? AND h.local_app_principal_id = ? AND h.request_id = ?
		AND d.action IN ('accept','reject') AND d.decided_unix_nano >= ? ORDER BY d.decided_unix_nano DESC LIMIT 1`,
		localOSUserAnchor, accountID, localAppPrincipalID, requestID, decidedAfter.UnixNano()))
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
	request, err := scanPermissionRequest(tx.QueryRowContext(ctx, `SELECT local_os_user_anchor, account_id,
		local_app_principal_id, permission_id, request_id, display_app_id, reason, revision, requested_unix_nano, created_unix_nano
		FROM local_app_permission_requests WHERE local_os_user_anchor = ? AND account_id = ?
		AND local_app_principal_id = ? AND permission_id = ?`, input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID))
	if err != nil {
		return PermissionRequestDecision{}, err
	}
	if request.Revision != input.ExpectedRevision {
		return PermissionRequestDecision{}, ErrPermissionRevisionConflict
	}
	nextRevision := request.Revision + 1
	now := store.kernel.now().UTC()
	action := PermissionAuthorizationActionReject
	var selectorDigest any
	if input.State == PermissionGrantStateGranted {
		action = PermissionAuthorizationActionAccept
		selectorDigest = input.OwnerSelectorDigest
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_request_decisions(local_os_user_anchor,
		account_id, local_app_principal_id, permission_id, request_id, display_app_id, reason, action,
		owner_selector_digest, revision, decided_unix_nano) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, request.RequestID,
		request.DisplayAppID, request.Reason, string(action), selectorDigest, nextRevision, now.UnixNano()); err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("insert local-app permission authorization history: %w", err)
	}
	if input.State == PermissionGrantStateGranted {
		if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_grants(local_os_user_anchor, account_id,
			local_app_principal_id, permission_id, owner_selector_digest, request_id, state, revision, expires_unix_nano,
			created_unix_nano, updated_unix_nano) VALUES (?, ?, ?, ?, ?, ?, 'granted', ?, NULL, ?, ?)`,
			input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, input.OwnerSelectorDigest,
			request.RequestID, nextRevision, now.UnixNano(), now.UnixNano()); err != nil {
			return PermissionRequestDecision{}, fmt.Errorf("insert active local-app permission: %w", err)
		}
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM local_app_permission_requests WHERE local_os_user_anchor = ?
		AND account_id = ? AND local_app_principal_id = ? AND permission_id = ? AND revision = ?`,
		input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID, input.ExpectedRevision)
	if err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("consume local-app permission request: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return PermissionRequestDecision{}, ErrPermissionRevisionConflict
	}
	if err := tx.Commit(); err != nil {
		return PermissionRequestDecision{}, fmt.Errorf("commit local-app permission request decision: %w", err)
	}
	return PermissionRequestDecision{LocalOSUserAnchor: input.LocalOSUserAnchor, AccountID: input.AccountID,
		LocalAppPrincipalID: input.LocalAppPrincipalID, PermissionID: input.PermissionID, RequestID: request.RequestID,
		Action: action, State: input.State, OwnerSelectorDigest: input.OwnerSelectorDigest, Revision: nextRevision, DecidedAt: now}, nil
}

func nextPermissionRevision(ctx context.Context, tx *sql.Tx, anchor, accountID, principalID, permissionID string) (uint64, error) {
	var revision int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision), 0) FROM (
		SELECT revision FROM local_app_permission_request_decisions WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND permission_id = ?
		UNION ALL SELECT revision FROM local_app_permission_requests WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND permission_id = ?
	)`, anchor, accountID, principalID, permissionID, anchor, accountID, principalID, permissionID).Scan(&revision); err != nil {
		return 0, fmt.Errorf("read next local-app permission revision: %w", err)
	}
	return uint64(revision) + 1, nil
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
	return requireExactText("permission_id", permissionID)
}

func (store *PermissionGrantStore) validatePermissionRequest(localOSUserAnchor, accountID, localAppPrincipalID, permissionID, requestID, displayAppID, reason string) error {
	if err := store.validatePermissionRequestIdentity(localOSUserAnchor, accountID, localAppPrincipalID, permissionID); err != nil {
		return err
	}
	if err := validatePermissionRequestID(requestID); err != nil {
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

func validatePermissionRequestID(requestID string) error {
	if err := requireExactText("request_id", requestID); err != nil || !utf8.ValidString(requestID) || len([]byte(requestID)) > MaxPermissionRequestIDBytes {
		return fmt.Errorf("%w: permission request id", ErrInvalidArgument)
	}
	return nil
}

func insertPermissionRequestHistory(ctx context.Context, tx *sql.Tx, localOSUserAnchor, accountID, localAppPrincipalID,
	permissionID, cycleRequestID, requestID, displayAppID, reason string, revision uint64, requestedUnixNano int64) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_app_permission_request_history(local_os_user_anchor,
		account_id, local_app_principal_id, permission_id, cycle_request_id, request_id, display_app_id, reason,
		revision, requested_unix_nano) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, localOSUserAnchor, accountID,
		localAppPrincipalID, permissionID, cycleRequestID, requestID, displayAppID, reason, revision, requestedUnixNano); err != nil {
		return fmt.Errorf("insert local-app permission request history: %w", err)
	}
	return nil
}

func scanPermissionRequestDecision(row interface{ Scan(...any) error }) (PermissionRequestDecision, error) {
	var decision PermissionRequestDecision
	var action string
	var selectorDigest sql.NullString
	var revision int64
	var decidedUnixNano int64
	if err := row.Scan(&decision.LocalOSUserAnchor, &decision.AccountID, &decision.LocalAppPrincipalID,
		&decision.PermissionID, &decision.RequestID, &action, &selectorDigest, &revision, &decidedUnixNano); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PermissionRequestDecision{}, ErrNotFound
		}
		return PermissionRequestDecision{}, fmt.Errorf("scan local-app permission request decision: %w", err)
	}
	decision.Action = PermissionAuthorizationAction(action)
	decision.OwnerSelectorDigest = selectorDigest.String
	decision.Revision = uint64(revision)
	decision.DecidedAt = time.Unix(0, decidedUnixNano).UTC()
	switch decision.Action {
	case PermissionAuthorizationActionAccept:
		decision.State = PermissionGrantStateGranted
	case PermissionAuthorizationActionReject:
		decision.State = PermissionGrantStateDenied
	case PermissionAuthorizationActionRevoke:
		decision.State = PermissionGrantStateRevoked
	default:
		return PermissionRequestDecision{}, fmt.Errorf("%w: persisted permission authorization action", ErrStateConflict)
	}
	if decision.Revision < 2 || decision.DecidedAt.IsZero() || decision.RequestID == "" ||
		(decision.Action == PermissionAuthorizationActionReject && decision.OwnerSelectorDigest != "") ||
		(decision.Action != PermissionAuthorizationActionReject && decision.OwnerSelectorDigest == "") {
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
		&request.RequestID, &request.DisplayAppID, &request.Reason, &revision, &requestedUnixNano, &createdUnixNano); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PermissionRequest{}, ErrNotFound
		}
		return PermissionRequest{}, fmt.Errorf("scan local-app permission request: %w", err)
	}
	request.Revision = uint64(revision)
	request.RequestedAt = time.Unix(0, requestedUnixNano).UTC()
	request.CreatedAt = time.Unix(0, createdUnixNano).UTC()
	if request.RequestID == "" || request.Revision == 0 || request.RequestedAt.IsZero() || request.CreatedAt.IsZero() {
		return PermissionRequest{}, fmt.Errorf("%w: persisted permission request", ErrStateConflict)
	}
	return request, nil
}
