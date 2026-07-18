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

func TestWindowsProcessTrustStartupExitCodesAreStableAndUnique(t *testing.T) {
	stages := []WindowsProcessTrustFailureStage{
		WindowsProcessTrustStagePrincipalRevalidation,
		WindowsProcessTrustStagePrincipalBinding,
		WindowsProcessTrustStageIsolationHarden,
		WindowsProcessTrustStageProcessOpen,
		WindowsProcessTrustStageIsolationValidation,
		WindowsProcessTrustStageTokenOpen,
		WindowsProcessTrustStageTokenUserQuery,
		WindowsProcessTrustStageTokenUserMatch,
		WindowsProcessTrustStageSessionQuery,
		WindowsProcessTrustStageSessionZero,
		WindowsProcessTrustStageLogonLUID,
		WindowsProcessTrustStageCreationMarker,
		WindowsProcessTrustStageExecutableInput,
		WindowsProcessTrustStageExecutablePath,
		WindowsProcessTrustStageExecutablePathEncoding,
		WindowsProcessTrustStageExecutableLock,
		WindowsProcessTrustStageExecutableHandle,
		WindowsProcessTrustStageExecutableFileType,
		WindowsProcessTrustStageExecutableIdentity,
		WindowsProcessTrustStageExecutableHash,
		WindowsProcessTrustStageExecutableContext,
		WindowsProcessTrustStageExecutableTrustRecord,
		WindowsProcessTrustStageExecutableTrustSet,
		WindowsProcessTrustStageLivenessQuery,
		WindowsProcessTrustStageLivenessState,
		WindowsProcessTrustStageTuple,
		WindowsProcessTrustStageProcessOpenAccessDenied,
		WindowsProcessTrustStageTokenIsolationHarden,
		WindowsProcessTrustStageTokenIsolationValidation,
	}
	seen := make(map[uint32]struct{}, len(stages))
	for _, stage := range stages {
		err := windowsProcessTrustStageFailure(stage, fmt.Errorf("private process detail"))
		projected, ok := WindowsProcessTrustStageFromError(err)
		if !ok || projected != stage {
			t.Fatalf("process trust stage = (%v, %v), want %v", projected, ok, stage)
		}
		code, ok := WindowsProcessTrustStartupExitCode(err)
		if !ok || code != WindowsProcessTrustStartupExitCodeBase+uint32(stage) {
			t.Fatalf("process trust exit code = (%x, %v), want %x", code, ok, WindowsProcessTrustStartupExitCodeBase+uint32(stage))
		}
		if _, exists := seen[code]; exists {
			t.Fatalf("duplicate process trust exit code %x", code)
		}
		seen[code] = struct{}{}
	}
}

func TestWindowsRuntimeProcessOpenProjectsNativeAccessDenied(t *testing.T) {
	if stage := windowsProcessOpenFailureStage(windows.ERROR_ACCESS_DENIED); stage != WindowsProcessTrustStageProcessOpenAccessDenied {
		t.Fatalf("access-denied process-open stage = %v", stage)
	}
	if stage := windowsProcessOpenFailureStage(windows.ERROR_INVALID_PARAMETER); stage != WindowsProcessTrustStageProcessOpen {
		t.Fatalf("generic process-open stage = %v", stage)
	}
}

func TestWindowsRuntimeProcessVerificationHandleIsReadOnlyAndCanReadItsDACL(t *testing.T) {
	required := uint32(windows.SYNCHRONIZE | windows.PROCESS_QUERY_LIMITED_INFORMATION | windows.READ_CONTROL)
	if windowsRuntimeProcessVerificationAccess&required != required {
		t.Fatalf("Runtime process verification access = 0x%x, want required 0x%x", windowsRuntimeProcessVerificationAccess, required)
	}
	if windowsRuntimeProcessVerificationAccess&windowsSensitiveProcessAccess != 0 {
		t.Fatalf("Runtime process verification requested sensitive process access: 0x%x", windowsRuntimeProcessVerificationAccess)
	}
}

func TestWindowsRuntimeTokenVerificationHandleIsQueryOnlyAndCanReadItsDACL(t *testing.T) {
	required := uint32(windows.TOKEN_QUERY | windows.READ_CONTROL)
	if windowsRuntimeTokenVerificationAccess&required != required {
		t.Fatalf("Runtime token verification access = 0x%x, want required 0x%x", windowsRuntimeTokenVerificationAccess, required)
	}
	if windowsRuntimeTokenVerificationAccess&windowsSensitiveTokenAccess != 0 {
		t.Fatalf("Runtime token verification requested sensitive token access: 0x%x", windowsRuntimeTokenVerificationAccess)
	}
}

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
	defer func() { _ = liveness.Close() }()
	if tuple.PID != uint32(os.Getpid()) || tuple.SecurityPrincipal != identity.UserSID() || tuple.OSLoginSession == "" || strings.HasPrefix(tuple.OSLoginSession, "wts:") {
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
	wrongIdentity.sessionID++
	if _, badLiveness, err := verifyWindowsPipeClientProcess(context.Background(), connection, wrongIdentity, verifier, windowsDesktopE2ETrustSetID); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		if badLiveness != nil {
			_ = badLiveness.Close()
		}
		t.Fatalf("wrong terminal session error = %v", err)
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
	identity, _ := resolveWindowsDesktopTestBootstrap(t)
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
	var token windows.Token
	if err := windows.OpenProcessToken(handle, windows.TOKEN_QUERY, &token); err != nil {
		_ = windows.CloseHandle(handle)
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatal(err)
	}
	connectedLogon, err := inspectWindowsDesktopToken(token, identity)
	_ = token.Close()
	if err != nil {
		_ = windows.CloseHandle(handle)
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatal(err)
	}
	liveness, err := newWindowsProcessLiveness(handle, identity, connectedLogon)
	if err != nil {
		_ = windows.CloseHandle(handle)
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatal(err)
	}
	defer func() { _ = liveness.Close() }()
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
		serviceSID:   mustActiveWindowsRuntimeProfile().serviceSID,
		tokenUserSID: user.User.Sid.String(),
	}, &capturingWindowsExecutableVerifier{trustSetID: mustActiveWindowsRuntimeProfile().runtimeTrustSetID})
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
	profile := mustActiveWindowsRuntimeProfile()
	principal := WindowsServicePrincipal{serviceSID: profile.serviceSID, tokenUserSID: profile.serviceHostSID}
	identity, err := ResolveWindowsActiveDesktopIdentity(context.Background(), principal)
	if err != nil {
		t.Fatal(err)
	}
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
