package localappkernel

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"time"
)

// AgentSelectorHandleStore persists canonical-owner selections. The opaque
// handle is the only selector reference accepted back from an app; LocalAgent
// ids are returned only to Runtime owner-side consumers after binding checks.
type AgentSelectorHandleStore struct {
	kernel *Kernel
}

func (store *AgentSelectorHandleStore) Issue(ctx context.Context, input IssueAgentSelectorHandleInput) (AgentSelectorHandle, error) {
	if store == nil || store.kernel == nil {
		return AgentSelectorHandle{}, fmt.Errorf("%w: Agent selector handle store", ErrInvalidArgument)
	}
	for name, value := range map[string]string{
		"account_id":             input.AccountID,
		"local_app_principal_id": input.LocalAppPrincipalID,
		"permission_id":          input.PermissionID,
		"local_agent_id":         input.LocalAgentID,
	} {
		if err := requireExactText(name, value); err != nil {
			return AgentSelectorHandle{}, err
		}
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	principal, err := scanPrincipal(store.kernel.db.QueryRowContext(ctx, `SELECT
		local_os_user_anchor, local_app_principal_id, principal_kind, app_id,
		immutable_lineage_id, development_authorization_id, canonical_project_file_id,
		state, created_unix_nano, tombstoned_unix_nano
		FROM local_app_principals WHERE local_os_user_anchor = ? AND local_app_principal_id = ?`,
		store.kernel.anchor, input.LocalAppPrincipalID))
	if err != nil {
		return AgentSelectorHandle{}, err
	}
	if principal.State != PrincipalStateActive {
		return AgentSelectorHandle{}, ErrPrincipalTombstoned
	}
	handle, err := store.kernel.nextIdentifier("lash_v1_", func(candidate string) (bool, error) {
		var found int
		err := store.kernel.db.QueryRowContext(ctx, `SELECT 1 FROM local_app_agent_selector_handles WHERE handle = ?`, candidate).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	})
	if err != nil {
		return AgentSelectorHandle{}, fmt.Errorf("issue local-app Agent selector handle: %w", err)
	}
	digest := agentSelectorDigest(input.LocalAgentID)
	now := store.kernel.now().UTC()
	result := AgentSelectorHandle{
		Handle: handle, LocalOSUserAnchor: store.kernel.anchor, AccountID: input.AccountID,
		LocalAppPrincipalID: input.LocalAppPrincipalID, PermissionID: input.PermissionID,
		OwnerSelectorDigest: digest, LocalAgentID: input.LocalAgentID, IssuedAt: now,
	}
	if _, err := store.kernel.db.ExecContext(ctx, `INSERT INTO local_app_agent_selector_handles(
		handle, local_os_user_anchor, account_id, local_app_principal_id, permission_id,
		owner_selector_digest, local_agent_id, issued_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, result.Handle, result.LocalOSUserAnchor, result.AccountID,
		result.LocalAppPrincipalID, result.PermissionID, result.OwnerSelectorDigest, result.LocalAgentID, result.IssuedAt.UnixNano()); err != nil {
		return AgentSelectorHandle{}, fmt.Errorf("persist local-app Agent selector handle: %w", err)
	}
	return result, nil
}

func (store *AgentSelectorHandleStore) Resolve(ctx context.Context, input ResolveAgentSelectorHandleInput) (AgentSelectorHandle, error) {
	if store == nil || store.kernel == nil {
		return AgentSelectorHandle{}, fmt.Errorf("%w: Agent selector handle store", ErrInvalidArgument)
	}
	for name, value := range map[string]string{
		"handle":                 input.Handle,
		"account_id":             input.AccountID,
		"local_app_principal_id": input.LocalAppPrincipalID,
		"permission_id":          input.PermissionID,
	} {
		if err := requireExactText(name, value); err != nil {
			return AgentSelectorHandle{}, err
		}
	}
	resolved, err := scanAgentSelectorHandle(store.kernel.db.QueryRowContext(ctx, `SELECT
		handle, local_os_user_anchor, account_id, local_app_principal_id, permission_id,
		owner_selector_digest, local_agent_id, issued_unix_nano
		FROM local_app_agent_selector_handles WHERE handle = ?`, input.Handle))
	if err != nil {
		return AgentSelectorHandle{}, err
	}
	if resolved.LocalOSUserAnchor != store.kernel.anchor || resolved.AccountID != input.AccountID ||
		resolved.LocalAppPrincipalID != input.LocalAppPrincipalID || resolved.PermissionID != input.PermissionID {
		return AgentSelectorHandle{}, ErrPartitionMismatch
	}
	if resolved.OwnerSelectorDigest != agentSelectorDigest(resolved.LocalAgentID) {
		return AgentSelectorHandle{}, ErrStateConflict
	}
	return resolved, nil
}

func (store *AgentSelectorHandleStore) ResolveByDigest(ctx context.Context, accountID, localAppPrincipalID, permissionID, ownerSelectorDigest string) (AgentSelectorHandle, error) {
	if store == nil || store.kernel == nil {
		return AgentSelectorHandle{}, fmt.Errorf("%w: Agent selector handle store", ErrInvalidArgument)
	}
	for name, value := range map[string]string{"account_id": accountID, "local_app_principal_id": localAppPrincipalID, "permission_id": permissionID, "owner_selector_digest": ownerSelectorDigest} {
		if err := requireExactText(name, value); err != nil {
			return AgentSelectorHandle{}, err
		}
	}
	resolved, err := scanAgentSelectorHandle(store.kernel.db.QueryRowContext(ctx, `SELECT handle, local_os_user_anchor,
		account_id, local_app_principal_id, permission_id, owner_selector_digest, local_agent_id, issued_unix_nano
		FROM local_app_agent_selector_handles WHERE local_os_user_anchor = ? AND account_id = ?
		AND local_app_principal_id = ? AND permission_id = ? AND owner_selector_digest = ?
		ORDER BY issued_unix_nano DESC, handle LIMIT 1`, store.kernel.anchor, accountID, localAppPrincipalID, permissionID, ownerSelectorDigest))
	if err != nil {
		return AgentSelectorHandle{}, err
	}
	if resolved.OwnerSelectorDigest != agentSelectorDigest(resolved.LocalAgentID) {
		return AgentSelectorHandle{}, ErrStateConflict
	}
	return resolved, nil
}

func scanAgentSelectorHandle(row interface{ Scan(...any) error }) (AgentSelectorHandle, error) {
	var handle AgentSelectorHandle
	var issuedUnixNano int64
	if err := row.Scan(&handle.Handle, &handle.LocalOSUserAnchor, &handle.AccountID, &handle.LocalAppPrincipalID,
		&handle.PermissionID, &handle.OwnerSelectorDigest, &handle.LocalAgentID, &issuedUnixNano); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AgentSelectorHandle{}, ErrNotFound
		}
		return AgentSelectorHandle{}, fmt.Errorf("scan local-app Agent selector handle: %w", err)
	}
	handle.IssuedAt = time.Unix(0, issuedUnixNano).UTC()
	return handle, nil
}

func agentSelectorDigest(localAgentID string) string {
	digest := sha256.Sum256([]byte("nimi.local-app.owner-agent-selector.v1\x00" + localAgentID))
	return "lasd_v1_" + base64.RawURLEncoding.EncodeToString(digest[:])
}
