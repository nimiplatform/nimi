package localappkernel

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
func (store *RegistrationStore) RegisterRemote(ctx context.Context, input RegisterRemoteInput) (Registration, error) {
	if store == nil || store.kernel == nil {
		return Registration{}, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return Registration{}, fmt.Errorf("begin remote source registration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	registered, err := store.registerRemoteTx(ctx, tx, input)
	if err != nil {
		return Registration{}, err
	}
	if err = store.kernel.commitTransaction(tx); err != nil {
		return Registration{}, fmt.Errorf("commit remote source registration: %w", err)
	}
	return registered, nil
}

func (store *RegistrationStore) registerRemoteTx(ctx context.Context, tx *sql.Tx, input RegisterRemoteInput) (Registration, error) {
	if input.SourceRevision == 0 || input.SourceRevision > 2147483647 {
		return Registration{}, ErrInvalidArgument
	}
	if err := validateOptionalRegistrationHandle(input.ExistingRegistrationHandle); err != nil {
		return Registration{}, err
	}
	for name, value := range map[string]string{"app_id": input.AppID, "display_name": input.DisplayName, "realm": input.RealmEnvironmentID,
		"client_id": input.ClientID, "origin": input.Origin, "redirect_uri": input.RedirectURI} {
		if err := requireExactText(name, value); err != nil {
			return Registration{}, err
		}
	}
	if input.Role != "app" && input.Role != "official_manager" {
		return Registration{}, ErrInvalidArgument
	}
	changed := false
	if input.ExistingRegistrationHandle != "" {
		previous, err := readRemoteSource(ctx, tx, input.ExistingRegistrationHandle)
		if err != nil {
			return Registration{}, err
		}
		if previous.RealmEnvironmentID != input.RealmEnvironmentID || previous.ClientID != input.ClientID {
			return Registration{}, ErrStateConflict
		}
		if input.SourceRevision < previous.SourceRevision {
			return Registration{}, ErrRevisionConflict
		}
		changed = input.SourceRevision != previous.SourceRevision
		if !changed {
			canonical, err := loadCanonicalByHandle(ctx, tx, input.ExistingRegistrationHandle)
			if err != nil {
				return Registration{}, err
			}
			if previous.Origin != input.Origin || previous.RedirectURI != input.RedirectURI || previous.Role != input.Role ||
				!equalStrings(previous.CapabilityContractRefs, input.CapabilityContractRefs) || !equalStrings(canonical.RawDeclaration, input.RawDeclaration) {
				return Registration{}, ErrRevisionConflict
			}
		}
	}
	reference, _ := json.Marshal([]string{input.RealmEnvironmentID, input.ClientID})
	registered, err := store.registerTx(ctx, tx, registrationMutation{existingHandle: input.ExistingRegistrationHandle, appID: input.AppID, displayName: input.DisplayName,
		sourceClass: SourceClassRemote, sourceRef: "remote:" + string(reference), rawDeclaration: input.RawDeclaration, remoteSourceChanged: changed})
	if err != nil {
		return Registration{}, err
	}
	capabilities, _ := json.Marshal(input.CapabilityContractRefs)
	_, err = tx.ExecContext(ctx, `INSERT INTO remote_app_source(registration_handle, realm_environment_id, client_id, origin, redirect_uri, role, source_revision, capability_refs_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(registration_handle) DO UPDATE SET origin=excluded.origin, redirect_uri=excluded.redirect_uri,
		role=excluded.role, source_revision=excluded.source_revision, capability_refs_json=excluded.capability_refs_json`,
		registered.RegistrationHandle, input.RealmEnvironmentID, input.ClientID, input.Origin, input.RedirectURI, input.Role, input.SourceRevision, string(capabilities))
	if err != nil {
		return Registration{}, fmt.Errorf("persist remote source facts: %w", err)
	}
	return registered, nil
}

func (store *RegistrationStore) RemoteSource(ctx context.Context, handle string) (RemoteSource, error) {
	registration, err := store.GetActiveByHandle(ctx, handle)
	if err != nil {
		return RemoteSource{}, err
	}
	if registration.SourceClass != SourceClassRemote {
		return RemoteSource{}, ErrStateConflict
	}
	return readRemoteSource(ctx, store.kernel.db, handle)
}

func readRemoteSource(ctx context.Context, query registrationQuerier, handle string) (RemoteSource, error) {
	var source RemoteSource
	var capabilities string
	err := query.QueryRowContext(ctx, `SELECT realm_environment_id, client_id, origin, redirect_uri, role, source_revision, capability_refs_json
		FROM remote_app_source WHERE registration_handle = ?`, handle).Scan(&source.RealmEnvironmentID, &source.ClientID, &source.Origin, &source.RedirectURI,
		&source.Role, &source.SourceRevision, &capabilities)
	if err == sql.ErrNoRows {
		return RemoteSource{}, ErrNotFound
	}
	if err != nil {
		return RemoteSource{}, fmt.Errorf("read remote source facts: %w", err)
	}
	if err = json.Unmarshal([]byte(capabilities), &source.CapabilityContractRefs); err != nil {
		return RemoteSource{}, fmt.Errorf("decode remote source capabilities: %w", err)
	}
	return source, nil
}
