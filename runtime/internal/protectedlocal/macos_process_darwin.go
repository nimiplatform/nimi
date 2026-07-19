//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/sys/unix"
)

const macOSStoppedProcessStatus = 4

type macOSProcessLiveness struct {
	kqueueFD     int
	executableFD int
	pid          uint32
	snapshot     macOSProcessSnapshot
	interactive  *macOSAuditIdentity
	revoked      chan struct{}
	stop         chan struct{}
	done         chan struct{}
	revokeOnce   sync.Once
	closeOnce    sync.Once
	closeErr     error
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
		if liveness.executableFD >= 0 {
			failures = append(failures, unix.Close(liveness.executableFD))
		}
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
		current, err := inspectMacOSProcess(liveness.pid)
		if err != nil || !sameMacOSProcessSnapshot(liveness.snapshot, current) {
			liveness.revoke()
			return
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

func newMacOSProcessLiveness(snapshot macOSProcessSnapshot, executableFD int, interactive *macOSAuditIdentity) (*macOSProcessLiveness, error) {
	if snapshot.pid == 0 || executableFD < 0 {
		return nil, fmt.Errorf("complete macOS process liveness inputs are required")
	}
	kqueueFD, err := unix.Kqueue()
	if err != nil {
		return nil, fmt.Errorf("create macOS process liveness kqueue: %w", err)
	}
	changes := []unix.Kevent_t{
		{
			Ident: uint64(snapshot.pid), Filter: unix.EVFILT_PROC,
			Flags:  unix.EV_ADD | unix.EV_ENABLE | unix.EV_CLEAR,
			Fflags: unix.NOTE_EXIT | unix.NOTE_EXEC,
		},
		{
			Ident: uint64(executableFD), Filter: unix.EVFILT_VNODE,
			Flags:  unix.EV_ADD | unix.EV_ENABLE | unix.EV_CLEAR,
			Fflags: unix.NOTE_DELETE | unix.NOTE_WRITE | unix.NOTE_EXTEND | unix.NOTE_ATTRIB | unix.NOTE_LINK | unix.NOTE_RENAME | unix.NOTE_REVOKE,
		},
	}
	if _, err := unix.Kevent(kqueueFD, changes, nil, nil); err != nil {
		_ = unix.Close(kqueueFD)
		return nil, fmt.Errorf("register macOS process liveness witnesses: %w", err)
	}
	liveness := &macOSProcessLiveness{
		kqueueFD: kqueueFD, executableFD: executableFD, pid: snapshot.pid, snapshot: snapshot,
		interactive: interactive, revoked: make(chan struct{}), stop: make(chan struct{}), done: make(chan struct{}),
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
	return cleaned, nil
}

func openAndHashMacOSExecutable(path string) (int, Identifier, string, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return -1, Identifier{}, "", fmt.Errorf("open macOS executable vnode: %w", err)
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = unix.Close(fd)
		}
	}()
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil || stat.Mode&unix.S_IFMT != unix.S_IFREG || stat.Ino == 0 ||
		stat.Uid != 0 || stat.Mode&0o022 != 0 {
		return -1, Identifier{}, "", fmt.Errorf("macOS executable vnode ownership or mode is not release-safe")
	}
	duplicate, err := unix.Dup(fd)
	if err != nil {
		return -1, Identifier{}, "", fmt.Errorf("duplicate macOS executable vnode: %w", err)
	}
	file := os.NewFile(uintptr(duplicate), path)
	if file == nil {
		_ = unix.Close(duplicate)
		return -1, Identifier{}, "", fmt.Errorf("open macOS executable hash reader")
	}
	hash := sha256.New()
	_, copyErr := io.Copy(hash, file)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		return -1, Identifier{}, "", fmt.Errorf("hash macOS executable vnode")
	}
	var digest Identifier
	copy(digest[:], hash.Sum(nil))
	identity := fmt.Sprintf("dev:%d:ino:%d:gen:%d:birth:%d.%09d", stat.Dev, stat.Ino, stat.Gen, stat.Btim.Sec, stat.Btim.Nsec)
	accepted = true
	return fd, digest, identity, nil
}

func macOSProcessTuple(snapshot macOSProcessSnapshot, audit *macOSAuditIdentity, code macOSCodeIdentity, policy macOSCodePolicy, digest Identifier, vnodeIdentity string, inheritedSession *ProcessTuple) (ProcessTuple, error) {
	if code.cdhash != policy.releaseCDHash {
		return ProcessTuple{}, fmt.Errorf("macOS executable cdhash does not match the signed release policy")
	}
	if digest != policy.artifactDigest {
		return ProcessTuple{}, fmt.Errorf("macOS executable digest does not match the signed role record")
	}
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
	tuple := ProcessTuple{
		OS: OSMacOS, PID: snapshot.pid,
		CreationMarker: fmt.Sprintf("proc-start:%d.%06d", snapshot.startSeconds, snapshot.startMicros),
		OSLoginSession: loginSession, SecurityPrincipal: securityPrincipal,
		CanonicalExecutableIdentity: fmt.Sprintf("identifier:%s;team:%s;cdhash:%s;%s", code.signingIdentifier, code.teamID, code.cdhash, vnodeIdentity),
		CanonicalExecutablePath:     snapshot.executablePath, ExecutableDigest: digest,
		ExecutableTrustSetID: policy.trustSetID,
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
	canonical, err := validateMacOSExecutablePath(snapshot.executablePath, expectedPath)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	executableFD, digest, vnodeIdentity, err := openAndHashMacOSExecutable(canonical)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = unix.Close(executableFD)
		}
	}()
	code, err := verifyMacOSDynamicCode(snapshot.pid, audit, policy)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	current, err := inspectMacOSProcess(snapshot.pid)
	if err != nil || !sameMacOSProcessSnapshot(snapshot, current) {
		return ProcessTuple{}, nil, fmt.Errorf("macOS process changed during trust verification")
	}
	tuple, err := macOSProcessTuple(snapshot, audit, code, policy, digest, vnodeIdentity, inheritedSession)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	liveness, err := newMacOSProcessLiveness(snapshot, executableFD, audit)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	accepted = true
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

type macOSLocalDevelopmentProcessVerifier struct {
	state *MacOSRuntimeSecurityState
}

func NewMacOSLocalDevelopmentProcessVerifier(state *MacOSRuntimeSecurityState) (LocalDevelopmentProcessVerifier, error) {
	if state == nil || state.ledger == nil {
		return nil, fmt.Errorf("verified macOS Runtime security state is required")
	}
	host, err := macOSLocalAppHostCodePolicy()
	if err != nil {
		return nil, err
	}
	runtimePolicy, err := macOSRuntimeCodePolicy()
	if err != nil {
		return nil, err
	}
	if err := requireMacOSReleaseCompatibility(host, runtimePolicy); err != nil {
		return nil, err
	}
	return macOSLocalDevelopmentProcessVerifier{state: state}, nil
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
	runtimePolicy, err := macOSRuntimeCodePolicy()
	if err != nil || requireMacOSReleaseCompatibility(hostPolicy, runtimePolicy) != nil {
		return ProcessTuple{}, nil, fmt.Errorf("macOS local-app host release is incompatible with Runtime")
	}
	process, liveness, err := verifyMacOSProcess(snapshot, nil, hostPolicy, MacOSLocalAppHostPath, desktop.PID, true, &desktop)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	if verifier.state == nil || verifier.state.ledger == nil || verifier.state.ledger.AdmitReleaseLineage(ctx, hostPolicy.releaseLineage()) != nil {
		_ = liveness.Close()
		return ProcessTuple{}, nil, fmt.Errorf("admit macOS local-app host release lineage")
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
	runtimePolicy, err := macOSRuntimeCodePolicy()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	if err := requireMacOSReleaseCompatibility(desktopPolicy, runtimePolicy); err != nil {
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
	runtimePolicy, err := macOSRuntimeCodePolicy()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	if err := requireMacOSReleaseCompatibility(hostPolicy, runtimePolicy); err != nil {
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

func macOSExecutableSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
