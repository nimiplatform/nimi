//go:build windows

package protectedlocal

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsNamedPipeClientProcessUsesExactTokenAndLockedExecutableEvidence(t *testing.T) {
	identity, connection, closePipe := openCurrentProcessWindowsTestPipe(t)
	defer closePipe()

	verifier := &capturingWindowsExecutableVerifier{trustSetID: windowsDesktopE2ETrustSetID}
	tuple, liveness, err := verifyWindowsPipeClientProcess(
		context.Background(),
		connection,
		identity,
		verifier,
		windowsDesktopE2ETrustSetID,
	)
	if err != nil {
		t.Fatalf("verify named-pipe client process: %v", err)
	}
	defer liveness.Close()
	if tuple.PID != uint32(os.Getpid()) || tuple.SecurityPrincipal != identity.UserSID() || tuple.OSLoginSession != identity.LogonSession() {
		t.Fatalf("verified tuple mismatch: %#v", tuple)
	}
	if tuple.ExecutableTrustSetID != windowsDesktopE2ETrustSetID || tuple.ExecutableDigest == (Identifier{}) {
		t.Fatalf("verified executable trust mismatch: %#v", tuple)
	}
	if verifier.role != WindowsExecutableRoleDesktop || verifier.evidence.PID != uint32(os.Getpid()) ||
		verifier.evidence.Digest == (Identifier{}) || verifier.evidence.CanonicalFileIdentity == "" || verifier.evidence.Path == "" || verifier.nativeHandle == 0 {
		t.Fatalf("incomplete locked executable evidence: role=%q evidence=%#v", verifier.role, verifier.evidence)
	}
	select {
	case <-liveness.Revoked():
		t.Fatal("live client process witness was already revoked")
	default:
	}

	wrongIdentity := identity
	wrongIdentity.logonLUID = "ffffffff:ffffffff"
	wrongIdentity.accountScope = "windows:" + strings.ToLower(wrongIdentity.userSID) + ":" + wrongIdentity.logonLUID
	if _, badLiveness, err := verifyWindowsPipeClientProcess(context.Background(), connection, wrongIdentity, verifier, windowsDesktopE2ETrustSetID); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		if badLiveness != nil {
			_ = badLiveness.Close()
		}
		t.Fatalf("wrong logon LUID error = %v", err)
	}
}

func TestWindowsExecutableTrustSetMismatchFailsClosed(t *testing.T) {
	identity, connection, closePipe := openCurrentProcessWindowsTestPipe(t)
	defer closePipe()

	verifier := &capturingWindowsExecutableVerifier{trustSetID: "unexpected-test-trust-set"}
	_, liveness, err := verifyWindowsPipeClientProcess(context.Background(), connection, identity, verifier, windowsDesktopE2ETrustSetID)
	if liveness != nil {
		_ = liveness.Close()
	}
	if !IsReason(err, ReasonDesktopExecutableTrustFailed) {
		t.Fatalf("trust-set mismatch error = %v", err)
	}
}

func TestWindowsRetainedProcessHandleRevokesOnExit(t *testing.T) {
	command := exec.Command("cmd.exe", "/c", "ping -n 2 127.0.0.1 >NUL")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(command.Process.Pid))
	if err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatal(err)
	}
	liveness, err := newWindowsProcessLiveness(handle)
	if err != nil {
		_ = windows.CloseHandle(handle)
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatal(err)
	}
	defer liveness.Close()
	if err := command.Wait(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-liveness.Revoked():
	case <-time.After(2 * time.Second):
		t.Fatal("retained Windows process handle did not revoke after exit")
	}
}

func TestWindowsProductionRuntimeProcessVerificationRejectsInteractiveHost(t *testing.T) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	_, err = VerifyWindowsProductionRuntimeProcess(context.Background(), WindowsServicePrincipal{
		serviceSID:   WindowsProductionServiceSID,
		tokenUserSID: user.User.Sid.String(),
	}, &capturingWindowsExecutableVerifier{trustSetID: WindowsRuntimeProductionTrustSetID})
	if !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("interactive Runtime verification error = %v", err)
	}
}

type capturingWindowsExecutableVerifier struct {
	trustSetID   string
	role         WindowsExecutableRole
	evidence     WindowsExecutableEvidence
	nativeHandle uintptr
}

func (verifier *capturingWindowsExecutableVerifier) VerifyWindowsExecutable(_ context.Context, role WindowsExecutableRole, locked WindowsLockedExecutable) (string, error) {
	if locked == nil || locked.NativeHandle() == 0 {
		return "", fmt.Errorf("locked executable handle is required")
	}
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(locked.NativeHandle()), &information); err != nil {
		return "", fmt.Errorf("inspect borrowed executable handle: %w", err)
	}
	verifier.role = role
	verifier.evidence = locked.Evidence()
	verifier.nativeHandle = locked.NativeHandle()
	return verifier.trustSetID, nil
}

func openCurrentProcessWindowsTestPipe(t *testing.T) (WindowsDesktopIdentity, *WindowsDesktopPipeConnection, func()) {
	t.Helper()
	identity, err := inspectWindowsDesktopToken(windows.GetCurrentProcessToken(), nil)
	if err != nil {
		t.Fatal(err)
	}
	principal := WindowsServicePrincipal{serviceSID: WindowsProductionServiceSID, tokenUserSID: "S-1-5-18"}
	pipeName := fmt.Sprintf(`\\.\pipe\nimi-runtime-e2e-process-%d-%d`, os.Getpid(), time.Now().UnixNano())
	instance, err := createWindowsDesktopPipeInstance(context.Background(), pipeName, principal, identity, true)
	if err != nil {
		t.Fatal(err)
	}
	clientResult := make(chan struct {
		handle windows.Handle
		err    error
	}, 1)
	go func() {
		name, encodeErr := windows.UTF16PtrFromString(pipeName)
		if encodeErr != nil {
			clientResult <- struct {
				handle windows.Handle
				err    error
			}{err: encodeErr}
			return
		}
		handle, openErr := windows.CreateFile(name, uint32(windowsPipeClientAccess), 0, nil, windows.OPEN_EXISTING, 0, 0)
		clientResult <- struct {
			handle windows.Handle
			err    error
		}{handle: handle, err: openErr}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, err := instance.Accept(ctx)
	client := <-clientResult
	if err != nil || client.err != nil {
		_ = instance.Close()
		if client.handle != 0 && client.handle != windows.InvalidHandle {
			_ = windows.CloseHandle(client.handle)
		}
		t.Fatalf("open test pipe: accept=%v client=%v", err, client.err)
	}
	return identity, connection, func() {
		_ = connection.Close()
		_ = windows.CloseHandle(client.handle)
	}
}
