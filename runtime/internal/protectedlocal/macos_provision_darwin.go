//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const macOSProtectedStateProvisionSchemaVersion = 1

type macOSProvisionDisposition string

const (
	macOSProvisionFresh    macOSProvisionDisposition = "fresh"
	macOSProvisionExisting macOSProvisionDisposition = "existing"
)

type macOSProvisionInventory struct {
	stateLock  bool
	ledger     bool
	ledgerWAL  bool
	ledgerSHM  bool
	runtimeDir bool
	recordKey  bool
	anchor     bool
}

// MacOSProtectedStateProvisionResult is the credential-free installer result.
// It intentionally contains no key name, key material, ledger identity,
// release digest, account identifier, or process evidence.
type MacOSProtectedStateProvisionResult struct {
	SchemaVersion int    `json:"schemaVersion"`
	Disposition   string `json:"disposition"`
	StateRoot     string `json:"stateRoot"`
	RuntimePath   string `json:"runtimePath"`
}

// MacOSProtectedStateStatusResult is the read-only installer custody proof.
// A separate operation is necessary because reusing Provision would be unsafe:
// its fresh branch creates custody and its existing branch normalizes metadata.
type MacOSProtectedStateStatusResult struct {
	SchemaVersion int    `json:"schemaVersion"`
	Disposition   string `json:"disposition"`
	StateRoot     string `json:"stateRoot"`
	RuntimePath   string `json:"runtimePath"`
	CustodyACLs   string `json:"custodyACLs"`
}

// VerifyMacOSProtectedState proves the installed executable, role principal,
// state inventory, and both exact Keychain item ACLs without changing them.
func VerifyMacOSProtectedState(ctx context.Context) (_ MacOSProtectedStateStatusResult, resultErr error) {
	if ctx == nil {
		return MacOSProtectedStateStatusResult{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("verify macOS Runtime custody: context is required"))
	}
	if os.Geteuid() != 0 || os.Getuid() != 0 || os.Getegid() != 0 || os.Getgid() != 0 {
		return MacOSProtectedStateStatusResult{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "run_signed_installer_as_administrator", fmt.Errorf("verify macOS Runtime custody: real root principal is required"))
	}
	_, liveness, err := verifyMacOSInstalledProvisioningProcess()
	if err != nil {
		return MacOSProtectedStateStatusResult{}, fail(ReasonRuntimeExecutableTrustRecordInvalid, false, "reinstall_signed_release", err)
	}
	defer func() { resultErr = errors.Join(resultErr, liveness.Close()) }()
	principal, err := resolveMacOSRuntimePrincipal()
	if err != nil {
		return MacOSProtectedStateStatusResult{}, err
	}
	stateRoot, err := validateMacOSRuntimeStateRoot(MacOSRuntimeStateRoot, principal)
	if err != nil {
		return MacOSProtectedStateStatusResult{}, err
	}
	secrets, err := OpenMacOSSystemKeychainSecretStore()
	if err != nil {
		return MacOSProtectedStateStatusResult{}, err
	}
	defer func() { resultErr = errors.Join(resultErr, secrets.Close()) }()
	inventory, err := inspectMacOSProvisionInventory(ctx, stateRoot, principal, secrets)
	if err != nil {
		return MacOSProtectedStateStatusResult{}, err
	}
	disposition, err := classifyMacOSProvisionInventory(inventory)
	if err != nil || disposition != macOSProvisionExisting {
		return MacOSProtectedStateStatusResult{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("verify macOS Runtime custody: complete existing inventory is required"))
	}
	return MacOSProtectedStateStatusResult{SchemaVersion: macOSProtectedStateProvisionSchemaVersion, Disposition: "verified", StateRoot: stateRoot, RuntimePath: MacOSRuntimeExecutablePath, CustodyACLs: "verified"}, nil
}

func classifyMacOSProvisionInventory(inventory macOSProvisionInventory) (macOSProvisionDisposition, error) {
	if !inventory.stateLock && !inventory.ledger && !inventory.ledgerWAL && !inventory.ledgerSHM &&
		!inventory.runtimeDir && !inventory.recordKey && !inventory.anchor {
		return macOSProvisionFresh, nil
	}
	if inventory.stateLock && inventory.ledger && inventory.recordKey && inventory.anchor {
		return macOSProvisionExisting, nil
	}
	return "", fail(
		ReasonProtectedLocalCustodyBoundaryUnavailable,
		false,
		"repair_runtime_service",
		fmt.Errorf("classify macOS Runtime custody: partial state cannot be initialized or reset implicitly"),
	)
}

// ProvisionMacOSProtectedState executes the signed installer's no-input
// custody transaction. The installer must invoke the already-installed Runtime
// binary at its fixed sealed path before registering the launchd service.
func ProvisionMacOSProtectedState(ctx context.Context) (_ MacOSProtectedStateProvisionResult, resultErr error) {
	if ctx == nil {
		return MacOSProtectedStateProvisionResult{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("provision macOS Runtime custody: context is required"))
	}
	if err := ctx.Err(); err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	if os.Geteuid() != 0 || os.Getuid() != 0 || os.Getegid() != 0 || os.Getgid() != 0 {
		return MacOSProtectedStateProvisionResult{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "run_signed_installer_as_administrator", fmt.Errorf("provision macOS Runtime custody: real root principal is required"))
	}

	runtimePolicy, provisionLiveness, err := verifyMacOSInstalledProvisioningProcess()
	if err != nil {
		return MacOSProtectedStateProvisionResult{}, fail(ReasonRuntimeExecutableTrustRecordInvalid, false, "reinstall_signed_release", err)
	}
	defer func() { resultErr = errors.Join(resultErr, provisionLiveness.Close()) }()
	principal, err := resolveMacOSRuntimePrincipal()
	if err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	stateRoot, err := validateMacOSRuntimeStateRoot(MacOSRuntimeStateRoot, principal)
	if err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	secrets, err := OpenMacOSSystemKeychainSecretStore()
	if err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	defer func() { resultErr = errors.Join(resultErr, secrets.Close()) }()

	inventory, err := inspectMacOSProvisionInventory(ctx, stateRoot, principal, secrets)
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
			rollbackErr := rollbackFreshMacOSProvision(stateRoot, principal, stateLock, secrets, createdLock)
			if rollbackErr != nil {
				rollbackErr = fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("rollback fresh macOS Runtime custody: %w", rollbackErr))
			}
			resultErr = errors.Join(resultErr, rollbackErr)
		}()
	}

	if disposition == macOSProvisionFresh {
		if err := initializeFreshMacOSLedger(ctx, stateRoot, secrets, runtimePolicy.releaseLineage()); err != nil {
			return MacOSProtectedStateProvisionResult{}, err
		}
	} else if err := validateExistingMacOSLedger(ctx, stateRoot, secrets, runtimePolicy.releaseLineage()); err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	if err := secureMacOSLedgerArtifacts(stateRoot, principal, true); err != nil {
		return MacOSProtectedStateProvisionResult{}, err
	}
	select {
	case <-provisionLiveness.Revoked():
		return MacOSProtectedStateProvisionResult{}, fail(ReasonRuntimeExecutableTrustRecordInvalid, false, "reinstall_signed_release", fmt.Errorf("provision macOS Runtime custody: Runtime executable changed during transaction"))
	default:
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

func verifyMacOSInstalledProvisioningProcess() (macOSCodePolicy, DesktopProcessLiveness, error) {
	snapshot, err := inspectMacOSProcess(uint32(os.Getpid()))
	if err != nil {
		return macOSCodePolicy{}, nil, fmt.Errorf("inspect installed macOS Runtime provisioner process: %w", err)
	}
	if snapshot.euid != 0 || snapshot.ruid != 0 || snapshot.executablePath != MacOSRuntimeExecutablePath {
		return macOSCodePolicy{}, nil, fmt.Errorf("installed macOS Runtime provisioner principal or path mismatch")
	}
	policy, err := macOSRuntimeCodePolicy()
	if err != nil {
		return macOSCodePolicy{}, nil, err
	}
	_, liveness, err := verifyMacOSProcess(snapshot, nil, policy, MacOSRuntimeExecutablePath, 0, false, nil)
	if err != nil {
		return macOSCodePolicy{}, nil, fmt.Errorf("verify installed macOS Runtime provisioner: %w", err)
	}
	return policy, liveness, nil
}

func initializeFreshMacOSLedger(ctx context.Context, stateRoot string, secrets BinarySecretStore, lineage ReleaseLineageRecord) error {
	recordKey := make([]byte, macOSLedgerRecordMACKeyBytes)
	defer zeroBytes(recordKey)
	if _, err := io.ReadFull(rand.Reader, recordKey); err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("generate macOS ledger record MAC key: %w", err))
	}
	allZero := true
	for _, value := range recordKey {
		allZero = allZero && value == 0
	}
	if allZero {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("generate macOS ledger record MAC key: all-zero output"))
	}
	if err := secrets.Store(ctx, macOSLedgerRecordMACKeyName, recordKey); err != nil {
		return err
	}
	anchorStore, err := NewMacOSKeychainAnchorStore(secrets)
	if err != nil {
		return err
	}
	ledger, err := OpenLedger(ctx, LedgerOptions{
		Path:         filepath.Join(stateRoot, LedgerFilename),
		AnchorStore:  anchorStore,
		RecordMACKey: recordKey,
	})
	if err != nil {
		return err
	}
	if err := ledger.AdmitReleaseLineage(ctx, lineage); err != nil {
		_ = ledger.Close()
		return err
	}
	return ledger.Close()
}

func validateExistingMacOSLedger(ctx context.Context, stateRoot string, secrets BinarySecretStore, lineage ReleaseLineageRecord) error {
	recordKey, err := LoadMacOSLedgerRecordMACKey(ctx, secrets)
	if err != nil {
		return err
	}
	defer zeroBytes(recordKey)
	anchorStore, err := NewMacOSKeychainAnchorStore(secrets)
	if err != nil {
		return err
	}
	if _, err := anchorStore.Load(ctx); err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("validate installer-provisioned macOS ledger anchor: %w", err))
	}
	ledger, err := OpenLedger(ctx, LedgerOptions{
		Path:         filepath.Join(stateRoot, LedgerFilename),
		AnchorStore:  anchorStore,
		RecordMACKey: recordKey,
	})
	if err != nil {
		return err
	}
	if err := ledger.AdmitReleaseLineage(ctx, lineage); err != nil {
		_ = ledger.Close()
		return err
	}
	return ledger.Close()
}
