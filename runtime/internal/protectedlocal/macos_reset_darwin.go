//go:build darwin && cgo && !nimi_macos_source_local_development

package protectedlocal

import (
	"context"
	"fmt"
	"os"
)

// MacOSProtectedStateResetResult contains no credential material.
type MacOSProtectedStateResetResult struct {
	SchemaVersion int    `json:"schemaVersion"`
	Disposition   string `json:"disposition"`
	StateRoot     string `json:"stateRoot"`
}

// ResetMacOSProtectedState is the explicit, root-only destructive counterpart
// to installer provisioning. The caller must stop launchd first. The running
// binary, fixed installed path, direct code signer, state root, service
// principal, and retained state lock are verified before any deletion starts.
func ResetMacOSProtectedState(ctx context.Context) (MacOSProtectedStateResetResult, error) {
	if ctx == nil {
		return MacOSProtectedStateResetResult{}, fmt.Errorf("reset macOS protected state: context is required")
	}
	if err := ctx.Err(); err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	if os.Geteuid() != 0 || os.Getuid() != 0 || os.Getegid() != 0 || os.Getgid() != 0 {
		return MacOSProtectedStateResetResult{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "run_signed_installer_as_administrator", fmt.Errorf("reset macOS protected state: real root principal is required"))
	}
	if err := verifyMacOSInstalledProvisioningProcess(); err != nil {
		return MacOSProtectedStateResetResult{}, fail(ReasonRuntimeExecutableTrustInvalid, false, "reinstall_runtime_service", err)
	}
	principal, err := resolveMacOSRuntimePrincipal()
	if err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	stateRoot, err := validateMacOSRuntimeStateRoot(MacOSRuntimeStateRoot, principal)
	if err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	inventory, err := inspectMacOSProvisionInventory(stateRoot, principal)
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
	if inventory.mutableState {
		if err := removeMacOSRuntimeMutableState(stateRoot, stateLock); err != nil {
			_ = stateLock.Close()
			return MacOSProtectedStateResetResult{}, err
		}
	}
	if err := removeCreatedMacOSRuntimeStateLock(stateRoot, stateLock, principal); err != nil {
		_ = stateLock.Close()
		return MacOSProtectedStateResetResult{}, err
	}
	if err := stateLock.Close(); err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	if err := syncMacOSProtectedStateDirectory(stateRoot); err != nil {
		return MacOSProtectedStateResetResult{}, err
	}
	return MacOSProtectedStateResetResult{SchemaVersion: 1, Disposition: "reset", StateRoot: stateRoot}, nil
}
