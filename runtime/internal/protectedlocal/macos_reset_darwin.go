//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// MacOSProtectedStateResetResult contains no credential or ledger material.
type MacOSProtectedStateResetResult struct {
	SchemaVersion int    `json:"schemaVersion"`
	Disposition   string `json:"disposition"`
	StateRoot     string `json:"stateRoot"`
}

// ResetMacOSProtectedState is the explicit, root-only destructive counterpart
// to installer provisioning. The caller must stop launchd first. The running
// binary, fixed installed path, release record, role signature, state root,
// service principal, Keychain ACL, and complete state inventory are verified
// before any deletion starts.
func ResetMacOSProtectedState(ctx context.Context) (_ MacOSProtectedStateResetResult, resultErr error) {
	if ctx == nil {
		return MacOSProtectedStateResetResult{}, fmt.Errorf("reset macOS protected state: context is required")
	}
	if err := ctx.Err(); err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	if os.Geteuid() != 0 || os.Getuid() != 0 || os.Getegid() != 0 || os.Getgid() != 0 {
		return MacOSProtectedStateResetResult{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "run_signed_installer_as_administrator", fmt.Errorf("reset macOS protected state: real root principal is required"))
	}
	_, liveness, err := verifyMacOSInstalledProvisioningProcess()
	if err != nil {
		return MacOSProtectedStateResetResult{}, fail(ReasonRuntimeExecutableTrustRecordInvalid, false, "reinstall_signed_release", err)
	}
	defer func() { resultErr = errors.Join(resultErr, liveness.Close()) }()
	principal, err := resolveMacOSRuntimePrincipal()
	if err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	stateRoot, err := validateMacOSRuntimeStateRoot(MacOSRuntimeStateRoot, principal)
	if err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	secrets, err := OpenMacOSSystemKeychainSecretStore()
	if err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	defer func() { resultErr = errors.Join(resultErr, secrets.Close()) }()
	inventory, err := inspectMacOSProvisionInventory(ctx, stateRoot, principal, secrets)
	if err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	disposition, err := classifyMacOSProvisionInventory(inventory)
	if err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	if disposition == macOSProvisionFresh {
		return MacOSProtectedStateResetResult{SchemaVersion: 1, Disposition: "already_empty", StateRoot: stateRoot}, nil
	}
	stateLock, err := openExistingMacOSRuntimeStateLock(stateRoot, principal, "stop_runtime_service_before_reset")
	if err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	for _, name := range []string{macOSLedgerAnchorSecretName, macOSLedgerRecordMACKeyName} {
		if err := secrets.Delete(ctx, name); err != nil && !errors.Is(err, ErrProtectedSecretNotFound) {
			_ = stateLock.Close()
			return MacOSProtectedStateResetResult{}, err
		}
	}
	for _, name := range []string{LedgerFilename + "-journal", LedgerFilename + "-shm", LedgerFilename + "-wal", LedgerFilename} {
		if err := removeFreshMacOSLedgerArtifact(filepath.Join(stateRoot, name), principal); err != nil {
			_ = stateLock.Close()
			return MacOSProtectedStateResetResult{}, err
		}
	}
	runtimeDirectory := filepath.Join(stateRoot, macOSRuntimeMutableDirectoryName)
	if inventory.runtimeDir {
		if err := os.RemoveAll(runtimeDirectory); err != nil {
			_ = stateLock.Close()
			return MacOSProtectedStateResetResult{}, fmt.Errorf("remove macOS Runtime mutable state: %w", err)
		}
	}
	if err := stateLock.Close(); err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	if err := os.Remove(filepath.Join(stateRoot, MacOSRuntimeStateLockFilename)); err != nil {
		return MacOSProtectedStateResetResult{}, fmt.Errorf("remove macOS Runtime state lock: %w", err)
	}
	if err := syncMacOSProtectedStateDirectory(stateRoot); err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	select {
	case <-liveness.Revoked():
		return MacOSProtectedStateResetResult{}, fail(ReasonRuntimeExecutableTrustRecordInvalid, false, "reinstall_signed_release", fmt.Errorf("reset macOS protected state: Runtime executable changed during transaction"))
	default:
	}
	return MacOSProtectedStateResetResult{SchemaVersion: 1, Disposition: "reset", StateRoot: stateRoot}, nil
}
