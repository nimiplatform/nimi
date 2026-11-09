package localappkernel

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// This is the remote-source relation, not a second App permission catalog.
// Declarations, registered subjects and operation coverage keep their owners.
type RemoteAccessStore struct{ kernel *Kernel }

type RemoteAccessScope struct{ RealmEnvironmentID, AccountID, BindingID string }
type RemoteAccessSettings struct {
	BindingID string
	Enabled   bool
}
type RemoteSourceAccess struct {
	ClientID, RegistrationHandle string
	ApprovedRevision             uint64
	Paused                       bool
}

func (scope RemoteAccessScope) validate() error {
	for name, value := range map[string]string{"realm": scope.RealmEnvironmentID, "account": scope.AccountID, "binding": scope.BindingID} {
		if err := requireExactText(name, value); err != nil {
			return err
		}
	}
	return nil
}

func (store *RemoteAccessStore) Settings(ctx context.Context, realmID, accountID string) (RemoteAccessSettings, error) {
	if store == nil || store.kernel == nil {
		return RemoteAccessSettings{}, ErrInvalidArgument
	}
	if err := requireExactText("realm", realmID); err != nil {
		return RemoteAccessSettings{}, err
	}
	if err := requireExactText("account", accountID); err != nil {
		return RemoteAccessSettings{}, err
	}
	var settings RemoteAccessSettings
	err := store.kernel.db.QueryRowContext(ctx, `SELECT binding_id, enabled FROM remote_access_settings
		WHERE host_install_id=? AND local_os_user_scope=? AND realm_environment_id=? AND account_id=?`,
		store.kernel.hostInstallID, store.kernel.anchor, realmID, accountID).Scan(&settings.BindingID, &settings.Enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return RemoteAccessSettings{}, nil
	}
	if err != nil {
		return RemoteAccessSettings{}, fmt.Errorf("read remote access setting: %w", err)
	}
	return settings, nil
}

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
func (store *RemoteAccessStore) SetEnabled(ctx context.Context, scope RemoteAccessScope, enabled bool) error {
	if store == nil || store.kernel == nil {
		return ErrInvalidArgument
	}
	if err := scope.validate(); err != nil {
		return err
	}
	_, err := store.kernel.db.ExecContext(ctx, `INSERT INTO remote_access_settings(host_install_id,local_os_user_scope,realm_environment_id,account_id,binding_id,enabled)
		VALUES(?,?,?,?,?,?) ON CONFLICT(host_install_id,local_os_user_scope,realm_environment_id,account_id)
		DO UPDATE SET binding_id=excluded.binding_id,enabled=excluded.enabled`,
		store.kernel.hostInstallID, store.kernel.anchor, scope.RealmEnvironmentID, scope.AccountID, scope.BindingID, enabled)
	if err != nil {
		return fmt.Errorf("set remote access setting: %w", err)
	}
	return nil
}

func (store *RemoteAccessStore) Source(ctx context.Context, scope RemoteAccessScope, clientID string) (RemoteSourceAccess, error) {
	if store == nil || store.kernel == nil {
		return RemoteSourceAccess{}, ErrInvalidArgument
	}
	if err := scope.validate(); err != nil {
		return RemoteSourceAccess{}, err
	}
	var access RemoteSourceAccess
	err := store.kernel.db.QueryRowContext(ctx, `SELECT client_id, registration_handle, approved_revision, paused FROM remote_source_access
		WHERE host_install_id=? AND local_os_user_scope=? AND realm_environment_id=? AND account_id=? AND binding_id=? AND client_id=?`,
		store.kernel.hostInstallID, store.kernel.anchor, scope.RealmEnvironmentID, scope.AccountID, scope.BindingID, clientID).Scan(&access.ClientID, &access.RegistrationHandle, &access.ApprovedRevision, &access.Paused)
	if errors.Is(err, sql.ErrNoRows) {
		return RemoteSourceAccess{}, ErrNotFound
	}
	if err != nil {
		return RemoteSourceAccess{}, fmt.Errorf("read remote source access: %w", err)
	}
	return access, nil
}

func (store *RemoteAccessStore) Sources(ctx context.Context, scope RemoteAccessScope) ([]RemoteSourceAccess, error) {
	if store == nil || store.kernel == nil {
		return nil, ErrInvalidArgument
	}
	if err := scope.validate(); err != nil {
		return nil, err
	}
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT client_id, registration_handle, approved_revision, paused FROM remote_source_access
		WHERE host_install_id=? AND local_os_user_scope=? AND realm_environment_id=? AND account_id=? AND binding_id=? ORDER BY client_id`,
		store.kernel.hostInstallID, store.kernel.anchor, scope.RealmEnvironmentID, scope.AccountID, scope.BindingID)
	if err != nil {
		return nil, fmt.Errorf("list remote sources: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := []RemoteSourceAccess{}
	for rows.Next() {
		var access RemoteSourceAccess
		if err := rows.Scan(&access.ClientID, &access.RegistrationHandle, &access.ApprovedRevision, &access.Paused); err != nil {
			return nil, fmt.Errorf("read remote source: %w", err)
		}
		result = append(result, access)
	}
	return result, rows.Err()
}

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
func (store *RemoteAccessStore) ConfirmSource(ctx context.Context, scope RemoteAccessScope, registrationHandle string) error {
	if store == nil || store.kernel == nil {
		return ErrInvalidArgument
	}
	if err := scope.validate(); err != nil {
		return err
	}
	registration, err := store.kernel.registrations.GetActiveByHandle(ctx, registrationHandle)
	if err != nil {
		return err
	}
	if registration.SourceClass != SourceClassRemote {
		return ErrStateConflict
	}
	source, err := store.kernel.registrations.RemoteSource(ctx, registrationHandle)
	if err != nil {
		return err
	}
	if source.RealmEnvironmentID != scope.RealmEnvironmentID {
		return ErrStateConflict
	}
	// The existing relation is the exact reopen selector. Identity facts alone
	// cannot replace its retained subject with another registration.
	return store.confirmSource(ctx, store.kernel.db, scope, registrationHandle, source)
}

type remoteSourceExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func (store *RemoteAccessStore) confirmSource(ctx context.Context, query remoteSourceExecutor, scope RemoteAccessScope, registrationHandle string, source RemoteSource) error {
	result, err := query.ExecContext(ctx, `INSERT INTO remote_source_access(host_install_id,local_os_user_scope,realm_environment_id,account_id,binding_id,client_id,registration_handle,approved_revision,paused)
		VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(host_install_id,local_os_user_scope,realm_environment_id,account_id,binding_id,client_id)
		DO UPDATE SET approved_revision=excluded.approved_revision,paused=0
		WHERE remote_source_access.registration_handle=excluded.registration_handle
		AND remote_source_access.approved_revision<=excluded.approved_revision`,
		store.kernel.hostInstallID, store.kernel.anchor, scope.RealmEnvironmentID, scope.AccountID, scope.BindingID, source.ClientID, registrationHandle, source.SourceRevision)
	if err != nil {
		return fmt.Errorf("confirm remote source: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("confirm remote source result: %w", err)
	}
	if rows != 1 {
		return ErrStateConflict
	}
	return nil
}

// ConfirmRegistration publishes the source facts and the user's exact source
// relation in one existing-owner transaction. A failed approval cannot leave a
// changed generation or a half-created subject behind.
func (store *RemoteAccessStore) ConfirmRegistration(ctx context.Context, scope RemoteAccessScope, input RegisterRemoteInput) error {
	if store == nil || store.kernel == nil || input.ExistingRegistrationHandle != "" || input.RealmEnvironmentID != scope.RealmEnvironmentID {
		return ErrInvalidArgument
	}
	if err := scope.validate(); err != nil {
		return err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin remote source confirmation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	err = tx.QueryRowContext(ctx, `SELECT registration_handle FROM remote_source_access WHERE host_install_id=? AND local_os_user_scope=?
		AND realm_environment_id=? AND account_id=? AND binding_id=? AND client_id=?`, store.kernel.hostInstallID, store.kernel.anchor,
		scope.RealmEnvironmentID, scope.AccountID, scope.BindingID, input.ClientID).Scan(&input.ExistingRegistrationHandle)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("read confirmed remote subject: %w", err)
	}
	registration, err := store.kernel.registrations.registerRemoteTx(ctx, tx, input)
	if err != nil {
		return err
	}
	source, err := readRemoteSource(ctx, tx, registration.RegistrationHandle)
	if err != nil {
		return err
	}
	if err = store.confirmSource(ctx, tx, scope, registration.RegistrationHandle, source); err != nil {
		return err
	}
	if err = store.kernel.commitTransaction(tx); err != nil {
		return fmt.Errorf("commit remote source confirmation: %w", err)
	}
	return nil
}

func (store *RemoteAccessStore) SetPaused(ctx context.Context, scope RemoteAccessScope, clientID string, paused bool) error {
	if store == nil || store.kernel == nil {
		return ErrInvalidArgument
	}
	if err := scope.validate(); err != nil {
		return err
	}
	result, err := store.kernel.db.ExecContext(ctx, `UPDATE remote_source_access SET paused=?
		WHERE host_install_id=? AND local_os_user_scope=? AND realm_environment_id=? AND account_id=? AND binding_id=? AND client_id=?`,
		paused, store.kernel.hostInstallID, store.kernel.anchor, scope.RealmEnvironmentID, scope.AccountID, scope.BindingID, clientID)
	if err != nil {
		return fmt.Errorf("pause remote source: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("pause remote source result: %w", err)
	}
	if rows != 1 {
		return ErrNotFound
	}
	return nil
}
