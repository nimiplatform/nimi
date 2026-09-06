//go:build windows

package protectedlocal

import (
	"context"
	"fmt"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
func VerifyInstalledAppProcess(ctx context.Context, pid uint32, policy InstalledAppProcessPolicy) (ProcessTuple, DesktopProcessLiveness, error) {
	if ctx == nil || !policy.valid() || pid == 0 || !filepath.IsAbs(policy.HostExecutablePath) {
		return ProcessTuple{}, nil, fmt.Errorf("complete installed App process policy is required")
	}
	identity, err := resolveWindowsActiveSessionIdentity(windows.WTSGetActiveConsoleSessionId())
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	parent, err := windowsSourceParentProcessID(pid)
	if err != nil || parent != policy.SupervisorProcess.PID {
		return ProcessTuple{}, nil, fmt.Errorf("installed App supervisor mismatch: %w", err)
	}
	// Recheck the current Desktop token independently of the child. The retained
	// protected Desktop connection already owns its executable and lifetime.
	parentHandle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, parent)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	defer func() { _ = windows.CloseHandle(parentHandle) }()
	var token windows.Token
	if err := windows.OpenProcessToken(parentHandle, windows.TOKEN_QUERY, &token); err != nil {
		return ProcessTuple{}, nil, err
	}
	observed, tokenErr := inspectWindowsDesktopToken(token, identity)
	elevation, elevationErr := readWindowsTokenUint32(token, windows.TokenElevation)
	_ = token.Close()
	if tokenErr != nil || elevationErr != nil || elevation != 0 || observed.userSID != policy.SupervisorProcess.SecurityPrincipal || observed.logonLUID != policy.SupervisorProcess.OSLoginSession {
		return ProcessTuple{}, nil, fmt.Errorf("installed App Desktop token mismatch")
	}
	return verifyWindowsAppProcess(ctx, pid, identity, policy.HostExecutablePath, windowsInstalledExecutableVerifier{policy}, policy.ExecutionProfileRef, true)
}

type windowsInstalledExecutableVerifier struct{ policy InstalledAppProcessPolicy }

func (verifier windowsInstalledExecutableVerifier) VerifyWindowsExecutable(_ context.Context, role WindowsExecutableRole, locked WindowsLockedExecutable) (string, error) {
	if role != WindowsExecutableRoleLocalApp || locked == nil {
		return "", fmt.Errorf("installed App executable role is required")
	}
	observed := locked.Evidence()
	if observed.Digest != verifier.policy.HostExecutableDigest || !sameWindowsLocalDevelopmentHostFile(observed.Path, verifier.policy.HostExecutablePath) {
		return "", fmt.Errorf("installed App executable does not match committed entry")
	}
	return verifier.policy.ExecutionProfileRef, nil
}

func windowsSourceParentProcessID(pid uint32) (uint32, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0, fmt.Errorf("snapshot Windows processes: %w", err)
	}
	defer func() { _ = windows.CloseHandle(snapshot) }()
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return 0, fmt.Errorf("read Windows process snapshot: %w", err)
	}
	for {
		if entry.ProcessID == pid {
			if entry.ParentProcessID == 0 {
				return 0, fmt.Errorf("process parent is unavailable")
			}
			return entry.ParentProcessID, nil
		}
		if err := windows.Process32Next(snapshot, &entry); err != nil {
			return 0, fmt.Errorf("locate process parent: %w", err)
		}
	}
}
