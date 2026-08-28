//go:build darwin && cgo && !nimi_macos_source_local_development

package protectedlocal

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

func sameMacOSProcessSnapshot(expected, current macOSProcessSnapshot) bool {
	return expected.pid == current.pid && expected.parentPID == current.parentPID &&
		expected.euid == current.euid && expected.ruid == current.ruid &&
		expected.startSeconds == current.startSeconds && expected.startMicros == current.startMicros &&
		expected.executablePath == current.executablePath
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

func verifyMacOSProcessIdentity(snapshot macOSProcessSnapshot, audit *macOSAuditIdentity, policy macOSCodePolicy, expectedPath string, expectedParent uint32, requireSuspended bool) (macOSCodeIdentity, error) {
	if err := policy.validate(); err != nil {
		return macOSCodeIdentity{}, err
	}
	if snapshot.pid == 0 || snapshot.euid != snapshot.ruid || (expectedParent != 0 && snapshot.parentPID != expectedParent) {
		return macOSCodeIdentity{}, fmt.Errorf("macOS process principal or parent mismatch")
	}
	if audit != nil && (snapshot.pid != audit.pid || snapshot.euid != audit.euid || snapshot.ruid != audit.ruid || audit.consoleUID != audit.euid || audit.pidVersion == 0) {
		return macOSCodeIdentity{}, fmt.Errorf("macOS process and connected audit token mismatch")
	}
	if requireSuspended && snapshot.status != 4 {
		return macOSCodeIdentity{}, fmt.Errorf("macOS supervised process is not start-suspended")
	}
	if _, err := validateMacOSExecutablePath(snapshot.executablePath, expectedPath); err != nil {
		return macOSCodeIdentity{}, err
	}
	code, err := verifyMacOSDynamicCode(snapshot.pid, audit, policy)
	if err != nil {
		return macOSCodeIdentity{}, err
	}
	current, err := inspectMacOSProcess(snapshot.pid)
	if err != nil || !sameMacOSProcessSnapshot(snapshot, current) {
		return macOSCodeIdentity{}, fmt.Errorf("macOS process changed during trust verification")
	}
	return code, nil
}

func verifyMacOSRuntimeProcess() error {
	snapshot, err := inspectMacOSProcess(uint32(os.Getpid()))
	if err != nil {
		return err
	}
	policy, err := macOSRuntimeCodePolicy()
	if err != nil {
		return err
	}
	_, err = verifyMacOSProcessIdentity(snapshot, nil, policy, MacOSRuntimeExecutablePath, 1, false)
	return err
}

func verifyConnectedMacOSDesktop(audit macOSAuditIdentity, expectedDesktopPath string) (DesktopPeerIdentity, ProcessTuple, error) {
	if expectedDesktopPath != MacOSDesktopExecutablePath {
		return DesktopPeerIdentity{}, ProcessTuple{}, fmt.Errorf("macOS Desktop executable path is not installer-fixed")
	}
	snapshot, err := inspectMacOSProcess(audit.pid)
	if err != nil {
		return DesktopPeerIdentity{}, ProcessTuple{}, err
	}
	desktopPolicy, err := macOSDesktopCodePolicy()
	if err != nil {
		return DesktopPeerIdentity{}, ProcessTuple{}, err
	}
	code, err := verifyMacOSProcessIdentity(snapshot, &audit, desktopPolicy, expectedDesktopPath, 0, false)
	if err != nil {
		return DesktopPeerIdentity{}, ProcessTuple{}, err
	}
	process, err := macOSDesktopProcessTuple(snapshot, audit, code, expectedDesktopPath, macOSDesktopSignedTrustSetID)
	if err != nil {
		return DesktopPeerIdentity{}, ProcessTuple{}, err
	}
	return DesktopPeerIdentity{OS: OSMacOS, PID: audit.pid, UID: audit.euid, AuditSession: audit.auditSession}, process, nil
}

func verifyConnectedMacOSLocalApp(audit macOSAuditIdentity, launch DirectLocalAppLaunch) (DirectLocalAppPeer, error) {
	snapshot, err := inspectMacOSProcess(audit.pid)
	if err != nil {
		return DirectLocalAppPeer{}, err
	}
	hostPolicy, err := macOSLocalAppHostCodePolicy()
	if err != nil {
		return DirectLocalAppPeer{}, err
	}
	if _, err := verifyMacOSProcessIdentity(snapshot, &audit, hostPolicy, MacOSLocalAppHostPath, launch.DesktopPID, false); err != nil {
		return DirectLocalAppPeer{}, err
	}
	witness := DirectLocalAppProcessWitness{
		PID: snapshot.pid, ParentPID: snapshot.parentPID, UID: snapshot.euid,
		StartSeconds: snapshot.startSeconds, StartMicros: snapshot.startMicros, ExecutablePath: snapshot.executablePath,
	}
	if launch.Process != witness {
		return DirectLocalAppPeer{}, fmt.Errorf("local App peer process-start witness mismatch")
	}
	return DirectLocalAppPeer{OS: OSMacOS, PID: audit.pid, UID: audit.euid}, nil
}
