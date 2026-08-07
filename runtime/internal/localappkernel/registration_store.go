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

type RegistrationStore struct{ kernel *Kernel }

func (store *RegistrationStore) RegisterDevelopment(ctx context.Context, input RegisterDevelopmentInput) (Registration, error) {
	if store == nil || store.kernel == nil {
		return Registration{}, fmt.Errorf("%w: registration store", ErrInvalidArgument)
	}
	if err := validateDevelopmentInput(input); err != nil {
		return Registration{}, err
	}
	raw, activated, err := appaccess.ResolveDeclaration(input.RawDeclaration)
	if err != nil {
		return Registration{}, fmt.Errorf("%w: %v", ErrInvalidArgument, err)
	}
	declarationDigest := digestDeclaration(raw)
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()

	current, err := scanRegistration(store.kernel.db.QueryRowContext(ctx, registrationSelect+`
		WHERE local_os_user_anchor = ? AND source_class = 'development' AND source_ref = ? AND state = 'active'`,
		store.kernel.anchor, input.SourceRef))
	if err == nil {
		if current.AppID != input.AppID || current.ProjectRoot != input.ProjectRoot || current.ManifestPath != input.ManifestPath {
			return Registration{}, ErrStateConflict
		}
		sourceGeneration := current.SourceGeneration
		if current.SourceDigest != input.SourceDigest {
			sourceGeneration++
		}
		declarationGeneration := current.DeclarationGeneration
		if current.DeclarationDigest != declarationDigest {
			declarationGeneration++
		}
		rawJSON, _ := json.Marshal(raw)
		activatedJSON, _ := json.Marshal(activated)
		now := store.kernel.now().UTC()
		result, updateErr := store.kernel.db.ExecContext(ctx, `UPDATE registered_app_records SET
			display_name = ?, shell_kind = ?, raw_declaration_json = ?, activated_domains_json = ?,
			source_generation = ?, declaration_generation = ?, source_digest = ?, declaration_digest = ?,
			host_executable_digest = ?, payload_root_digest = ?, updated_unix_nano = ?
			WHERE local_os_user_anchor = ? AND registration_handle = ? AND state = 'active'
			AND source_generation = ? AND declaration_generation = ?`,
			input.DisplayName, input.ShellKind, string(rawJSON), string(activatedJSON), sourceGeneration,
			declarationGeneration, input.SourceDigest, declarationDigest, input.HostExecutableDigest,
			input.PayloadRootDigest, now.UnixNano(), store.kernel.anchor, current.RegistrationHandle,
			current.SourceGeneration, current.DeclarationGeneration)
		if updateErr != nil {
			return Registration{}, fmt.Errorf("update registered App: %w", updateErr)
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil || rows != 1 {
			return Registration{}, ErrRevisionConflict
		}
		current.DisplayName = input.DisplayName
		current.ShellKind = input.ShellKind
		current.RawDeclaration = raw
		current.ActivatedDomains = activated
		current.SourceGeneration = sourceGeneration
		current.DeclarationGeneration = declarationGeneration
		current.SourceDigest = input.SourceDigest
		current.DeclarationDigest = declarationDigest
		current.HostExecutableDigest = input.HostExecutableDigest
		current.PayloadRootDigest = input.PayloadRootDigest
		current.UpdatedAt = now
		return current, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return Registration{}, err
	}

	handle, err := store.kernel.nextIdentifier("rar_v1_", func(candidate string) (bool, error) {
		return identifierExists(ctx, store.kernel.db, "registration_handle", candidate)
	})
	if err != nil {
		return Registration{}, err
	}
	subject, err := store.kernel.nextIdentifier("ras_v1_", func(candidate string) (bool, error) {
		return identifierExists(ctx, store.kernel.db, "registered_app_subject", candidate)
	})
	if err != nil {
		return Registration{}, err
	}
	rawJSON, _ := json.Marshal(raw)
	activatedJSON, _ := json.Marshal(activated)
	now := store.kernel.now().UTC()
	_, err = store.kernel.db.ExecContext(ctx, `INSERT INTO registered_app_records(
		local_os_user_anchor, registration_handle, registered_app_subject, app_id, display_name,
		source_class, source_ref, project_root, manifest_path, shell_kind, raw_declaration_json,
		activated_domains_json, source_generation, declaration_generation, source_digest,
		declaration_digest, host_executable_digest, payload_root_digest, state,
		created_unix_nano, updated_unix_nano, tombstoned_unix_nano
	) VALUES (?, ?, ?, ?, ?, 'development', ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
		store.kernel.anchor, handle, subject, input.AppID, input.DisplayName, input.SourceRef,
		input.ProjectRoot, input.ManifestPath, input.ShellKind, string(rawJSON), string(activatedJSON),
		input.SourceDigest, declarationDigest, input.HostExecutableDigest, input.PayloadRootDigest,
		now.UnixNano(), now.UnixNano())
	if err != nil {
		return Registration{}, fmt.Errorf("insert registered App: %w", err)
	}
	return Registration{
		LocalOSUserAnchor: store.kernel.anchor, RegistrationHandle: handle, RegisteredAppSubject: subject,
		AppID: input.AppID, DisplayName: input.DisplayName, SourceClass: SourceClassDevelopment,
		SourceRef: input.SourceRef, ProjectRoot: input.ProjectRoot, ManifestPath: input.ManifestPath,
		ShellKind: input.ShellKind, RawDeclaration: raw, ActivatedDomains: activated,
		SourceGeneration: 1, DeclarationGeneration: 1, SourceDigest: input.SourceDigest,
		DeclarationDigest: declarationDigest, HostExecutableDigest: input.HostExecutableDigest,
		PayloadRootDigest: input.PayloadRootDigest, State: RegistrationStateActive, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (store *RegistrationStore) GetByHandle(ctx context.Context, handle string) (Registration, error) {
	if store == nil || store.kernel == nil {
		return Registration{}, ErrInvalidArgument
	}
	if err := requireExactText("registration_handle", handle); err != nil {
		return Registration{}, err
	}
	return scanRegistration(store.kernel.db.QueryRowContext(ctx, registrationSelect+`
		WHERE local_os_user_anchor = ? AND registration_handle = ?`, store.kernel.anchor, handle))
}

func (store *RegistrationStore) GetBySubject(ctx context.Context, subject string) (Registration, error) {
	if store == nil || store.kernel == nil {
		return Registration{}, ErrInvalidArgument
	}
	if err := requireExactText("registered_app_subject", subject); err != nil {
		return Registration{}, err
	}
	return scanRegistration(store.kernel.db.QueryRowContext(ctx, registrationSelect+`
		WHERE local_os_user_anchor = ? AND registered_app_subject = ?`, store.kernel.anchor, subject))
}

func (store *RegistrationStore) ListDevelopment(ctx context.Context) ([]Registration, error) {
	if store == nil || store.kernel == nil {
		return nil, ErrInvalidArgument
	}
	rows, err := store.kernel.db.QueryContext(ctx, registrationSelect+`
		WHERE local_os_user_anchor = ? AND source_class = 'development' AND state = 'active'
		ORDER BY created_unix_nano, registration_handle`, store.kernel.anchor)
	if err != nil {
		return nil, fmt.Errorf("list development registrations: %w", err)
	}
	defer func() { _ = rows.Close() }()
	registrations := make([]Registration, 0)
	for rows.Next() {
		registration, scanErr := scanRegistration(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		registrations = append(registrations, registration)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate development registrations: %w", err)
	}
	return registrations, nil
}

func (store *RegistrationStore) Tombstone(ctx context.Context, handle string) error {
	if store == nil || store.kernel == nil {
		return ErrInvalidArgument
	}
	if err := requireExactText("registration_handle", handle); err != nil {
		return err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	now := store.kernel.now().UTC()
	result, err := store.kernel.db.ExecContext(ctx, `UPDATE registered_app_records
		SET state = 'tombstoned', updated_unix_nano = ?, tombstoned_unix_nano = ?
		WHERE local_os_user_anchor = ? AND registration_handle = ? AND state = 'active'`,
		now.UnixNano(), now.UnixNano(), store.kernel.anchor, handle)
	if err != nil {
		return fmt.Errorf("tombstone registered App: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return ErrNotFound
	}
	return nil
}

const registrationSelect = `SELECT local_os_user_anchor, registration_handle, registered_app_subject,
	app_id, display_name, source_class, source_ref, project_root, manifest_path, shell_kind,
	raw_declaration_json, activated_domains_json, source_generation, declaration_generation,
	source_digest, declaration_digest, host_executable_digest, payload_root_digest, state,
	created_unix_nano, updated_unix_nano, tombstoned_unix_nano FROM registered_app_records `

func scanRegistration(row interface{ Scan(...any) error }) (Registration, error) {
	var registration Registration
	var sourceClass, state, rawJSON, activatedJSON string
	var created, updated int64
	var tombstoned sql.NullInt64
	if err := row.Scan(&registration.LocalOSUserAnchor, &registration.RegistrationHandle,
		&registration.RegisteredAppSubject, &registration.AppID, &registration.DisplayName,
		&sourceClass, &registration.SourceRef, &registration.ProjectRoot, &registration.ManifestPath,
		&registration.ShellKind, &rawJSON, &activatedJSON, &registration.SourceGeneration,
		&registration.DeclarationGeneration, &registration.SourceDigest, &registration.DeclarationDigest,
		&registration.HostExecutableDigest, &registration.PayloadRootDigest, &state, &created, &updated,
		&tombstoned); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Registration{}, ErrNotFound
		}
		return Registration{}, fmt.Errorf("scan registered App: %w", err)
	}
	if err := json.Unmarshal([]byte(rawJSON), &registration.RawDeclaration); err != nil {
		return Registration{}, fmt.Errorf("decode raw App access declaration: %w", err)
	}
	if err := json.Unmarshal([]byte(activatedJSON), &registration.ActivatedDomains); err != nil {
		return Registration{}, fmt.Errorf("decode activated App access domains: %w", err)
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

func digestDeclaration(items []string) string {
	encoded, _ := json.Marshal(items)
	digest := sha256.Sum256(append([]byte("nimi.app-access-declaration.v1\x00"), encoded...))
	return "rad_v1_" + base64.RawURLEncoding.EncodeToString(digest[:])
}
