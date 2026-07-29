//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"golang.org/x/sys/unix"
)

const macOSStoppedProcessStatus = 4

type macOSProcessLiveness struct {
	kqueueFD    int
	interactive *macOSAuditIdentity
	revoked     chan struct{}
	stop        chan struct{}
	done        chan struct{}
	revokeOnce  sync.Once
	closeOnce   sync.Once
	closeErr    error
}

func (liveness *macOSProcessLiveness) Revoked() <-chan struct{} {
	if liveness == nil {
		return nil
	}
	return liveness.revoked
}

func (liveness *macOSProcessLiveness) revoke() {
	if liveness != nil {
		liveness.revokeOnce.Do(func() { close(liveness.revoked) })
	}
}

func (liveness *macOSProcessLiveness) Close() error {
	if liveness == nil {
		return nil
	}
	liveness.closeOnce.Do(func() {
		close(liveness.stop)
		var failures []error
		if liveness.kqueueFD >= 0 {
			failures = append(failures, unix.Close(liveness.kqueueFD))
		}
		<-liveness.done
		liveness.closeErr = errors.Join(failures...)
	})
	return liveness.closeErr
}

func (liveness *macOSProcessLiveness) watch() {
	defer close(liveness.done)
	events := make([]unix.Kevent_t, 4)
	for {
		timeout := &unix.Timespec{Sec: 1}
		count, err := unix.Kevent(liveness.kqueueFD, nil, events, timeout)
		if err != nil {
			select {
			case <-liveness.stop:
				return
			default:
				liveness.revoke()
				return
			}
		}
		if count > 0 {
			liveness.revoke()
			return
		}
		select {
		case <-liveness.stop:
			return
		default:
		}
		if liveness.interactive != nil {
			if err := revalidateMacOSGraphicSession(liveness.interactive.euid, liveness.interactive.auditSession); err != nil {
				liveness.revoke()
				return
			}
		}
	}
}

func sameMacOSProcessSnapshot(expected, current macOSProcessSnapshot) bool {
	return expected.pid == current.pid && expected.parentPID == current.parentPID &&
		expected.euid == current.euid && expected.ruid == current.ruid &&
		expected.startSeconds == current.startSeconds && expected.startMicros == current.startMicros &&
		expected.executablePath == current.executablePath
}

func newMacOSProcessLiveness(snapshot macOSProcessSnapshot, interactive *macOSAuditIdentity) (*macOSProcessLiveness, error) {
	if snapshot.pid == 0 {
		return nil, fmt.Errorf("complete macOS process liveness inputs are required")
	}
	kqueueFD, err := unix.Kqueue()
	if err != nil {
		return nil, fmt.Errorf("create macOS process liveness kqueue: %w", err)
	}
	changes := []unix.Kevent_t{{
		Ident: uint64(snapshot.pid), Filter: unix.EVFILT_PROC,
		Flags:  unix.EV_ADD | unix.EV_ENABLE | unix.EV_CLEAR,
		Fflags: unix.NOTE_EXIT | unix.NOTE_EXEC,
	}}
	if _, err := unix.Kevent(kqueueFD, changes, nil, nil); err != nil {
		_ = unix.Close(kqueueFD)
		return nil, fmt.Errorf("register macOS process liveness witnesses: %w", err)
	}
	liveness := &macOSProcessLiveness{
		kqueueFD: kqueueFD, interactive: interactive, revoked: make(chan struct{}),
		stop: make(chan struct{}), done: make(chan struct{}),
	}
	go liveness.watch()
	return liveness, nil
}

func validateMacOSExecutablePath(path, expected string) (string, error) {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if !filepath.IsAbs(cleaned) || cleaned != path || cleaned != expected {
		return "", fmt.Errorf("macOS executable is not at the installer-fixed path")
	}
	current := string(filepath.Separator)
	components := strings.Split(strings.TrimPrefix(cleaned, string(filepath.Separator)), string(filepath.Separator))
	for _, component := range components {
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("macOS executable path contains a missing or symlinked component")
		}
	}
	canonical, err := filepath.EvalSymlinks(cleaned)
	if err != nil || filepath.Clean(canonical) != cleaned {
		return "", fmt.Errorf("macOS executable path is not canonical")
	}
	info, err := os.Lstat(cleaned)
	if err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("macOS executable path is not a regular file")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 || info.Mode().Perm()&0o022 != 0 {
		return "", fmt.Errorf("macOS executable path ownership or mode is not protected")
	}
	return cleaned, nil
}

func macOSProcessTuple(snapshot macOSProcessSnapshot, audit *macOSAuditIdentity, code macOSCodeIdentity, policy macOSCodePolicy, inheritedSession *ProcessTuple) (ProcessTuple, error) {
	loginSession := ""
	securityPrincipal := ""
	if audit != nil {
		loginSession = "audit-session:" + strconv.FormatUint(uint64(audit.auditSession), 10)
		securityPrincipal = fmt.Sprintf("euid:%d:ruid:%d:auid:%d", audit.euid, audit.ruid, audit.auid)
	} else if inheritedSession != nil {
		loginSession = inheritedSession.OSLoginSession
		securityPrincipal = inheritedSession.SecurityPrincipal
	} else {
		loginSession = "launchd-system-domain"
		securityPrincipal = "uid:" + strconv.FormatUint(uint64(snapshot.euid), 10) + ":" + MacOSRuntimeAccountName
	}
	signer := code.teamID
	if signer == "" {
		signer = "adhoc"
	}
	executableIdentity := fmt.Sprintf(
		"identifier:%s;team:%s;cdhash:%s",
		code.signingIdentifier,
		signer,
		code.cdhash,
	)
	executableDigest := sha256.Sum256([]byte(executableIdentity))
	tuple := ProcessTuple{
		OS: OSMacOS, PID: snapshot.pid,
		CreationMarker: fmt.Sprintf("proc-start:%d.%06d", snapshot.startSeconds, snapshot.startMicros),
		OSLoginSession: loginSession, SecurityPrincipal: securityPrincipal,
		CanonicalExecutableIdentity: executableIdentity,
		CanonicalExecutablePath:     snapshot.executablePath,
		ExecutableDigest:            Identifier(executableDigest),
		ExecutableTrustSetID:        policy.trustSetID,
	}
	return tuple, tuple.validate()
}

func verifyMacOSProcess(snapshot macOSProcessSnapshot, audit *macOSAuditIdentity, policy macOSCodePolicy, expectedPath string, expectedParent uint32, requireSuspended bool, inheritedSession *ProcessTuple) (ProcessTuple, DesktopProcessLiveness, error) {
	if err := policy.validate(); err != nil {
		return ProcessTuple{}, nil, err
	}
	if snapshot.pid == 0 || snapshot.euid != snapshot.ruid || (expectedParent != 0 && snapshot.parentPID != expectedParent) {
		return ProcessTuple{}, nil, fmt.Errorf("macOS process principal or parent mismatch")
	}
	if audit != nil && (snapshot.pid != audit.pid || snapshot.euid != audit.euid || snapshot.ruid != audit.ruid || audit.consoleUID != audit.euid || audit.pidVersion == 0) {
		return ProcessTuple{}, nil, fmt.Errorf("macOS process and connected audit token mismatch")
	}
	if requireSuspended && snapshot.status != macOSStoppedProcessStatus {
		return ProcessTuple{}, nil, fmt.Errorf("macOS supervised process is not start-suspended")
	}
	if _, err := validateMacOSExecutablePath(snapshot.executablePath, expectedPath); err != nil {
		return ProcessTuple{}, nil, err
	}
	code, err := verifyMacOSDynamicCode(snapshot.pid, audit, policy)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	current, err := inspectMacOSProcess(snapshot.pid)
	if err != nil || !sameMacOSProcessSnapshot(snapshot, current) {
		return ProcessTuple{}, nil, fmt.Errorf("macOS process changed during trust verification")
	}
	tuple, err := macOSProcessTuple(snapshot, audit, code, policy, inheritedSession)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	liveness, err := newMacOSProcessLiveness(snapshot, audit)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	return tuple, liveness, nil
}

func verifyMacOSRuntimeProcess() (ProcessTuple, DesktopProcessLiveness, error) {
	snapshot, err := inspectMacOSProcess(uint32(os.Getpid()))
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	policy, err := macOSRuntimeCodePolicy()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	return verifyMacOSProcess(snapshot, nil, policy, MacOSRuntimeExecutablePath, 1, false, nil)
}

type macOSLocalDevelopmentProcessVerifier struct{}

func NewMacOSLocalDevelopmentProcessVerifier(state *MacOSRuntimeSecurityState) (LocalDevelopmentProcessVerifier, error) {
	if state == nil || state.bootEpoch == (Identifier{}) || state.stateRoot == "" ||
		state.stateLock == nil || state.runtimeLiveness == nil || state.secrets == nil ||
		state.desktopSessions == nil || state.localAppLaunches == nil {
		return nil, fmt.Errorf("verified macOS Runtime security state is required")
	}
	return macOSLocalDevelopmentProcessVerifier{}, nil
}

func (verifier macOSLocalDevelopmentProcessVerifier) VerifyLocalDevelopmentProcess(ctx context.Context, pid uint32, policy LocalDevelopmentProcessPolicy) (ProcessTuple, DesktopProcessLiveness, error) {
	connection, ok := DesktopConnectionFromContext(ctx)
	if !ok || connection == nil {
		return ProcessTuple{}, nil, fmt.Errorf("verified Desktop connection is required")
	}
	desktop, ok := connection.ClientProcess()
	if !ok || desktop.OS != OSMacOS || desktop.ExecutableTrustSetID != MacOSDesktopTrustSetID {
		return ProcessTuple{}, nil, fmt.Errorf("verified macOS Desktop parent is required")
	}
	if policy.SupervisorProcess != desktop {
		return ProcessTuple{}, nil, fmt.Errorf("macOS supervisor policy does not match the connected Desktop")
	}
	if policy.ProjectRoot == "" || policy.HostExecutablePath != MacOSLocalAppHostPath || policy.ProjectHostAliasPath != "" {
		return ProcessTuple{}, nil, fmt.Errorf("fixed macOS local-app host policy is required")
	}
	snapshot, err := inspectMacOSProcess(pid)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	hostPolicy, err := macOSLocalAppHostCodePolicy()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	process, liveness, err := verifyMacOSProcess(snapshot, nil, hostPolicy, MacOSLocalAppHostPath, desktop.PID, true, &desktop)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	return process, liveness, nil
}

func verifyConnectedMacOSDesktop(audit macOSAuditIdentity) (ProcessTuple, DesktopProcessLiveness, error) {
	snapshot, err := inspectMacOSProcess(audit.pid)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	desktopPolicy, err := macOSDesktopCodePolicy()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	return verifyMacOSProcess(snapshot, &audit, desktopPolicy, MacOSDesktopExecutablePath, 0, false, nil)
}

func verifyConnectedMacOSLocalApp(audit macOSAuditIdentity, expected ProcessTuple, desktopPID uint32) (ProcessTuple, DesktopProcessLiveness, error) {
	if expected.OS != OSMacOS || expected.PID != audit.pid || expected.ExecutableTrustSetID != MacOSLocalAppHostTrustSet {
		return ProcessTuple{}, nil, fmt.Errorf("bound macOS local-app process is required")
	}
	snapshot, err := inspectMacOSProcess(audit.pid)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	hostPolicy, err := macOSLocalAppHostCodePolicy()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	peer, liveness, err := verifyMacOSProcess(snapshot, &audit, hostPolicy, MacOSLocalAppHostPath, desktopPID, false, &expected)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	if peer != expected {
		_ = liveness.Close()
		return ProcessTuple{}, nil, fmt.Errorf("connected macOS local-app process changed after pre-bind")
	}
	return peer, liveness, nil
}
