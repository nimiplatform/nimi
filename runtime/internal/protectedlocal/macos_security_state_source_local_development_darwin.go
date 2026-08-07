//go:build darwin && cgo && nimi_macos_source_local_development

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

type MacOSRuntimeSecurityState struct {
	serviceUID       uint32
	serviceGID       uint32
	stateRoot        string
	stateLock        *macOSRuntimeStateLock
	secrets          macOSRuntimeBinarySecretStore
	desktopSessions  *DesktopSessionManager
	localAppLaunches *DirectLocalAppLaunches
	ownerProcess     macOSProcessSnapshot

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

func validateMacOSSourceLocalDevelopmentPrincipal() (macOSRuntimePrincipal, error) {
	uid := uint32(os.Geteuid())
	gid := uint32(os.Getegid())
	if uid == 0 || gid == 0 || uint32(os.Getuid()) != uid || uint32(os.Getgid()) != gid {
		return macOSRuntimePrincipal{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("per-user Runtime requires one non-root current-user principal"))
	}
	return macOSRuntimePrincipal{uid: uid, gid: gid}, nil
}

func prepareMacOSSourceLocalDevelopmentStateRoot(path string, principal macOSRuntimePrincipal) (string, error) {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if cleaned == "." || cleaned != MacOSRuntimeStateRoot || !filepath.IsAbs(cleaned) || principal.uid == 0 || principal.gid == 0 {
		return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("per-user Runtime state root is unavailable"))
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("resolve current-user home: %w", err))
	}
	home = filepath.Clean(home)
	relative, err := filepath.Rel(home, cleaned)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("per-user Runtime state root escapes the current-user home"))
	}
	if err := validateMacOSSourceLocalDevelopmentDirectoryChain(home); err != nil {
		return "", err
	}
	if err := os.MkdirAll(cleaned, 0o700); err != nil {
		return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("create per-user Runtime state root: %w", err))
	}
	if err := os.Chmod(cleaned, 0o700); err != nil {
		return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("protect per-user Runtime state root: %w", err))
	}
	info, err := os.Lstat(cleaned)
	stat, ok := fileInfoStat(info)
	if err != nil || info == nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !ok ||
		stat.Uid != principal.uid || stat.Gid != principal.gid || info.Mode().Perm() != 0o700 || stat.Nlink < 2 {
		return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("per-user Runtime state root owner or mode mismatch"))
	}
	return cleaned, nil
}

func validateMacOSSourceLocalDevelopmentDirectoryChain(root string) error {
	current := string(filepath.Separator)
	for _, component := range strings.Split(strings.TrimPrefix(filepath.Clean(root), string(filepath.Separator)), string(filepath.Separator)) {
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("current-user home contains a missing, non-directory, or symlinked ancestor"))
		}
	}
	return nil
}

func fileInfoStat(info os.FileInfo) (*syscall.Stat_t, bool) {
	if info == nil {
		return nil, false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return stat, ok
}

func openMacOSSourceLocalDevelopmentStateLock(stateRoot string, principal macOSRuntimePrincipal) (*macOSRuntimeStateLock, error) {
	lockPath := filepath.Join(stateRoot, MacOSRuntimeStateLockFilename)
	info, err := os.Lstat(lockPath)
	if errors.Is(err, os.ErrNotExist) {
		return createMacOSRuntimeStateLock(stateRoot, principal)
	}
	if err != nil || info == nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("per-user Runtime state lock is invalid"))
	}
	return openExistingMacOSRuntimeStateLock(stateRoot, principal, "restart_runtime")
}

func OpenMacOSRuntimeSecurityState(ctx context.Context) (*MacOSRuntimeSecurityState, error) {
	if ctx == nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("macOS Runtime context is required"))
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	principal, err := validateMacOSSourceLocalDevelopmentPrincipal()
	if err != nil {
		return nil, err
	}
	if err := verifyMacOSRuntimeProcess(); err != nil {
		return nil, fail(ReasonRuntimeExecutableTrustInvalid, false, "restart_runtime", err)
	}
	ownerProcess, err := inspectMacOSProcess(uint32(os.Getppid()))
	if err != nil {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", err)
	}
	expectedDesktopPath := filepath.Clean(strings.TrimSpace(os.Getenv("NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_HOST_EXECUTABLE")))
	if _, err := verifyMacOSProcessIdentity(ownerProcess, nil, macOSCodePolicy{}, expectedDesktopPath, 0, false); err != nil {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", err)
	}
	stateRoot, err := prepareMacOSSourceLocalDevelopmentStateRoot(MacOSRuntimeStateRoot, principal)
	if err != nil {
		return nil, err
	}
	stateLock, err := openMacOSSourceLocalDevelopmentStateLock(stateRoot, principal)
	if err != nil {
		return nil, err
	}
	keepStateLock := false
	defer func() {
		if !keepStateLock {
			_ = stateLock.Close()
		}
	}()
	secrets, err := openMacOSRuntimeBinarySecretStore(stateRoot, principal)
	if err != nil {
		return nil, err
	}
	keepSecrets := false
	defer func() {
		if !keepSecrets {
			_ = secrets.Close()
		}
	}()
	desktopSessions, err := NewDirectDesktopSessionManager(nil)
	if err != nil {
		return nil, err
	}
	state := &MacOSRuntimeSecurityState{
		serviceUID: principal.uid, serviceGID: principal.gid, stateRoot: stateRoot, stateLock: stateLock,
		secrets: secrets, desktopSessions: desktopSessions, localAppLaunches: NewDirectLocalAppLaunches(),
		ownerProcess: ownerProcess,
	}
	keepSecrets = true
	keepStateLock = true
	return state, nil
}

func (state *MacOSRuntimeSecurityState) BindInteractiveIdentity(audit macOSAuditIdentity) error {
	if state == nil || audit.euid == 0 || audit.euid != state.serviceUID || audit.ruid != audit.euid ||
		audit.auditSession == 0 || audit.consoleUID != audit.euid {
		return fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", fmt.Errorf("verified current-user macOS interactive identity is required"))
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
		return fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_runtime", fmt.Errorf("macOS active interactive identity changed"))
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

func (state *MacOSRuntimeSecurityState) RuntimeServiceUID() uint32 {
	if state == nil {
		return 0
	}
	return state.serviceUID
}

func (state *MacOSRuntimeSecurityState) SourceLocalDevelopment() bool { return state != nil }

func (state *MacOSRuntimeSecurityState) StartOwnerMonitor(ctx context.Context, cancel context.CancelFunc) {
	if state == nil || state.ownerProcess.pid == 0 || cancel == nil {
		if cancel != nil {
			cancel()
		}
		return
	}
	expected := state.ownerProcess
	go func() {
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				current, err := inspectMacOSProcess(expected.pid)
				if err != nil || !sameMacOSProcessSnapshot(expected, current) {
					cancel()
					return
				}
			}
		}
	}()
}

func (state *MacOSRuntimeSecurityState) BinarySecrets() BinarySecretStore {
	if state == nil {
		return nil
	}
	return state.secrets
}

func (state *MacOSRuntimeSecurityState) DesktopSessions() *DesktopSessionManager {
	if state == nil {
		return nil
	}
	return state.desktopSessions
}

func (state *MacOSRuntimeSecurityState) DirectLocalAppLaunches() *DirectLocalAppLaunches {
	if state == nil {
		return nil
	}
	return state.localAppLaunches
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
