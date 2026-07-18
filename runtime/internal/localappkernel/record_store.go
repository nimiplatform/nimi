package localappkernel

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type RecordStore struct {
	kernel *Kernel
}

func (store *RecordStore) Create(ctx context.Context, input CreateRecordInput) (Record, error) {
	if store == nil || store.kernel == nil {
		return Record{}, fmt.Errorf("%w: record store", ErrInvalidArgument)
	}
	if err := validateRecordInput(input); err != nil {
		return Record{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	principal, err := scanPrincipal(store.kernel.db.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, local_app_principal_id, principal_kind, app_id,
		immutable_lineage_id, development_authorization_id, canonical_project_file_id,
		state, created_unix_nano, tombstoned_unix_nano
		FROM local_app_principals WHERE local_os_user_anchor = ? AND local_app_principal_id = ?`, store.kernel.anchor, input.LocalAppPrincipalID))
	if err != nil {
		return Record{}, err
	}
	if principal.State != PrincipalStateActive {
		return Record{}, ErrPrincipalTombstoned
	}
	if (principal.Kind == PrincipalKindDevelopment) != (input.TrustClass == TrustClassLocalDevelopment) {
		return Record{}, fmt.Errorf("%w: principal kind and trust class disagree", ErrInvalidArgument)
	}
	identifier, err := store.kernel.nextIdentifier("lar_v1_", func(candidate string) (bool, error) {
		var found int
		err := store.kernel.db.QueryRowContext(ctx, `SELECT 1 FROM local_app_records WHERE local_app_record_id = ?`, candidate).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	})
	if err != nil {
		return Record{}, fmt.Errorf("create local-app record: %w", err)
	}
	refsJSON, err := json.Marshal(input.ProvenanceAttestationRefs)
	if err != nil {
		return Record{}, fmt.Errorf("encode provenance attestation references: %w", err)
	}
	if _, err := store.kernel.db.ExecContext(ctx, `INSERT INTO local_app_records(
		local_os_user_anchor, local_app_record_id, local_app_principal_id, trust_class,
		provenance_attestation_refs_json, provenance_revision, active_release_or_project_identity_ref,
		install_or_project_generation, active_capability_fingerprint, execution_profile_ref,
		host_executable_digest, payload_root_digest, lifecycle_state
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, store.kernel.anchor, identifier,
		input.LocalAppPrincipalID, string(input.TrustClass), string(refsJSON), input.ProvenanceRevision,
		input.ActiveReleaseOrProjectIdentityRef, input.InstallOrProjectGeneration, input.ActiveCapabilityFingerprint,
		input.ExecutionProfileRef, input.HostExecutableDigest, input.PayloadRootDigest, string(input.LifecycleState)); err != nil {
		return Record{}, fmt.Errorf("insert local-app record: %w", err)
	}
	return recordFromInput(store.kernel.anchor, identifier, input), nil
}

func (store *RecordStore) GetByPrincipalID(ctx context.Context, principalID string) (Record, error) {
	if store == nil || store.kernel == nil {
		return Record{}, fmt.Errorf("%w: record store", ErrInvalidArgument)
	}
	if err := requireExactText("local_app_principal_id", principalID); err != nil {
		return Record{}, err
	}
	return scanRecord(store.kernel.db.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, local_app_record_id, local_app_principal_id, trust_class,
		provenance_attestation_refs_json, provenance_revision, active_release_or_project_identity_ref,
		install_or_project_generation, active_capability_fingerprint, execution_profile_ref,
		host_executable_digest, payload_root_digest, lifecycle_state
		FROM local_app_records WHERE local_os_user_anchor = ? AND local_app_principal_id = ?`, store.kernel.anchor, principalID))
}

// UpdateDevelopment advances one exact development record. A changed host or
// payload digest increments project generation; a lifecycle-only transition
// preserves it. The update is conditional on the caller's exact record and
// generation so stale launch preparation cannot overwrite newer truth.
func (store *RecordStore) UpdateDevelopment(ctx context.Context, input UpdateDevelopmentRecordInput) (Record, error) {
	if store == nil || store.kernel == nil {
		return Record{}, fmt.Errorf("%w: record store", ErrInvalidArgument)
	}
	for name, value := range map[string]string{
		"local_app_principal_id": input.LocalAppPrincipalID,
		"local_app_record_id":    input.LocalAppRecordID,
		"host_executable_digest": input.HostExecutableDigest,
		"payload_root_digest":    input.PayloadRootDigest,
	} {
		if err := requireExactText(name, value); err != nil {
			return Record{}, err
		}
	}
	if input.ExpectedProjectGeneration == 0 || !validLifecycleState(input.LifecycleState) {
		return Record{}, fmt.Errorf("%w: development record generation or lifecycle", ErrInvalidArgument)
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return Record{}, fmt.Errorf("begin development record update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	current, err := scanRecord(tx.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, local_app_record_id, local_app_principal_id, trust_class,
		provenance_attestation_refs_json, provenance_revision, active_release_or_project_identity_ref,
		install_or_project_generation, active_capability_fingerprint, execution_profile_ref,
		host_executable_digest, payload_root_digest, lifecycle_state
		FROM local_app_records WHERE local_os_user_anchor = ? AND local_app_principal_id = ? AND local_app_record_id = ?`,
		store.kernel.anchor, input.LocalAppPrincipalID, input.LocalAppRecordID))
	if err != nil {
		return Record{}, err
	}
	if current.TrustClass != TrustClassLocalDevelopment || current.InstallOrProjectGeneration != input.ExpectedProjectGeneration {
		return Record{}, ErrRevisionConflict
	}
	principal, err := scanPrincipal(tx.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, local_app_principal_id, principal_kind, app_id,
		immutable_lineage_id, development_authorization_id, canonical_project_file_id,
		state, created_unix_nano, tombstoned_unix_nano
		FROM local_app_principals WHERE local_os_user_anchor = ? AND local_app_principal_id = ?`, store.kernel.anchor, input.LocalAppPrincipalID))
	if err != nil {
		return Record{}, err
	}
	if principal.Kind != PrincipalKindDevelopment || principal.State != PrincipalStateActive {
		return Record{}, ErrPrincipalTombstoned
	}
	nextGeneration := current.InstallOrProjectGeneration
	if current.HostExecutableDigest != input.HostExecutableDigest || current.PayloadRootDigest != input.PayloadRootDigest {
		nextGeneration++
	}
	result, err := tx.ExecContext(ctx, `UPDATE local_app_records SET
		install_or_project_generation = ?, host_executable_digest = ?, payload_root_digest = ?, lifecycle_state = ?
		WHERE local_os_user_anchor = ? AND local_app_principal_id = ? AND local_app_record_id = ? AND install_or_project_generation = ?`,
		nextGeneration, input.HostExecutableDigest, input.PayloadRootDigest, string(input.LifecycleState),
		store.kernel.anchor, input.LocalAppPrincipalID, input.LocalAppRecordID, input.ExpectedProjectGeneration)
	if err != nil {
		return Record{}, fmt.Errorf("update development record: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return Record{}, ErrRevisionConflict
	}
	if err := tx.Commit(); err != nil {
		return Record{}, fmt.Errorf("commit development record update: %w", err)
	}
	current.InstallOrProjectGeneration = nextGeneration
	current.HostExecutableDigest = input.HostExecutableDigest
	current.PayloadRootDigest = input.PayloadRootDigest
	current.LifecycleState = input.LifecycleState
	return current, nil
}

// AdvanceProvenanceRevision is provenance-agnostic. It does not install,
// update, import, verify, or promote a package. It only commits the frozen
// revision/invalidation invariant for a record already admitted by an owner.
func (store *RecordStore) AdvanceProvenanceRevision(ctx context.Context, principalID string, expectedRevision uint64) (ProvenanceInvalidationFact, error) {
	if store == nil || store.kernel == nil {
		return ProvenanceInvalidationFact{}, fmt.Errorf("%w: record store", ErrInvalidArgument)
	}
	if err := requireExactText("local_app_principal_id", principalID); err != nil || expectedRevision == 0 {
		if err != nil {
			return ProvenanceInvalidationFact{}, err
		}
		return ProvenanceInvalidationFact{}, fmt.Errorf("%w: expected provenance revision", ErrInvalidArgument)
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return ProvenanceInvalidationFact{}, fmt.Errorf("begin provenance advance: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var recordID string
	var actualRevision uint64
	var principalState string
	if err := tx.QueryRowContext(ctx, `SELECT r.local_app_record_id, r.provenance_revision, p.state
		FROM local_app_records r JOIN local_app_principals p
		ON p.local_os_user_anchor = r.local_os_user_anchor AND p.local_app_principal_id = r.local_app_principal_id
		WHERE r.local_os_user_anchor = ? AND r.local_app_principal_id = ?`, store.kernel.anchor, principalID).Scan(&recordID, &actualRevision, &principalState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ProvenanceInvalidationFact{}, ErrNotFound
		}
		return ProvenanceInvalidationFact{}, fmt.Errorf("read provenance revision: %w", err)
	}
	if PrincipalState(principalState) != PrincipalStateActive {
		return ProvenanceInvalidationFact{}, ErrPrincipalTombstoned
	}
	if actualRevision != expectedRevision {
		return ProvenanceInvalidationFact{}, ErrRevisionConflict
	}
	nextRevision := expectedRevision + 1
	result, err := tx.ExecContext(ctx, `UPDATE local_app_records SET provenance_revision = ?
		WHERE local_os_user_anchor = ? AND local_app_principal_id = ? AND provenance_revision = ?`, nextRevision, store.kernel.anchor, principalID, expectedRevision)
	if err != nil {
		return ProvenanceInvalidationFact{}, fmt.Errorf("advance provenance revision: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return ProvenanceInvalidationFact{}, ErrRevisionConflict
	}
	now := store.kernel.now().UTC()
	result, err = tx.ExecContext(ctx, `INSERT INTO local_app_provenance_invalidation_facts(
		local_os_user_anchor, local_app_principal_id, local_app_record_id,
		previous_revision, current_revision, launch_leases_invalidated,
		sessions_invalidated, recorded_unix_nano
	) VALUES (?, ?, ?, ?, ?, 1, 1, ?)`, store.kernel.anchor, principalID, recordID, expectedRevision, nextRevision, now.UnixNano())
	if err != nil {
		return ProvenanceInvalidationFact{}, fmt.Errorf("record provenance invalidation fact: %w", err)
	}
	sequence, err := result.LastInsertId()
	if err != nil {
		return ProvenanceInvalidationFact{}, fmt.Errorf("read provenance invalidation sequence: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return ProvenanceInvalidationFact{}, fmt.Errorf("commit provenance advance: %w", err)
	}
	return ProvenanceInvalidationFact{
		Sequence:                uint64(sequence),
		LocalOSUserAnchor:       store.kernel.anchor,
		LocalAppPrincipalID:     principalID,
		LocalAppRecordID:        recordID,
		PreviousRevision:        expectedRevision,
		CurrentRevision:         nextRevision,
		LaunchLeasesInvalidated: true,
		SessionsInvalidated:     true,
		RecordedAt:              now,
	}, nil
}

func (store *RecordStore) ListInvalidationFacts(ctx context.Context, principalID string) ([]ProvenanceInvalidationFact, error) {
	if store == nil || store.kernel == nil {
		return nil, fmt.Errorf("%w: record store", ErrInvalidArgument)
	}
	if err := requireExactText("local_app_principal_id", principalID); err != nil {
		return nil, err
	}
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT sequence, local_os_user_anchor, local_app_principal_id,
		local_app_record_id, previous_revision, current_revision, launch_leases_invalidated,
		sessions_invalidated, recorded_unix_nano
		FROM local_app_provenance_invalidation_facts
		WHERE local_os_user_anchor = ? AND local_app_principal_id = ? ORDER BY sequence`, store.kernel.anchor, principalID)
	if err != nil {
		return nil, fmt.Errorf("list provenance invalidation facts: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var facts []ProvenanceInvalidationFact
	for rows.Next() {
		var fact ProvenanceInvalidationFact
		var launchInvalidated int
		var sessionsInvalidated int
		var recordedUnixNano int64
		if err := rows.Scan(&fact.Sequence, &fact.LocalOSUserAnchor, &fact.LocalAppPrincipalID, &fact.LocalAppRecordID,
			&fact.PreviousRevision, &fact.CurrentRevision, &launchInvalidated, &sessionsInvalidated, &recordedUnixNano); err != nil {
			return nil, fmt.Errorf("scan provenance invalidation fact: %w", err)
		}
		fact.LaunchLeasesInvalidated = launchInvalidated == 1
		fact.SessionsInvalidated = sessionsInvalidated == 1
		fact.RecordedAt = time.Unix(0, recordedUnixNano).UTC()
		facts = append(facts, fact)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate provenance invalidation facts: %w", err)
	}
	return facts, nil
}

func recordFromInput(anchor string, identifier string, input CreateRecordInput) Record {
	return Record{
		LocalOSUserAnchor:                 anchor,
		LocalAppRecordID:                  identifier,
		LocalAppPrincipalID:               input.LocalAppPrincipalID,
		TrustClass:                        input.TrustClass,
		ProvenanceAttestationRefs:         append([]string(nil), input.ProvenanceAttestationRefs...),
		ProvenanceRevision:                input.ProvenanceRevision,
		ActiveReleaseOrProjectIdentityRef: input.ActiveReleaseOrProjectIdentityRef,
		InstallOrProjectGeneration:        input.InstallOrProjectGeneration,
		ActiveCapabilityFingerprint:       input.ActiveCapabilityFingerprint,
		ExecutionProfileRef:               input.ExecutionProfileRef,
		HostExecutableDigest:              input.HostExecutableDigest,
		PayloadRootDigest:                 input.PayloadRootDigest,
		LifecycleState:                    input.LifecycleState,
	}
}

func scanRecord(row interface{ Scan(...any) error }) (Record, error) {
	var record Record
	var trustClass string
	var refsJSON string
	var lifecycleState string
	if err := row.Scan(&record.LocalOSUserAnchor, &record.LocalAppRecordID, &record.LocalAppPrincipalID,
		&trustClass, &refsJSON, &record.ProvenanceRevision, &record.ActiveReleaseOrProjectIdentityRef,
		&record.InstallOrProjectGeneration, &record.ActiveCapabilityFingerprint, &record.ExecutionProfileRef,
		&record.HostExecutableDigest, &record.PayloadRootDigest, &lifecycleState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Record{}, ErrNotFound
		}
		return Record{}, fmt.Errorf("scan local-app record: %w", err)
	}
	if err := json.Unmarshal([]byte(refsJSON), &record.ProvenanceAttestationRefs); err != nil {
		return Record{}, fmt.Errorf("decode provenance attestation references: %w", err)
	}
	record.TrustClass = TrustClass(trustClass)
	record.LifecycleState = LifecycleState(lifecycleState)
	return record, nil
}
