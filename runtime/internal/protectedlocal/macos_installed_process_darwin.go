//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
func VerifyInstalledAppProcess(ctx context.Context, pid uint32, policy InstalledAppProcessPolicy) (ProcessTuple, DesktopProcessLiveness, error) {
	if ctx == nil || !policy.valid() || policy.SupervisorProcess.OS != OSMacOS || pid == 0 {
		return ProcessTuple{}, nil, fmt.Errorf("complete macOS installed process policy is required")
	}
	uidText := strings.TrimPrefix(policy.SupervisorProcess.SecurityPrincipal, "macos-uid:")
	uid, err := strconv.ParseUint(uidText, 10, 32)
	if err != nil || uid == 0 || policy.SupervisorProcess.SecurityPrincipal != fmt.Sprintf("macos-uid:%d", uid) {
		return ProcessTuple{}, nil, fmt.Errorf("invalid macOS Desktop principal")
	}
	parent, err := inspectMacOSProcess(policy.SupervisorProcess.PID)
	if err != nil || parent.euid != uint32(uid) || parent.ruid != uint32(uid) || parent.executablePath != policy.SupervisorProcess.CanonicalExecutablePath || !strings.HasPrefix(policy.SupervisorProcess.CreationMarker, fmt.Sprintf("macos-start:%d:%d:pidversion:", parent.startSeconds, parent.startMicros)) {
		return ProcessTuple{}, nil, fmt.Errorf("macOS Desktop process changed")
	}
	snapshot, err := inspectMacOSProcess(pid)
	if err != nil || snapshot.status != 4 || snapshot.parentPID != parent.pid || snapshot.euid != uint32(uid) || snapshot.ruid != uint32(uid) || snapshot.executablePath != policy.HostExecutablePath {
		return ProcessTuple{}, nil, fmt.Errorf("macOS installed child is not the exact suspended same-user child")
	}
	code, err := verifyMacOSInstalledCode(ctx, snapshot, nil, policy.HostExecutablePath, policy.HostExecutableDigest)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	process := ProcessTuple{
		OS: OSMacOS, PID: pid,
		CreationMarker: fmt.Sprintf("macos-start:%d:%d", snapshot.startSeconds, snapshot.startMicros),
		// A start-suspended direct child inherits its parent's audit session.
		// The local-app listener independently matches the later kernel token.
		OSLoginSession:              policy.SupervisorProcess.OSLoginSession,
		SecurityPrincipal:           policy.SupervisorProcess.SecurityPrincipal,
		CanonicalExecutableIdentity: "macos-installed-code:" + code.signingIdentifier + ":" + code.cdhash,
		CanonicalExecutablePath:     policy.HostExecutablePath, ExecutableDigest: policy.HostExecutableDigest,
		ExecutableTrustSetID: policy.ExecutionProfileRef,
	}
	if err := process.validate(); err != nil {
		return ProcessTuple{}, nil, err
	}
	queue, err := unix.Kqueue()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	unix.CloseOnExec(queue)
	change := unix.Kevent_t{Ident: uint64(pid), Filter: unix.EVFILT_PROC, Flags: unix.EV_ADD | unix.EV_CLEAR, Fflags: unix.NOTE_EXIT | unix.NOTE_EXEC}
	if _, err := unix.Kevent(queue, []unix.Kevent_t{change}, nil, nil); err != nil {
		_ = unix.Close(queue)
		return ProcessTuple{}, nil, fmt.Errorf("watch exact installed macOS process: %w", err)
	}
	live := &macOSInstalledProcessLiveness{queue: queue, revoked: make(chan struct{}), stop: make(chan struct{})}
	go live.watch()
	return process, live, nil
}

func verifyMacOSInstalledCode(ctx context.Context, snapshot macOSProcessSnapshot, audit *macOSAuditIdentity, expectedPath string, digest Identifier) (macOSCodeIdentity, error) {
	canonical, err := filepath.EvalSymlinks(expectedPath)
	if err != nil || canonical != expectedPath || snapshot.executablePath != expectedPath {
		return macOSCodeIdentity{}, fmt.Errorf("installed macOS executable path changed")
	}
	bytes, err := os.ReadFile(expectedPath)
	if err != nil || sha256.Sum256(bytes) != digest {
		return macOSCodeIdentity{}, fmt.Errorf("installed macOS executable differs from the approved bytes")
	}
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	details, err := exec.CommandContext(bounded, "/usr/bin/codesign", "--display", "--verbose=4", expectedPath).CombinedOutput()
	if err != nil {
		return macOSCodeIdentity{}, fmt.Errorf("inspect installed macOS code identity: %w", err)
	}
	fields := make(map[string]string)
	for _, line := range strings.Split(string(details), "\n") {
		if key, value, found := strings.Cut(line, "="); found {
			fields[key] = value
		}
	}
	cdhash := fields["CDHash"]
	rawHash, err := hex.DecodeString(cdhash)
	if err != nil || len(rawHash) != 20 {
		return macOSCodeIdentity{}, fmt.Errorf("installed macOS cdhash is unavailable")
	}
	policy := macOSCodePolicy{signingIdentifier: fields["Identifier"], directRequirement: `cdhash H"` + cdhash + `"`, ordinaryInstalled: true}
	if fields["Signature"] == "adhoc" {
		policy.requireAdHoc = true
	} else {
		policy.teamID = fields["TeamIdentifier"]
		policy.requireTrustedAnchor = true
		policy.directRequirement += " and anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
	}
	code, err := verifyMacOSDynamicCode(snapshot.pid, audit, policy)
	if err != nil {
		return macOSCodeIdentity{}, err
	}
	current, err := inspectMacOSProcess(snapshot.pid)
	if err != nil || !sameMacOSProcessSnapshot(snapshot, current) {
		return macOSCodeIdentity{}, fmt.Errorf("installed macOS process changed during verification")
	}
	return code, nil
}

func verifyConnectedMacOSInstalledApp(audit macOSAuditIdentity, launch DirectLocalAppLaunch) (DirectLocalAppPeer, error) {
	process := launch.InstalledProcess
	if process.validate() != nil || process.OS != OSMacOS || process.PID != audit.pid || audit.euid != launch.ExpectedUID || audit.euid != audit.ruid || audit.consoleUID != audit.euid || audit.pidVersion == 0 || process.SecurityPrincipal != fmt.Sprintf("macos-uid:%d", audit.euid) || process.OSLoginSession != fmt.Sprintf("macos-audit-session:%d", audit.auditSession) {
		return DirectLocalAppPeer{}, fmt.Errorf("installed macOS peer principal or audit session mismatch")
	}
	snapshot, err := inspectMacOSProcess(audit.pid)
	if err != nil {
		return DirectLocalAppPeer{}, err
	}
	witness := DirectLocalAppProcessWitness{PID: snapshot.pid, ParentPID: snapshot.parentPID, UID: snapshot.euid, StartSeconds: snapshot.startSeconds, StartMicros: snapshot.startMicros, ExecutablePath: snapshot.executablePath}
	if launch.Process != witness || snapshot.ruid != audit.ruid {
		return DirectLocalAppPeer{}, fmt.Errorf("installed macOS peer process-start mismatch")
	}
	if _, err := verifyMacOSInstalledCode(context.Background(), snapshot, &audit, launch.HostExecutablePath, process.ExecutableDigest); err != nil {
		return DirectLocalAppPeer{}, err
	}
	return DirectLocalAppPeer{OS: OSMacOS, PID: audit.pid, UID: audit.euid}, nil
}

type macOSInstalledProcessLiveness struct {
	queue      int
	queueMu    sync.Mutex
	revoked    chan struct{}
	stop       chan struct{}
	closeOnce  sync.Once
	revokeOnce sync.Once
}

func (live *macOSInstalledProcessLiveness) Revoked() <-chan struct{} { return live.revoked }
func (live *macOSInstalledProcessLiveness) Close() error {
	live.closeOnce.Do(func() {
		close(live.stop)
		live.queueMu.Lock()
		_ = unix.Close(live.queue)
		live.queueMu.Unlock()
	})
	live.revokeOnce.Do(func() { close(live.revoked) })
	return nil
}
func (live *macOSInstalledProcessLiveness) watch() {
	for {
		live.queueMu.Lock()
		select {
		case <-live.stop:
			live.queueMu.Unlock()
			return
		default:
		}
		events := make([]unix.Kevent_t, 1)
		timeout := unix.NsecToTimespec(int64(250 * time.Millisecond))
		count, err := unix.Kevent(live.queue, nil, events, &timeout)
		live.queueMu.Unlock()
		if err == unix.EINTR {
			continue
		}
		if err != nil || count > 0 {
			live.revokeOnce.Do(func() { close(live.revoked) })
			return
		}
	}
}
