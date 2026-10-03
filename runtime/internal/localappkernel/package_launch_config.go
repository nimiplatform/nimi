package localappkernel

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ReadLaunchConfig returns installation-owned launch inputs for the exact
// committed release. Installation must supply missing inputs; launch never reconstructs
// them from mutable package files or silently performs an installation scan.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
func (store *PackageLifecycleStore) ReadLaunchConfig(ctx context.Context, handle, releaseRef string) ([]byte, error) {
	if store == nil || store.kernel == nil || requireExactText("registration_handle", handle) != nil || requireExactText("release_ref", releaseRef) != nil {
		return nil, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	var raw []byte
	err := store.kernel.db.QueryRowContext(ctx, `SELECT c.config_json FROM app_package_launch_config c
		JOIN committed_app_release r ON r.app_id = c.app_id AND r.source_class = c.source_class AND r.release_ref = c.release_ref
		WHERE r.registration_handle = ? AND r.release_ref = ?`, handle, releaseRef).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrCommittedReleaseNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read committed App launch configuration: %w", err)
	}
	return raw, nil
}
