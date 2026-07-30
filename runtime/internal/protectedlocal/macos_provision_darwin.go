//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"os"
)

const macOSProtectedStateProvisionSchemaVersion = 1

type macOSProvisionDisposition string

const (
	macOSProvisionFresh    macOSProvisionDisposition = "fresh"
	macOSProvisionExisting macOSProvisionDisposition = "existing"
)

type macOSProvisionInventory struct {
	stateLock    bool
	mutableState bool
}

// MacOSProtectedStateProvisionResult describes the fixed state root established
// for the Runtime service. Per-process authority is deliberately not persisted.
type MacOSProtectedStateProvisionResult struct {
	SchemaVersion int    `json:"schemaVersion"`
	Disposition   string `json:"disposition"`
	StateRoot     string `json:"stateRoot"`
	RuntimePath   string `json:"runtimePath"`
}

// MacOSProtectedStateStatusResult is the read-only installer state status.
type MacOSProtectedStateStatusResult struct {
	SchemaVersion int    `json:"schemaVersion"`
	Disposition   string `json:"disposition"`
	StateRoot     string `json:"stateRoot"`
	RuntimePath   string `json:"runtimePath"`
}

// VerifyMacOSProtectedState validates the installed executable, service principal,
// state root, and state-lock inventory without changing them.
func VerifyMacOSProtectedState(ctx context.Context) (MacOSProtectedStateStatusResult, error) {
	if ctx == nil {
		return MacOSProtectedStateStatusResult{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("verify macOS Runtime state: context is required"))
	}
	if err := ctx.Err(); err != nil {
		return MacOSProtectedStateStatusResult{}, err
	}
	if os.Geteuid() != 0 || os.Getuid() != 0 || os.Getegid() != 0 || os.Getgid() != 0 {
		return MacOSProtectedStateStatusResult{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "run_signed_installer_as_administrator", fmt.Errorf("verify macOS Runtime state: real root principal is required"))
	}
	if err := verifyMacOSInstalledProvisioningProcess(); err != nil {
		return MacOSProtectedStateStatusResult{}, fail(ReasonRuntimeExecutableTrustInvalid, false, "reinstall_runtime_service", err)
	}
	principal, err := resolveMacOSRuntimePrincipal()
	if err != nil {
		return MacOSProtectedStateStatusResult{}, err
	}
	stateRoot, err := validateMacOSRuntimeStateRoot(MacOSRuntimeStateRoot, principal)
	if err != nil {
		return MacOSProtectedStateStatusResult{}, err
	}
	inventory, err := inspectMacOSProvisionInventory(stateRoot, principal)
	if err != nil {
		return MacOSProtectedStateStatusResult{}, err
	}
	disposition, err := classifyMacOSProvisionInventory(inventory)
	if err != nil || disposition != macOSProvisionExisting {
		return MacOSProtectedStateStatusResult{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("verify macOS Runtime state: installed state lock is required"))
	}
	return MacOSProtectedStateStatusResult{SchemaVersion: macOSProtectedStateProvisionSchemaVersion, Disposition: "verified", StateRoot: stateRoot, RuntimePath: MacOSRuntimeExecutablePath}, nil
}

func classifyMacOSProvisionInventory(inventory macOSProvisionInventory) (macOSProvisionDisposition, error) {
	if !inventory.stateLock && !inventory.mutableState {
		return macOSProvisionFresh, nil
	}
	if inventory.stateLock {
		return macOSProvisionExisting, nil
	}
	return "", fail(
		ReasonProtectedLocalCustodyBoundaryUnavailable,
		false,
		"repair_runtime_service",
		fmt.Errorf("classify macOS Runtime state: mutable state without the service lock requires explicit repair"),
	)
}

// ProvisionMacOSProtectedState executes the signed installer's no-input
// state-root transaction. The installer must invoke the already-installed Runtime
// binary at its fixed sealed path before registering the launchd service.
func ProvisionMacOSProtectedState(ctx context.Context) (_ MacOSProtectedStateProvisionResult, resultErr error) {
	if ctx == nil {
		return MacOSProtectedStateProvisionResult{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("provision macOS Runtime state: context is required"))
	}
	if err := ctx.Err(); err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	if os.Geteuid() != 0 || os.Getuid() != 0 || os.Getegid() != 0 || os.Getgid() != 0 {
		return MacOSProtectedStateProvisionResult{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "run_signed_installer_as_administrator", fmt.Errorf("provision macOS Runtime state: real root principal is required"))
	}

	if err := verifyMacOSInstalledProvisioningProcess(); err != nil {
		return MacOSProtectedStateProvisionResult{}, fail(ReasonRuntimeExecutableTrustInvalid, false, "reinstall_runtime_service", err)
	}
	principal, err := resolveMacOSRuntimePrincipal()
	if err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	stateRoot, err := validateMacOSRuntimeStateRoot(MacOSRuntimeStateRoot, principal)
	if err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}

	inventory, err := inspectMacOSProvisionInventory(stateRoot, principal)
	if err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	disposition, err := classifyMacOSProvisionInventory(inventory)
	if err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}

	var stateLock *macOSRuntimeStateLock
	createdLock := false
	if disposition == macOSProvisionFresh {
		stateLock, err = createMacOSRuntimeStateLock(stateRoot, principal)
		createdLock = err == nil
	} else {
		stateLock, err = openExistingMacOSRuntimeStateLock(stateRoot, principal, "stop_runtime_service_before_install")
	}
	if err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	defer func() { resultErr = errors.Join(resultErr, stateLock.Close()) }()

	committed := false
	if disposition == macOSProvisionFresh {
		defer func() {
			if committed {
				return
			}
			rollbackErr := rollbackFreshMacOSProvision(stateRoot, principal, stateLock, createdLock)
			if rollbackErr != nil {
				rollbackErr = fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("rollback fresh macOS Runtime state: %w", rollbackErr))
			}
			resultErr = errors.Join(resultErr, rollbackErr)
		}()
	}

	committed = true
	resultDisposition := "validated"
	if disposition == macOSProvisionFresh {
		resultDisposition = "created"
	}
	return MacOSProtectedStateProvisionResult{
		SchemaVersion: macOSProtectedStateProvisionSchemaVersion,
		Disposition:   resultDisposition,
		StateRoot:     stateRoot,
		RuntimePath:   MacOSRuntimeExecutablePath,
	}, nil
}

func verifyMacOSInstalledProvisioningProcess() error {
	snapshot, err := inspectMacOSProcess(uint32(os.Getpid()))
	if err != nil {
		return fmt.Errorf("inspect installed macOS Runtime provisioner process: %w", err)
	}
	if snapshot.euid != 0 || snapshot.ruid != 0 || snapshot.executablePath != MacOSRuntimeExecutablePath {
		return fmt.Errorf("installed macOS Runtime provisioner principal or path mismatch")
	}
	policy, err := macOSRuntimeCodePolicy()
	if err != nil {
		return err
	}
	if _, err := verifyMacOSProcessIdentity(snapshot, nil, policy, MacOSRuntimeExecutablePath, 0, false); err != nil {
		return fmt.Errorf("verify installed macOS Runtime provisioner: %w", err)
	}
	return nil
}
