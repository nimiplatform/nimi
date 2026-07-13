package localappkernel

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type GrantStore struct {
	kernel *Kernel
}

func (store *GrantStore) CreatePending(ctx context.Context, input CreatePendingGrantInput) (Grant, error) {
	if store == nil || store.kernel == nil {
		return Grant{}, fmt.Errorf("%w: grant store", ErrInvalidArgument)
	}
	if err := validateGrantInput(input); err != nil {
		return Grant{}, err
	}
	if input.ExpiresAt != nil && !input.ExpiresAt.After(store.kernel.now().UTC()) {
		return Grant{}, fmt.Errorf("%w: expires_at", ErrInvalidArgument)
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return Grant{}, fmt.Errorf("begin pending grant: %w", err)
	}
	defer tx.Rollback()
	principal, err := scanPrincipal(tx.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, local_app_principal_id, principal_kind, app_id,
		immutable_lineage_id, development_authorization_id, canonical_project_file_id,
		state, created_unix_nano, tombstoned_unix_nano
		FROM local_app_principals WHERE local_os_user_anchor = ? AND local_app_principal_id = ?`, store.kernel.anchor, input.LocalAppPrincipalID))
	if err != nil {
		return Grant{}, err
	}
	if principal.State != PrincipalStateActive {
		return Grant{}, ErrPrincipalTombstoned
	}
	existing, existingErr := scanGrant(tx.QueryRowContext(ctx, grantSelect+` WHERE g.local_os_user_anchor = ? AND g.account_id = ?
		AND g.local_app_principal_id = ? AND g.capability_resource_fingerprint = ?`, store.kernel.anchor,
		input.AccountID, input.LocalAppPrincipalID, input.CapabilityResourceFingerprint))
	if existingErr != nil && !errors.Is(existingErr, ErrNotFound) {
		return Grant{}, existingErr
	}
	if existingErr == nil {
		if existing.State == GrantStatePending || existing.State == GrantStateGranted {
			return Grant{}, ErrStateConflict
		}
		if input.SupersedesGrantID != existing.GrantID || input.GrantGeneration <= existing.GrantGeneration || input.GrantRevision <= existing.GrantRevision {
			return Grant{}, fmt.Errorf("%w: new request must supersede terminal grant with increasing generation and revision", ErrInvalidArgument)
		}
	} else if input.SupersedesGrantID != "" {
		return Grant{}, fmt.Errorf("%w: supersedes_grant_id without prior grant", ErrInvalidArgument)
	}
	grantID, err := store.kernel.nextIdentifier("lag_v1_", func(candidate string) (bool, error) {
		var found int
		err := tx.QueryRowContext(ctx, `SELECT 1 FROM local_app_grants WHERE grant_id = ?`, candidate).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	})
	if err != nil {
		return Grant{}, fmt.Errorf("create pending local-app grant: %w", err)
	}
	capabilityJSON, err := json.Marshal(input.CapabilityScope)
	if err != nil {
		return Grant{}, fmt.Errorf("encode capability scope: %w", err)
	}
	resourceJSON, err := json.Marshal(input.ResourceScope)
	if err != nil {
		return Grant{}, fmt.Errorf("encode resource scope: %w", err)
	}
	now := store.kernel.now().UTC()
	var expiresUnixNano any
	if input.ExpiresAt != nil {
		expiresUnixNano = input.ExpiresAt.UTC().UnixNano()
	}
	if existingErr == nil {
		_, err = tx.ExecContext(ctx, `UPDATE local_app_grants SET grant_id = ?, capability_scope_json = ?, resource_scope_json = ?,
			grant_generation = ?, grant_revision = ?, state = 'pending', issued_unix_nano = ?, expires_unix_nano = ?,
			supersedes_grant_id = ?, presence_evidence_ref = ?
			WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND capability_resource_fingerprint = ?`,
			grantID, string(capabilityJSON), string(resourceJSON), input.GrantGeneration, input.GrantRevision, now.UnixNano(), expiresUnixNano,
			input.SupersedesGrantID, input.PresenceEvidenceRef, store.kernel.anchor, input.AccountID,
			input.LocalAppPrincipalID, input.CapabilityResourceFingerprint)
	} else {
		_, err = tx.ExecContext(ctx, `INSERT INTO local_app_grants(
			local_os_user_anchor, account_id, local_app_principal_id, capability_resource_fingerprint,
			grant_id, capability_scope_json, resource_scope_json, grant_generation, grant_revision,
			state, issued_unix_nano, expires_unix_nano, supersedes_grant_id, presence_evidence_ref
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`, store.kernel.anchor, input.AccountID,
			input.LocalAppPrincipalID, input.CapabilityResourceFingerprint, grantID, string(capabilityJSON), string(resourceJSON),
			input.GrantGeneration, input.GrantRevision, now.UnixNano(), expiresUnixNano, nullableText(input.SupersedesGrantID), input.PresenceEvidenceRef)
	}
	if err != nil {
		return Grant{}, fmt.Errorf("persist pending local-app grant: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Grant{}, fmt.Errorf("commit pending local-app grant: %w", err)
	}
	return grantFromInput(store.kernel.anchor, grantID, now, input), nil
}

func (store *GrantStore) Transition(ctx context.Context, accountID string, principalID string, fingerprint string, expectedRevision uint64, target GrantState, presenceEvidenceRef string) (Grant, error) {
	if store == nil || store.kernel == nil {
		return Grant{}, fmt.Errorf("%w: grant store", ErrInvalidArgument)
	}
	for name, value := range map[string]string{"account_id": accountID, "local_app_principal_id": principalID, "capability_resource_fingerprint": fingerprint} {
		if err := requireExactText(name, value); err != nil {
			return Grant{}, err
		}
	}
	if expectedRevision == 0 {
		return Grant{}, fmt.Errorf("%w: expected grant revision", ErrInvalidArgument)
	}
	if target == GrantStateGranted {
		if err := requireExactText("presence_evidence_ref", presenceEvidenceRef); err != nil {
			return Grant{}, err
		}
	} else if presenceEvidenceRef != "" && presenceEvidenceRef != strings.TrimSpace(presenceEvidenceRef) {
		return Grant{}, fmt.Errorf("%w: presence_evidence_ref", ErrInvalidArgument)
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return Grant{}, fmt.Errorf("begin grant transition: %w", err)
	}
	defer tx.Rollback()
	grant, err := scanGrant(tx.QueryRowContext(ctx, grantSelect+` WHERE g.local_os_user_anchor = ? AND g.account_id = ?
		AND g.local_app_principal_id = ? AND g.capability_resource_fingerprint = ?`, store.kernel.anchor, accountID, principalID, fingerprint))
	if err != nil {
		return Grant{}, err
	}
	if grant.GrantRevision != expectedRevision || !validGrantTransition(grant.State, target) {
		return Grant{}, ErrGrantTransition
	}
	principal, err := scanPrincipal(tx.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, local_app_principal_id, principal_kind, app_id,
		immutable_lineage_id, development_authorization_id, canonical_project_file_id,
		state, created_unix_nano, tombstoned_unix_nano
		FROM local_app_principals WHERE local_os_user_anchor = ? AND local_app_principal_id = ?`, store.kernel.anchor, principalID))
	if err != nil {
		return Grant{}, err
	}
	if principal.State != PrincipalStateActive {
		return Grant{}, ErrPrincipalTombstoned
	}
	nextRevision := expectedRevision + 1
	evidence := grant.PresenceEvidenceRef
	if presenceEvidenceRef != "" {
		evidence = presenceEvidenceRef
	}
	result, err := tx.ExecContext(ctx, `UPDATE local_app_grants SET state = ?, grant_revision = ?, presence_evidence_ref = ?
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ?
		AND capability_resource_fingerprint = ? AND grant_revision = ?`, string(target), nextRevision, evidence,
		store.kernel.anchor, accountID, principalID, fingerprint, expectedRevision)
	if err != nil {
		return Grant{}, fmt.Errorf("transition local-app grant: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return Grant{}, ErrGrantTransition
	}
	if err := tx.Commit(); err != nil {
		return Grant{}, fmt.Errorf("commit local-app grant transition: %w", err)
	}
	grant.State = target
	grant.GrantRevision = nextRevision
	grant.PresenceEvidenceRef = evidence
	return grant, nil
}

// GetCurrent is intentionally a principal-id lookup. It returns no positive
// grant for a tombstoned principal, and there is no app-id fallback API.
func (store *GrantStore) GetCurrent(ctx context.Context, accountID string, principalID string, fingerprint string) (Grant, error) {
	if store == nil || store.kernel == nil {
		return Grant{}, fmt.Errorf("%w: grant store", ErrInvalidArgument)
	}
	for name, value := range map[string]string{"account_id": accountID, "local_app_principal_id": principalID, "capability_resource_fingerprint": fingerprint} {
		if err := requireExactText(name, value); err != nil {
			return Grant{}, err
		}
	}
	grant, err := scanGrant(store.kernel.db.QueryRowContext(ctx, grantSelect+` JOIN local_app_principals p
		ON p.local_os_user_anchor = g.local_os_user_anchor AND p.local_app_principal_id = g.local_app_principal_id
		WHERE g.local_os_user_anchor = ? AND g.account_id = ? AND g.local_app_principal_id = ?
		AND g.capability_resource_fingerprint = ? AND p.state = 'active'`, store.kernel.anchor, accountID, principalID, fingerprint))
	if errors.Is(err, ErrNotFound) {
		principal, principalErr := store.kernel.principals.Get(ctx, principalID)
		if principalErr == nil && principal.State == PrincipalStateTombstoned {
			return Grant{}, ErrPrincipalTombstoned
		}
	}
	return grant, err
}

const grantSelect = `SELECT g.local_os_user_anchor, g.account_id, g.local_app_principal_id,
	g.capability_resource_fingerprint, g.grant_id, g.capability_scope_json, g.resource_scope_json,
	g.grant_generation, g.grant_revision, g.state, g.issued_unix_nano, g.expires_unix_nano,
	g.supersedes_grant_id, g.presence_evidence_ref FROM local_app_grants g`

func grantFromInput(anchor string, grantID string, issuedAt time.Time, input CreatePendingGrantInput) Grant {
	return Grant{
		LocalOSUserAnchor:             anchor,
		AccountID:                     input.AccountID,
		LocalAppPrincipalID:           input.LocalAppPrincipalID,
		CapabilityResourceFingerprint: input.CapabilityResourceFingerprint,
		GrantID:                       grantID,
		CapabilityScope:               append([]string(nil), input.CapabilityScope...),
		ResourceScope:                 append([]string(nil), input.ResourceScope...),
		GrantGeneration:               input.GrantGeneration,
		GrantRevision:                 input.GrantRevision,
		State:                         GrantStatePending,
		IssuedAt:                      issuedAt,
		ExpiresAt:                     input.ExpiresAt,
		SupersedesGrantID:             input.SupersedesGrantID,
		PresenceEvidenceRef:           input.PresenceEvidenceRef,
	}
}

func scanGrant(row interface{ Scan(...any) error }) (Grant, error) {
	var grant Grant
	var capabilityJSON string
	var resourceJSON string
	var state string
	var issuedUnixNano int64
	var expiresUnixNano sql.NullInt64
	var supersedesGrantID sql.NullString
	if err := row.Scan(&grant.LocalOSUserAnchor, &grant.AccountID, &grant.LocalAppPrincipalID,
		&grant.CapabilityResourceFingerprint, &grant.GrantID, &capabilityJSON, &resourceJSON,
		&grant.GrantGeneration, &grant.GrantRevision, &state, &issuedUnixNano, &expiresUnixNano,
		&supersedesGrantID, &grant.PresenceEvidenceRef); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Grant{}, ErrNotFound
		}
		return Grant{}, fmt.Errorf("scan local-app grant: %w", err)
	}
	if err := json.Unmarshal([]byte(capabilityJSON), &grant.CapabilityScope); err != nil {
		return Grant{}, fmt.Errorf("decode capability scope: %w", err)
	}
	if err := json.Unmarshal([]byte(resourceJSON), &grant.ResourceScope); err != nil {
		return Grant{}, fmt.Errorf("decode resource scope: %w", err)
	}
	grant.State = GrantState(state)
	grant.IssuedAt = time.Unix(0, issuedUnixNano).UTC()
	if expiresUnixNano.Valid {
		expiresAt := time.Unix(0, expiresUnixNano.Int64).UTC()
		grant.ExpiresAt = &expiresAt
	}
	grant.SupersedesGrantID = supersedesGrantID.String
	return grant, nil
}
