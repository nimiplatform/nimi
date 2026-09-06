package localappkernel

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/appaccess"
)

// @nimi-authority: definition.nimi.runtime.app-surface.registered-app-subject-record-plane
type RegistrationStore struct{ kernel *Kernel }

type registrationMutation struct {
	existingHandle            string
	bindingSlot               string
	appID                     string
	displayName               string
	sourceClass               SourceClass
	sourceRef                 string
	projectRoot               string
	manifestPath              string
	shellKind                 int32
	rawDeclaration            []string
	immutableLineageID        string
	provenanceAttestationRefs []string
	provenanceRevision        uint64
	executionProfileRef       string
	hostExecutableFact        string
	payloadRootFact           string
}

type currentHostBinding struct {
	LocalOSUserScope     string
	BindingSlot          string
	RegistrationHandle   string
	ProjectRoot          string
	ManifestPath         string
	HostExecutableDigest string
	PayloadRootDigest    string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

func (store *RegistrationStore) RegisterInstalled(ctx context.Context, input RegisterInstalledInput) (Registration, error) {
	if store == nil || store.kernel == nil {
		return Registration{}, fmt.Errorf("%w: registration store", ErrInvalidArgument)
	}
	if err := validateInstalledInput(input); err != nil {
		return Registration{}, err
	}
	return store.register(ctx, installedRegistrationMutation(input))
}

func installedRegistrationMutation(input RegisterInstalledInput) registrationMutation {
	return registrationMutation{
		existingHandle: input.ExistingRegistrationHandle, bindingSlot: input.BindingSlot,
		appID: input.AppID, displayName: input.DisplayName, sourceClass: input.SourceClass,
		sourceRef: input.SourceRef, projectRoot: input.ProjectRoot, manifestPath: input.ManifestPath,
		shellKind: 0, rawDeclaration: input.RawDeclaration, immutableLineageID: input.ImmutableLineageID,
		provenanceAttestationRefs: input.ProvenanceAttestationRefs, provenanceRevision: input.ProvenanceRevision,
		executionProfileRef: input.ExecutionProfileRef,
		hostExecutableFact:  input.HostExecutableDigest, payloadRootFact: input.PayloadRootDigest,
	}
}

func (store *RegistrationStore) RegisterDevelopment(ctx context.Context, input RegisterDevelopmentInput) (Registration, error) {
	if store == nil || store.kernel == nil {
		return Registration{}, fmt.Errorf("%w: registration store", ErrInvalidArgument)
	}
	if err := validateDevelopmentInput(input); err != nil {
		return Registration{}, err
	}
	return store.register(ctx, registrationMutation{
		existingHandle: input.ExistingRegistrationHandle,
		appID:          input.AppID, displayName: input.DisplayName, sourceClass: SourceClassLocalDevelopment,
		sourceRef: input.SourceRef, projectRoot: input.ProjectRoot, manifestPath: input.ManifestPath,
		shellKind: input.ShellKind, rawDeclaration: input.RawDeclaration,
		hostExecutableFact: input.HostExecutableDigest,
	})
}

// @nimi-authority: rule.nimi.runtime.app-surface.r012
// @nimi-authority: rule.nimi.runtime.app-surface.r052
// @nimi-authority: rule.nimi.runtime.app-surface.r055
// register either creates a genuinely new canonical registration or mutates
// the one selected by an exact opaque current-host handle. App ID, source ref,
// and paths are validation facts after selection; none is a reopen key.
func (store *RegistrationStore) register(ctx context.Context, input registrationMutation) (Registration, error) {
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return Registration{}, fmt.Errorf("begin registered App transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	registration, err := store.registerTx(ctx, tx, input)
	if err != nil {
		return Registration{}, err
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return Registration{}, fmt.Errorf("commit registered App transaction: %w", err)
	}
	return registration, nil
}

func (store *RegistrationStore) registerTx(ctx context.Context, tx *sql.Tx, input registrationMutation) (Registration, error) {
	raw, activated, err := appaccess.ResolveDeclaration(input.rawDeclaration)
	if err != nil {
		return Registration{}, fmt.Errorf("%w: %v", ErrInvalidArgument, err)
	}
	declarationDigest := digestDeclaration(raw)
	rawJSON, _ := json.Marshal(raw)
	activatedJSON, _ := json.Marshal(activated)
	provenanceJSON, _ := json.Marshal(input.provenanceAttestationRefs)
	storedProjectRoot, err := store.kernel.encodeBindingLocator(input.projectRoot)
	if err != nil {
		return Registration{}, err
	}
	storedManifestPath, err := store.kernel.encodeBindingLocator(input.manifestPath)
	if err != nil {
		return Registration{}, err
	}

	if input.existingHandle != "" {
		canonical, loadErr := loadCanonicalByHandle(ctx, tx, input.existingHandle)
		if loadErr != nil {
			return Registration{}, loadErr
		}
		if canonical.State != RegistrationStateActive {
			return Registration{}, ErrRegistrationTombstoned
		}
		binding, bindingErr := store.loadCurrentHostBinding(ctx, tx, input.existingHandle)
		if bindingErr != nil {
			return Registration{}, bindingErr
		}
		if canonical.AppID != input.appID || canonical.SourceClass != input.sourceClass || canonical.SourceRef != input.sourceRef {
			return Registration{}, ErrStateConflict
		}
		if input.bindingSlot != "" && binding.BindingSlot != input.bindingSlot {
			return Registration{}, ErrStateConflict
		}

		sourceChanged := canonical.ImmutableLineageID != input.immutableLineageID ||
			!equalStrings(canonical.ProvenanceAttestationRefs, input.provenanceAttestationRefs) ||
			canonical.ProvenanceRevision != input.provenanceRevision ||
			canonical.ExecutionProfileRef != input.executionProfileRef ||
			binding.HostExecutableDigest != input.hostExecutableFact || binding.PayloadRootDigest != input.payloadRootFact
		if input.sourceClass == SourceClassLocalDevelopment {
			sourceChanged = canonical.ShellKind != input.shellKind ||
				binding.ProjectRoot != input.projectRoot || binding.ManifestPath != input.manifestPath ||
				binding.HostExecutableDigest != input.hostExecutableFact
		}
		sourceGeneration := canonical.SourceGeneration
		if sourceChanged {
			sourceGeneration++
		}
		declarationGeneration := canonical.DeclarationGeneration
		if canonical.DeclarationDigest != declarationDigest {
			declarationGeneration++
		}
		now := store.kernel.now().UTC()
		result, updateErr := tx.ExecContext(ctx, `UPDATE canonical_registration SET
			display_name = ?, shell_kind = ?, raw_declaration_json = ?, activated_domains_json = ?,
			source_generation = ?, declaration_generation = ?, immutable_lineage_id = ?,
			provenance_attestation_refs_json = ?, provenance_revision = ?, execution_profile_ref = ?, declaration_digest = ?,
			updated_unix_nano = ?
			WHERE registration_handle = ? AND state = 'active'
			AND source_generation = ? AND declaration_generation = ?`,
			input.displayName, input.shellKind, string(rawJSON), string(activatedJSON), sourceGeneration,
			declarationGeneration, input.immutableLineageID, string(provenanceJSON), input.provenanceRevision,
			input.executionProfileRef, declarationDigest, now.UnixNano(), canonical.RegistrationHandle,
			canonical.SourceGeneration, canonical.DeclarationGeneration)
		if updateErr != nil {
			return Registration{}, fmt.Errorf("update canonical registered App: %w", updateErr)
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil || rows != 1 {
			return Registration{}, ErrRevisionConflict
		}
		result, updateErr = tx.ExecContext(ctx, `UPDATE current_host_binding SET
			project_root = ?, manifest_path = ?, host_executable_digest = ?, payload_root_digest = ?, updated_unix_nano = ?
			WHERE host_install_id = ? AND local_os_user_scope = ? AND registration_handle = ?`,
			storedProjectRoot, storedManifestPath, input.hostExecutableFact, input.payloadRootFact, now.UnixNano(),
			store.kernel.hostInstallID, store.kernel.anchor, canonical.RegistrationHandle)
		if updateErr != nil {
			return Registration{}, fmt.Errorf("update current-host registered App binding: %w", updateErr)
		}
		rows, rowsErr = result.RowsAffected()
		if rowsErr != nil || rows != 1 {
			return Registration{}, ErrRevisionConflict
		}
		canonical.DisplayName = input.displayName
		canonical.ShellKind = input.shellKind
		canonical.RawDeclaration = raw
		canonical.ActivatedDomains = activated
		canonical.SourceGeneration = sourceGeneration
		canonical.DeclarationGeneration = declarationGeneration
		canonical.ImmutableLineageID = input.immutableLineageID
		canonical.ProvenanceAttestationRefs = append([]string(nil), input.provenanceAttestationRefs...)
		canonical.ProvenanceRevision = input.provenanceRevision
		canonical.ExecutionProfileRef = input.executionProfileRef
		canonical.DeclarationDigest = declarationDigest
		canonical.UpdatedAt = now
		binding.ProjectRoot = input.projectRoot
		binding.ManifestPath = input.manifestPath
		binding.HostExecutableDigest = input.hostExecutableFact
		binding.PayloadRootDigest = input.payloadRootFact
		binding.UpdatedAt = now
		return registrationFromCanonicalAndBinding(canonical, binding), nil
	}

	if input.bindingSlot != "" {
		if _, slotErr := store.lookupBindingHandleBySlot(ctx, tx, input.bindingSlot); slotErr == nil {
			return Registration{}, ErrStateConflict
		} else if !errors.Is(slotErr, ErrNotFound) {
			return Registration{}, slotErr
		}
	}
	handle, err := store.kernel.nextIdentifier("rar_v1_", func(candidate string) (bool, error) {
		return identifierExistsTx(ctx, tx, "registration_handle", candidate)
	})
	if err != nil {
		return Registration{}, err
	}
	subject, err := store.kernel.nextIdentifier("ras_v1_", func(candidate string) (bool, error) {
		return identifierExistsTx(ctx, tx, "registered_app_subject", candidate)
	})
	if err != nil {
		return Registration{}, err
	}
	now := store.kernel.now().UTC()
	_, err = tx.ExecContext(ctx, `INSERT INTO canonical_registration(
		registration_handle, registered_app_subject, app_id, display_name, source_class, source_ref,
		shell_kind, raw_declaration_json, activated_domains_json, source_generation, declaration_generation,
		immutable_lineage_id, provenance_attestation_refs_json, provenance_revision, execution_profile_ref,
		declaration_digest, state, created_unix_nano, updated_unix_nano, tombstoned_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
		handle, subject, input.appID, input.displayName, string(input.sourceClass), input.sourceRef,
		input.shellKind, string(rawJSON), string(activatedJSON), input.immutableLineageID, string(provenanceJSON),
		input.provenanceRevision, input.executionProfileRef, declarationDigest,
		now.UnixNano(), now.UnixNano())
	if err != nil {
		return Registration{}, fmt.Errorf("insert canonical registered App: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO current_host_binding(
		host_install_id, local_os_user_scope, registration_handle, binding_slot, project_root, manifest_path,
		host_executable_digest, payload_root_digest, created_unix_nano, updated_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		store.kernel.hostInstallID, store.kernel.anchor, handle, input.bindingSlot, storedProjectRoot,
		storedManifestPath, input.hostExecutableFact, input.payloadRootFact, now.UnixNano(), now.UnixNano())
	if err != nil {
		return Registration{}, fmt.Errorf("insert current-host registered App binding: %w", err)
	}
	return Registration{
		LocalOSUserAnchor: store.kernel.anchor, BindingSlot: input.bindingSlot,
		RegistrationHandle: handle, RegisteredAppSubject: subject, AppID: input.appID,
		DisplayName: input.displayName, SourceClass: input.sourceClass, SourceRef: input.sourceRef,
		ProjectRoot: input.projectRoot, ManifestPath: input.manifestPath, ShellKind: input.shellKind,
		RawDeclaration: raw, ActivatedDomains: activated, SourceGeneration: 1, DeclarationGeneration: 1,
		ImmutableLineageID:        input.immutableLineageID,
		ProvenanceAttestationRefs: append([]string(nil), input.provenanceAttestationRefs...),
		ProvenanceRevision:        input.provenanceRevision, ExecutionProfileRef: input.executionProfileRef,
		DeclarationDigest:    declarationDigest,
		HostExecutableDigest: input.hostExecutableFact, PayloadRootDigest: input.payloadRootFact,
		State: RegistrationStateActive, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (store *RegistrationStore) GetByHandle(ctx context.Context, handle string) (Registration, error) {
	if store == nil || store.kernel == nil {
		return Registration{}, ErrInvalidArgument
	}
	if err := requireExactText("registration_handle", handle); err != nil {
		return Registration{}, err
	}
	canonical, err := loadCanonicalByHandle(ctx, store.kernel.db, handle)
	if err != nil {
		return Registration{}, err
	}
	binding, err := store.loadCurrentHostBinding(ctx, store.kernel.db, handle)
	if err != nil {
		return Registration{}, err
	}
	return registrationFromCanonicalAndBinding(canonical, binding), nil
}

func (store *RegistrationStore) GetActiveByHandle(ctx context.Context, handle string) (Registration, error) {
	registration, err := store.GetByHandle(ctx, handle)
	if err != nil {
		return Registration{}, err
	}
	if registration.State != RegistrationStateActive {
		return Registration{}, ErrRegistrationTombstoned
	}
	return registration, nil
}

// GetActiveByBindingSlot resolves only a protected machine-internal opaque
// slot in this exact host-install and verified OS-user partition. The slot is
// not an App ID, source identity, path, package, or cross-host reopen key.
func (store *RegistrationStore) GetActiveByBindingSlot(ctx context.Context, slot string) (Registration, error) {
	if store == nil || store.kernel == nil {
		return Registration{}, ErrInvalidArgument
	}
	if err := requireExactText("binding_slot", slot); err != nil {
		return Registration{}, err
	}
	handle, err := store.lookupBindingHandleBySlot(ctx, store.kernel.db, slot)
	if err != nil {
		return Registration{}, err
	}
	return store.GetActiveByHandle(ctx, handle)
}

func (store *RegistrationStore) GetBySubject(ctx context.Context, subject string) (Registration, error) {
	if store == nil || store.kernel == nil {
		return Registration{}, ErrInvalidArgument
	}
	if err := requireExactText("registered_app_subject", subject); err != nil {
		return Registration{}, err
	}
	canonical, err := loadCanonicalBySubject(ctx, store.kernel.db, subject)
	if err != nil {
		return Registration{}, err
	}
	binding, err := store.loadCurrentHostBinding(ctx, store.kernel.db, canonical.RegistrationHandle)
	if err != nil {
		return Registration{}, err
	}
	return registrationFromCanonicalAndBinding(canonical, binding), nil
}

func (store *RegistrationStore) Status(ctx context.Context, handle string) (RegistrationStatus, error) {
	if store == nil || store.kernel == nil {
		return RegistrationStatus{}, ErrInvalidArgument
	}
	if err := requireExactText("registration_handle", handle); err != nil {
		return RegistrationStatus{}, err
	}
	canonical, err := loadCanonicalByHandle(ctx, store.kernel.db, handle)
	if err != nil {
		return RegistrationStatus{}, err
	}
	_, bindingErr := store.loadCurrentHostBinding(ctx, store.kernel.db, handle)
	if bindingErr != nil && !errors.Is(bindingErr, ErrRegistrationUnavailable) {
		return RegistrationStatus{}, bindingErr
	}
	bound := bindingErr == nil
	return registrationStatusFromCanonical(canonical, bound), nil
}

func (store *RegistrationStore) ListStatuses(ctx context.Context) ([]RegistrationStatus, error) {
	if store == nil || store.kernel == nil {
		return nil, ErrInvalidArgument
	}
	rows, err := store.kernel.db.QueryContext(ctx, canonicalRegistrationSelect+` ORDER BY created_unix_nano, registration_handle`)
	if err != nil {
		return nil, fmt.Errorf("list canonical registered Apps: %w", err)
	}
	canonicals := make([]Registration, 0)
	for rows.Next() {
		canonical, scanErr := scanCanonicalRegistration(rows)
		if scanErr != nil {
			_ = rows.Close()
			return nil, scanErr
		}
		canonicals = append(canonicals, canonical)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("iterate canonical registered Apps: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	statuses := make([]RegistrationStatus, 0, len(canonicals))
	for _, canonical := range canonicals {
		_, bindingErr := store.loadCurrentHostBinding(ctx, store.kernel.db, canonical.RegistrationHandle)
		if bindingErr != nil && !errors.Is(bindingErr, ErrRegistrationUnavailable) {
			return nil, bindingErr
		}
		statuses = append(statuses, registrationStatusFromCanonical(canonical, bindingErr == nil))
	}
	return statuses, nil
}

func (store *RegistrationStore) ListDevelopment(ctx context.Context) ([]Registration, error) {
	if store == nil || store.kernel == nil {
		return nil, ErrInvalidArgument
	}
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT c.registration_handle
		FROM canonical_registration c
		JOIN current_host_binding b ON b.registration_handle = c.registration_handle
		WHERE b.host_install_id = ? AND b.local_os_user_scope = ?
		  AND c.source_class = 'local_development' AND c.state = 'active'
		ORDER BY c.created_unix_nano, c.registration_handle`, store.kernel.hostInstallID, store.kernel.anchor)
	if err != nil {
		return nil, fmt.Errorf("list development registrations: %w", err)
	}
	handles := make([]string, 0)
	for rows.Next() {
		var handle string
		if err := rows.Scan(&handle); err != nil {
			_ = rows.Close()
			return nil, err
		}
		handles = append(handles, handle)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("iterate development registrations: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	registrations := make([]Registration, 0, len(handles))
	for _, handle := range handles {
		registration, err := store.GetActiveByHandle(ctx, handle)
		if err != nil {
			return nil, err
		}
		registrations = append(registrations, registration)
	}
	return registrations, nil
}

// @nimi-authority: rule.nimi.runtime.app-surface.r055
func (store *RegistrationStore) Tombstone(ctx context.Context, handle string) error {
	if store == nil || store.kernel == nil {
		return ErrInvalidArgument
	}
	if err := requireExactText("registration_handle", handle); err != nil {
		return err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin registered App tombstone: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := store.tombstoneTx(ctx, tx, handle); err != nil {
		return err
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return fmt.Errorf("commit registered App tombstone: %w", err)
	}
	return nil
}

func (store *RegistrationStore) tombstoneTx(ctx context.Context, tx *sql.Tx, handle string) error {
	canonical, err := loadCanonicalByHandle(ctx, tx, handle)
	if err != nil {
		return err
	}
	if canonical.State != RegistrationStateActive {
		return ErrRegistrationTombstoned
	}
	if _, err := store.loadCurrentHostBinding(ctx, tx, handle); err != nil {
		return err
	}
	now := store.kernel.now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE canonical_registration
		SET state = 'tombstoned', updated_unix_nano = ?, tombstoned_unix_nano = ?
		WHERE registration_handle = ? AND state = 'active'`, now.UnixNano(), now.UnixNano(), handle)
	if err != nil {
		return fmt.Errorf("tombstone canonical registered App: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return ErrRevisionConflict
	}
	// The binding remains as history, but its current routing slot is released.
	result, err = tx.ExecContext(ctx, `UPDATE current_host_binding
		SET binding_slot = '', updated_unix_nano = ?
		WHERE host_install_id = ? AND local_os_user_scope = ? AND registration_handle = ?`,
		now.UnixNano(), store.kernel.hostInstallID, store.kernel.anchor, handle)
	if err != nil {
		return fmt.Errorf("detach tombstoned registered App binding: %w", err)
	}
	rows, err = result.RowsAffected()
	if err != nil || rows != 1 {
		return ErrRevisionConflict
	}
	return nil
}

type registrationQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (store *RegistrationStore) loadCurrentHostBinding(ctx context.Context, query registrationQuerier, handle string) (currentHostBinding, error) {
	var binding currentHostBinding
	var created, updated int64
	err := query.QueryRowContext(ctx, `SELECT local_os_user_scope, binding_slot, registration_handle,
		project_root, manifest_path, host_executable_digest, payload_root_digest, created_unix_nano, updated_unix_nano
		FROM current_host_binding
		WHERE host_install_id = ? AND local_os_user_scope = ? AND registration_handle = ?`,
		store.kernel.hostInstallID, store.kernel.anchor, handle).Scan(
		&binding.LocalOSUserScope, &binding.BindingSlot, &binding.RegistrationHandle,
		&binding.ProjectRoot, &binding.ManifestPath, &binding.HostExecutableDigest, &binding.PayloadRootDigest,
		&created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return currentHostBinding{}, ErrRegistrationUnavailable
	}
	if err != nil {
		return currentHostBinding{}, fmt.Errorf("read current-host registered App binding: %w", err)
	}
	binding.ProjectRoot, err = store.kernel.decodeBindingLocator(binding.ProjectRoot)
	if err != nil {
		return currentHostBinding{}, err
	}
	binding.ManifestPath, err = store.kernel.decodeBindingLocator(binding.ManifestPath)
	if err != nil {
		return currentHostBinding{}, err
	}
	binding.CreatedAt = time.Unix(0, created).UTC()
	binding.UpdatedAt = time.Unix(0, updated).UTC()
	return binding, nil
}

func (store *RegistrationStore) lookupBindingHandleBySlot(ctx context.Context, query registrationQuerier, slot string) (string, error) {
	var handle string
	err := query.QueryRowContext(ctx, `SELECT registration_handle FROM current_host_binding
		WHERE host_install_id = ? AND local_os_user_scope = ? AND binding_slot = ?`,
		store.kernel.hostInstallID, store.kernel.anchor, slot).Scan(&handle)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read current-host binding slot: %w", err)
	}
	return handle, nil
}

const canonicalRegistrationSelect = `SELECT registration_handle, registered_app_subject,
	app_id, display_name, source_class, source_ref, shell_kind, raw_declaration_json,
	activated_domains_json, source_generation, declaration_generation, immutable_lineage_id,
	provenance_attestation_refs_json, provenance_revision, execution_profile_ref,
	declaration_digest, state, created_unix_nano, updated_unix_nano, tombstoned_unix_nano
	FROM canonical_registration `

func loadCanonicalByHandle(ctx context.Context, query registrationQuerier, handle string) (Registration, error) {
	return scanCanonicalRegistration(query.QueryRowContext(ctx, canonicalRegistrationSelect+` WHERE registration_handle = ?`, handle))
}

func loadCanonicalBySubject(ctx context.Context, query registrationQuerier, subject string) (Registration, error) {
	return scanCanonicalRegistration(query.QueryRowContext(ctx, canonicalRegistrationSelect+` WHERE registered_app_subject = ?`, subject))
}

func scanCanonicalRegistration(row interface{ Scan(...any) error }) (Registration, error) {
	var registration Registration
	var sourceClass, state, rawJSON, activatedJSON, provenanceJSON string
	var created, updated int64
	var tombstoned sql.NullInt64
	if err := row.Scan(&registration.RegistrationHandle, &registration.RegisteredAppSubject,
		&registration.AppID, &registration.DisplayName, &sourceClass, &registration.SourceRef,
		&registration.ShellKind, &rawJSON, &activatedJSON, &registration.SourceGeneration,
		&registration.DeclarationGeneration, &registration.ImmutableLineageID, &provenanceJSON,
		&registration.ProvenanceRevision, &registration.ExecutionProfileRef, &registration.DeclarationDigest,
		&state, &created, &updated, &tombstoned); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Registration{}, ErrNotFound
		}
		return Registration{}, fmt.Errorf("scan canonical registered App: %w", err)
	}
	if err := json.Unmarshal([]byte(rawJSON), &registration.RawDeclaration); err != nil {
		return Registration{}, fmt.Errorf("decode raw App access declaration: %w", err)
	}
	if err := json.Unmarshal([]byte(activatedJSON), &registration.ActivatedDomains); err != nil {
		return Registration{}, fmt.Errorf("decode activated App access domains: %w", err)
	}
	if err := json.Unmarshal([]byte(provenanceJSON), &registration.ProvenanceAttestationRefs); err != nil {
		return Registration{}, fmt.Errorf("decode provenance attestation refs: %w", err)
	}
	registration.SourceClass = SourceClass(sourceClass)
	registration.State = RegistrationState(state)
	registration.CreatedAt = time.Unix(0, created).UTC()
	registration.UpdatedAt = time.Unix(0, updated).UTC()
	if tombstoned.Valid {
		value := time.Unix(0, tombstoned.Int64).UTC()
		registration.TombstonedAt = &value
	}
	return registration, nil
}

func registrationFromCanonicalAndBinding(canonical Registration, binding currentHostBinding) Registration {
	canonical.LocalOSUserAnchor = binding.LocalOSUserScope
	canonical.BindingSlot = binding.BindingSlot
	canonical.ProjectRoot = binding.ProjectRoot
	canonical.ManifestPath = binding.ManifestPath
	canonical.HostExecutableDigest = binding.HostExecutableDigest
	canonical.PayloadRootDigest = binding.PayloadRootDigest
	return canonical
}

func registrationStatusFromCanonical(canonical Registration, bound bool) RegistrationStatus {
	sourceReady := canonical.SourceClass == SourceClassLocalDevelopment || canonical.ImmutablePackageFactsComplete()
	return RegistrationStatus{
		RegistrationHandle: canonical.RegistrationHandle, RegisteredAppSubject: canonical.RegisteredAppSubject,
		AppID: canonical.AppID, SourceClass: canonical.SourceClass, State: canonical.State,
		CurrentHostBound: bound, Available: bound && sourceReady && canonical.State == RegistrationStateActive,
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func digestDeclaration(items []string) string {
	encoded, _ := json.Marshal(items)
	digest := sha256.Sum256(append([]byte("nimi.app-access-declaration.v1\x00"), encoded...))
	return "rad_v1_" + base64.RawURLEncoding.EncodeToString(digest[:])
}
