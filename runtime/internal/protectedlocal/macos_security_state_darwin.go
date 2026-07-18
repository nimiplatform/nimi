//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/sys/unix"
)

type MacOSRuntimeSecurityState struct {
	serviceUID       uint32
	serviceGID       uint32
	stateRoot        string
	stateLock        *macOSRuntimeStateLock
	runtimeProcess   ProcessTuple
	runtimeLiveness  DesktopProcessLiveness
	secrets          *macOSSystemKeychainSecretStore
	ledger           *Ledger
	bootEpoch        Identifier
	desktopSessions  *DesktopSessionManager
	localAppLaunches *LocalAppLaunchRegistry

	identityMu         sync.RWMutex
	interactiveEUID    uint32
	interactiveSession uint32
	accountPartition   string

	transportMu       sync.Mutex
	desktopTransport  interface{ Close() error }
	localAppTransport interface{ Close() error }
	closed            bool
	closeOnce         sync.Once
	closeErr          error
}

type macOSRuntimePrincipal struct {
	uid uint32
	gid uint32
}

func resolveMacOSRuntimePrincipal() (macOSRuntimePrincipal, error) {
	account, err := lookupMacOSRuntimeAccount(MacOSRuntimeAccountName)
	if err != nil {
		return macOSRuntimePrincipal{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "repair_runtime_service", fmt.Errorf("resolve fixed macOS Runtime account"))
	}
	if account.uid < 200 || account.uid > 499 || account.gid != account.uid ||
		account.home != "/var/empty" || account.shell != "/usr/bin/false" {
		return macOSRuntimePrincipal{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "repair_runtime_service", fmt.Errorf("fixed macOS Runtime account is not the admitted non-login system identity"))
	}
	return macOSRuntimePrincipal{uid: account.uid, gid: account.gid}, nil
}

func validateMacOSRuntimePrincipal() (macOSRuntimePrincipal, error) {
	principal, err := resolveMacOSRuntimePrincipal()
	if err != nil {
		return macOSRuntimePrincipal{}, err
	}
	if uint32(os.Geteuid()) != principal.uid || uint32(os.Getuid()) != principal.uid ||
		uint32(os.Getegid()) != principal.gid || uint32(os.Getgid()) != principal.gid || os.Getppid() != 1 {
		return macOSRuntimePrincipal{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "repair_runtime_service", fmt.Errorf("Runtime must be the dedicated launchd system daemon principal"))
	}
	return principal, nil
}

func validateMacOSRuntimeStateRoot(path string, principal macOSRuntimePrincipal) (string, error) {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if cleaned != MacOSRuntimeStateRoot || !filepath.IsAbs(cleaned) || principal.uid == 0 || principal.gid == 0 {
		return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("fixed macOS Runtime state root is required"))
	}
	current := string(filepath.Separator)
	components := strings.Split(strings.TrimPrefix(cleaned, string(filepath.Separator)), string(filepath.Separator))
	for index, component := range components {
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("macOS Runtime state root contains an unsafe component"))
		}
		stat, ok := info.Sys().(*unix.Stat_t)
		if !ok {
			return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("inspect macOS Runtime state ownership"))
		}
		last := index == len(components)-1
		if last {
			if stat.Uid != principal.uid || stat.Gid != principal.gid || info.Mode().Perm() != 0o700 || stat.Nlink < 2 {
				return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("macOS Runtime state root owner or mode mismatch"))
			}
		} else if stat.Uid != 0 || info.Mode().Perm()&0o022 != 0 {
			return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("macOS Runtime state parent must be root-owned and non-writable"))
		}
	}
	return cleaned, nil
}

func OpenMacOSRuntimeSecurityState(ctx context.Context) (*MacOSRuntimeSecurityState, error) {
	if ctx == nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("macOS Runtime context is required"))
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	principal, err := validateMacOSRuntimePrincipal()
	if err != nil {
		return nil, err
	}
	runtimeProcess, runtimeLiveness, err := verifyMacOSRuntimeProcess()
	if err != nil {
		return nil, fail(ReasonRuntimeExecutableTrustRecordInvalid, false, "reinstall_runtime_service", err)
	}
	acceptedRuntimeLiveness := false
	defer func() {
		if !acceptedRuntimeLiveness {
			_ = runtimeLiveness.Close()
		}
	}()
	stateRoot, err := validateMacOSRuntimeStateRoot(MacOSRuntimeStateRoot, principal)
	if err != nil {
		return nil, err
	}
	stateLock, err := openExistingMacOSRuntimeStateLock(stateRoot, principal, "repair_runtime_service")
	if err != nil {
		return nil, err
	}
	keepStateLock := false
	defer func() {
		if !keepStateLock {
			_ = stateLock.Close()
		}
	}()
	secrets, err := OpenMacOSSystemKeychainSecretStore()
	if err != nil {
		return nil, err
	}
	keepSecrets := false
	defer func() {
		if !keepSecrets {
			_ = secrets.Close()
		}
	}()
	anchorStore, err := NewMacOSKeychainAnchorStore(secrets)
	if err != nil {
		return nil, err
	}
	// A production service never silently bootstraps machine custody. The
	// signed installer/repair transaction must provision both Keychain items
	// and the matching ledger before launchd can expose a socket.
	if _, err := anchorStore.Load(ctx); err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("load installer-provisioned macOS ledger anchor: %w", err))
	}
	recordMACKey, err := LoadMacOSLedgerRecordMACKey(ctx, secrets)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(recordMACKey)
	ledger, err := OpenLedger(ctx, LedgerOptions{Path: filepath.Join(stateRoot, LedgerFilename), AnchorStore: anchorStore, RecordMACKey: recordMACKey})
	if err != nil {
		return nil, err
	}
	keepLedger := false
	defer func() {
		if !keepLedger {
			_ = ledger.Close()
		}
	}()
	runtimePolicy, err := macOSRuntimeCodePolicy()
	if err != nil {
		return nil, fail(ReasonRuntimeExecutableTrustRecordInvalid, false, "reinstall_runtime_service", err)
	}
	if err := ledger.AdmitReleaseLineage(ctx, runtimePolicy.releaseLineage()); err != nil {
		return nil, err
	}
	bootEpoch, err := ledger.StartRuntime(ctx)
	if err != nil {
		return nil, err
	}
	desktopSessions, err := NewDesktopSessionManager(bootEpoch, nil)
	if err != nil {
		return nil, err
	}
	localAppLaunches, err := NewLocalAppLaunchRegistry(bootEpoch)
	if err != nil {
		return nil, err
	}
	state := &MacOSRuntimeSecurityState{
		serviceUID: principal.uid, serviceGID: principal.gid, stateRoot: stateRoot, stateLock: stateLock, runtimeProcess: runtimeProcess,
		runtimeLiveness: runtimeLiveness, secrets: secrets, ledger: ledger, bootEpoch: bootEpoch,
		desktopSessions: desktopSessions, localAppLaunches: localAppLaunches,
	}
	keepSecrets = true
	keepLedger = true
	keepStateLock = true
	acceptedRuntimeLiveness = true
	return state, nil
}

func (state *MacOSRuntimeSecurityState) BindInteractiveIdentity(audit macOSAuditIdentity) error {
	if state == nil || audit.euid == 0 || audit.auditSession == 0 || audit.consoleUID != audit.euid {
		return fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", fmt.Errorf("verified macOS interactive identity is required"))
	}
	partition := fmt.Sprintf("macos:euid:%d:audit-session:%d", audit.euid, audit.auditSession)
	state.identityMu.Lock()
	defer state.identityMu.Unlock()
	if state.interactiveEUID == 0 {
		state.interactiveEUID = audit.euid
		state.interactiveSession = audit.auditSession
		state.accountPartition = partition
		return nil
	}
	if state.interactiveEUID != audit.euid || state.interactiveSession != audit.auditSession || state.accountPartition != partition {
		return fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_runtime_service", fmt.Errorf("macOS active interactive identity changed"))
	}
	return nil
}

func (state *MacOSRuntimeSecurityState) InteractiveIdentity() (uint32, uint32, string, bool) {
	if state == nil {
		return 0, 0, "", false
	}
	state.identityMu.RLock()
	defer state.identityMu.RUnlock()
	return state.interactiveEUID, state.interactiveSession, state.accountPartition,
		state.interactiveEUID != 0 && state.interactiveSession != 0 && state.accountPartition != ""
}

func (state *MacOSRuntimeSecurityState) ServiceStatePath() string {
	if state == nil {
		return ""
	}
	return state.stateRoot
}
func (state *MacOSRuntimeSecurityState) BinarySecrets() BinarySecretStore {
	if state == nil {
		return nil
	}
	return state.secrets
}
func (state *MacOSRuntimeSecurityState) Ledger() *Ledger {
	if state == nil {
		return nil
	}
	return state.ledger
}
func (state *MacOSRuntimeSecurityState) BootEpoch() Identifier {
	if state == nil {
		return Identifier{}
	}
	return state.bootEpoch
}
func (state *MacOSRuntimeSecurityState) DesktopSessions() *DesktopSessionManager {
	if state == nil {
		return nil
	}
	return state.desktopSessions
}
func (state *MacOSRuntimeSecurityState) LocalAppLaunches() *LocalAppLaunchRegistry {
	if state == nil {
		return nil
	}
	return state.localAppLaunches
}
func (state *MacOSRuntimeSecurityState) RuntimeProcess() ProcessTuple {
	if state == nil {
		return ProcessTuple{}
	}
	return state.runtimeProcess
}

func (state *MacOSRuntimeSecurityState) Close() error {
	if state == nil {
		return nil
	}
	state.closeOnce.Do(func() {
		state.transportMu.Lock()
		state.closed = true
		desktop := state.desktopTransport
		localApp := state.localAppTransport
		state.transportMu.Unlock()
		var failures []error
		if desktop != nil {
			failures = append(failures, desktop.Close())
		}
		if localApp != nil {
			failures = append(failures, localApp.Close())
		}
		if state.runtimeLiveness != nil {
			failures = append(failures, state.runtimeLiveness.Close())
		}
		if state.ledger != nil {
			failures = append(failures, state.ledger.Close())
		}
		if state.secrets != nil {
			failures = append(failures, state.secrets.Close())
		}
		if state.stateLock != nil {
			failures = append(failures, state.stateLock.Close())
		}
		state.closeErr = errors.Join(failures...)
	})
	return state.closeErr
}
