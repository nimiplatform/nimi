package app

import (
	"context"
	"database/sql"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type localDevelopmentModeProjection struct {
	Enabled           bool
	Revision          uint64
	AccountID         string
	AccountGeneration uint64
}

func (store *localDevelopmentStore) DeveloperMode(ctx context.Context) (localDevelopmentModeProjection, error) {
	if store == nil || store.db == nil {
		return localDevelopmentModeProjection{}, errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	return scanLocalDevelopmentMode(store.db.QueryRowContext(ctx, `SELECT enabled, revision, account_id, account_generation FROM local_development_mode WHERE singleton = 1`))
}

func (store *localDevelopmentStore) SetDeveloperMode(ctx context.Context, enabled bool, accountID string, accountGeneration uint64) (localDevelopmentModeProjection, error) {
	if store == nil || store.db == nil || accountID == "" || accountGeneration == 0 {
		return localDevelopmentModeProjection{}, errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return localDevelopmentModeProjection{}, err
	}
	defer func() { _ = tx.Rollback() }()
	current, err := scanLocalDevelopmentMode(tx.QueryRowContext(ctx, `SELECT enabled, revision, account_id, account_generation FROM local_development_mode WHERE singleton = 1`))
	if err != nil {
		return localDevelopmentModeProjection{}, err
	}
	now := store.now().UTC()
	if !enabled {
		if err := transitionDevelopmentAuthorizationsForModeOff(ctx, tx, now); err != nil {
			return localDevelopmentModeProjection{}, err
		}
	}
	if current.Enabled == enabled && current.AccountID == accountID && current.AccountGeneration == accountGeneration {
		if err := tx.Commit(); err != nil {
			return localDevelopmentModeProjection{}, err
		}
		return current, nil
	}
	next := localDevelopmentModeProjection{Enabled: enabled, Revision: current.Revision + 1, AccountID: accountID, AccountGeneration: accountGeneration}
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_mode SET enabled = ?, revision = ?, account_id = ?, account_generation = ?, updated_unix_nano = ? WHERE singleton = 1`,
		localDevelopmentSQLiteBool(enabled), next.Revision, accountID, accountGeneration, now.UnixNano()); err != nil {
		return localDevelopmentModeProjection{}, err
	}
	if err := tx.Commit(); err != nil {
		return localDevelopmentModeProjection{}, err
	}
	return next, nil
}

func (store *localDevelopmentStore) RequireDeveloperMode(ctx context.Context, accountID string, accountGeneration uint64) error {
	mode, err := store.DeveloperMode(ctx)
	if err != nil {
		return err
	}
	if !mode.Enabled || mode.AccountID != accountID || mode.AccountGeneration != accountGeneration {
		return errLocalDevelopmentAuthorization
	}
	return nil
}

func transitionDevelopmentAuthorizationsForModeOff(ctx context.Context, tx *sql.Tx, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_authorization SET state = 'revoked', updated_unix_nano = ? WHERE state = 'active' AND decision = ?`, now.UnixNano(), int32(runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_launch SET status = 'revoked', revoked_unix_nano = ? WHERE status IN ('pending','process_bound')`, now.UnixNano()); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE local_development_session SET revoked_unix_nano = ? WHERE revoked_unix_nano IS NULL`, now.UnixNano())
	return err
}

func scanLocalDevelopmentMode(row interface{ Scan(...any) error }) (localDevelopmentModeProjection, error) {
	var enabled int
	var projection localDevelopmentModeProjection
	if err := row.Scan(&enabled, &projection.Revision, &projection.AccountID, &projection.AccountGeneration); err != nil {
		return localDevelopmentModeProjection{}, err
	}
	if (enabled != 0 && enabled != 1) || projection.Revision == 0 {
		return localDevelopmentModeProjection{}, errLocalDevelopmentInvalid
	}
	projection.Enabled = enabled == 1
	return projection, nil
}

func localDevelopmentSQLiteBool(value bool) int {
	if value {
		return 1
	}
	return 0
}
