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

// AgentHandleStore persists Runtime-materialized per-Agent handles for
// an account-scoped grant. The opaque handle is the only Agent reference
// accepted back from an app; LocalAgent ids remain Runtime-owner truth.
type AgentHandleStore struct {
	kernel *Kernel
}

func (store *AgentHandleStore) EnsureAccountScope(ctx context.Context, input EnsureAccountScopeAgentHandleInput) (AgentHandle, error) {
	if store == nil || store.kernel == nil {
		return AgentHandle{}, fmt.Errorf("%w: Agent handle store", ErrInvalidArgument)
	}
	for name, value := range map[string]string{
		"account_id":             input.AccountID,
		"local_app_principal_id": input.LocalAppPrincipalID,
		"permission_id":          input.PermissionID,
		"owner_selector_digest":  input.OwnerSelectorDigest,
		"local_agent_id":         input.LocalAgentID,
	} {
		if err := requireExactText(name, value); err != nil {
			return AgentHandle{}, err
		}
	}
	if input.OwnerSelectorDigest != AgentAccountScopeDigest(input.AccountID) {
		return AgentHandle{}, fmt.Errorf("%w: Agent account scope digest", ErrPartitionMismatch)
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
		return AgentHandle{}, err
	}
	if principal.State != PrincipalStateActive {
		return AgentHandle{}, ErrPrincipalTombstoned
	}
	existing, err := scanAgentHandle(store.kernel.db.QueryRowContext(ctx, `SELECT
		handle, local_os_user_anchor, account_id, local_app_principal_id, permission_id,
		owner_selector_digest, local_agent_id, issued_unix_nano
		FROM local_app_agent_handles WHERE local_os_user_anchor = ? AND account_id = ?
		AND local_app_principal_id = ? AND permission_id = ? AND owner_selector_digest = ?
		AND local_agent_id = ? ORDER BY issued_unix_nano DESC, handle LIMIT 1`,
		store.kernel.anchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID,
		input.OwnerSelectorDigest, input.LocalAgentID))
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return AgentHandle{}, err
	}
	handle, err := store.kernel.nextIdentifier("lah_v1_", func(candidate string) (bool, error) {
		var found int
		err := store.kernel.db.QueryRowContext(ctx, `SELECT 1 FROM local_app_agent_handles WHERE handle = ?`, candidate).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	})
	if err != nil {
		return AgentHandle{}, fmt.Errorf("ensure local-app Agent handle: %w", err)
	}
	now := store.kernel.now().UTC()
	result := AgentHandle{
		Handle: handle, LocalOSUserAnchor: store.kernel.anchor, AccountID: input.AccountID,
		LocalAppPrincipalID: input.LocalAppPrincipalID, PermissionID: input.PermissionID,
		OwnerSelectorDigest: input.OwnerSelectorDigest, LocalAgentID: input.LocalAgentID, IssuedAt: now,
	}
	if _, err := store.kernel.db.ExecContext(ctx, `INSERT INTO local_app_agent_handles(
		handle, local_os_user_anchor, account_id, local_app_principal_id, permission_id,
		owner_selector_digest, local_agent_id, issued_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, result.Handle, result.LocalOSUserAnchor, result.AccountID,
		result.LocalAppPrincipalID, result.PermissionID, result.OwnerSelectorDigest, result.LocalAgentID, result.IssuedAt.UnixNano()); err != nil {
		return AgentHandle{}, fmt.Errorf("persist local-app Agent handle: %w", err)
	}
	return result, nil
}

func (store *AgentHandleStore) Resolve(ctx context.Context, input ResolveAgentHandleInput) (AgentHandle, error) {
	if store == nil || store.kernel == nil {
		return AgentHandle{}, fmt.Errorf("%w: Agent handle store", ErrInvalidArgument)
	}
	for name, value := range map[string]string{
		"handle":                 input.Handle,
		"account_id":             input.AccountID,
		"local_app_principal_id": input.LocalAppPrincipalID,
		"permission_id":          input.PermissionID,
	} {
		if err := requireExactText(name, value); err != nil {
			return AgentHandle{}, err
		}
	}
	resolved, err := scanAgentHandle(store.kernel.db.QueryRowContext(ctx, `SELECT
		handle, local_os_user_anchor, account_id, local_app_principal_id, permission_id,
		owner_selector_digest, local_agent_id, issued_unix_nano
		FROM local_app_agent_handles WHERE handle = ?`, input.Handle))
	if err != nil {
		return AgentHandle{}, err
	}
	if resolved.LocalOSUserAnchor != store.kernel.anchor || resolved.AccountID != input.AccountID ||
		resolved.LocalAppPrincipalID != input.LocalAppPrincipalID || resolved.PermissionID != input.PermissionID {
		return AgentHandle{}, ErrPartitionMismatch
	}
	if resolved.OwnerSelectorDigest != AgentAccountScopeDigest(resolved.AccountID) {
		return AgentHandle{}, ErrStateConflict
	}
	return resolved, nil
}

func scanAgentHandle(row interface{ Scan(...any) error }) (AgentHandle, error) {
	var handle AgentHandle
	var issuedUnixNano int64
	if err := row.Scan(&handle.Handle, &handle.LocalOSUserAnchor, &handle.AccountID, &handle.LocalAppPrincipalID,
		&handle.PermissionID, &handle.OwnerSelectorDigest, &handle.LocalAgentID, &issuedUnixNano); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AgentHandle{}, ErrNotFound
		}
		return AgentHandle{}, fmt.Errorf("scan local-app Agent handle: %w", err)
	}
	handle.IssuedAt = time.Unix(0, issuedUnixNano).UTC()
	return handle, nil
}

func AgentAccountScopeDigest(accountID string) string {
	digest := sha256.Sum256([]byte("nimi.local-app.owner-agent-account-scope.v1\x00" + accountID))
	return "lasd_v2_" + base64.RawURLEncoding.EncodeToString(digest[:])
}
