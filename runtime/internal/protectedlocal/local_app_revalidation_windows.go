//go:build windows

package protectedlocal

import (
	"context"
	"fmt"

	"golang.org/x/sys/windows"
)

func VerifyLocalAppProcessParent(ctx context.Context, pid uint32, owner *Connection) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if owner == nil || !owner.VerifiedDesktopTransport() {
		return fmt.Errorf("App supervisor is unavailable")
	}
	expected, ok := owner.ClientProcess()
	if !ok {
		return fmt.Errorf("App supervisor process is unavailable")
	}
	parent, err := windowsSourceParentProcessID(pid)
	if err != nil || parent != expected.PID {
		return fmt.Errorf("App supervisor relation changed")
	}
	return nil
}

func RevalidateDesktopConnectionProcess(ctx context.Context, owner *Connection) error {
	if owner == nil || !owner.VerifiedDesktopTransport() {
		return fmt.Errorf("Desktop process is unavailable")
	}
	expected, ok := owner.ClientProcess()
	if !ok {
		return fmt.Errorf("Desktop process evidence is unavailable")
	}
	identity, err := resolveWindowsActiveSessionIdentity(windows.WTSGetActiveConsoleSessionId())
	if err != nil {
		return err
	}
	current, live, err := verifyWindowsAppProcess(ctx, expected.PID, identity, expected.CanonicalExecutablePath, pinnedRebindExecutable{expected}, expected.ExecutableTrustSetID, false)
	if err != nil {
		return err
	}
	defer func() { _ = live.Close() }()
	if current != expected {
		return fmt.Errorf("Desktop process changed")
	}
	return nil
}

type pinnedRebindExecutable struct{ expected ProcessTuple }

func (p pinnedRebindExecutable) VerifyWindowsExecutable(_ context.Context, role WindowsExecutableRole, locked WindowsLockedExecutable) (string, error) {
	if role != WindowsExecutableRoleLocalApp || locked == nil {
		return "", fmt.Errorf("current process executable is unavailable")
	}
	observed := locked.Evidence()
	if observed.Digest != p.expected.ExecutableDigest || observed.CanonicalFileIdentity != p.expected.CanonicalExecutableIdentity || (p.expected.CanonicalExecutablePath != "" && !sameWindowsLocalDevelopmentHostFile(observed.Path, p.expected.CanonicalExecutablePath)) {
		return "", fmt.Errorf("process executable changed")
	}
	return p.expected.ExecutableTrustSetID, nil
}
