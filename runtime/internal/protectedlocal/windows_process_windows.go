//go:build windows

package protectedlocal

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsProcessLiveness struct {
	handle windows.Handle

	revoked chan struct{}
	stop    chan struct{}
	done    chan struct{}

	revokeOnce sync.Once
	closeOnce  sync.Once
	closeErr   error
}

type windowsLockedExecutable struct {
	handle   windows.Handle
	evidence WindowsExecutableEvidence
}

type windowsInstalledProcessVerifier struct {
	identity WindowsDesktopIdentity
	verifier WindowsExecutableTrustVerifier
}

func NewWindowsInstalledProcessVerifier(identity WindowsDesktopIdentity, verifier WindowsExecutableTrustVerifier) (InstalledProcessVerifier, error) {
	if err := identity.validate(); err != nil || verifier == nil {
		return nil, windowsPipeFailure("create Windows installed process verifier", fmt.Errorf("active Desktop identity and executable verifier are required: %w", err))
	}
	return &windowsInstalledProcessVerifier{identity: identity, verifier: verifier}, nil
}

func (verifier *windowsInstalledProcessVerifier) VerifyInstalledProcess(ctx context.Context, pid uint32) (ProcessTuple, DesktopProcessLiveness, error) {
	if verifier == nil {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows installed process", fmt.Errorf("installed process verifier is required"))
	}
	return verifyWindowsInstalledProcess(ctx, pid, verifier.identity, verifier.verifier)
}

func (locked *windowsLockedExecutable) Evidence() WindowsExecutableEvidence {
	if locked == nil {
		return WindowsExecutableEvidence{}
	}
	return locked.evidence
}

func (locked *windowsLockedExecutable) NativeHandle() uintptr {
	if locked == nil {
		return 0
	}
	return uintptr(locked.handle)
}

// VerifyWindowsProductionRuntimeProcess revalidates the current SCM service
// principal, installs and reads back the exact closed process DACL, then binds
// the token, creation marker, locked executable object, and exact production
// Runtime trust row before protected handshakes are served.
func VerifyWindowsProductionRuntimeProcess(ctx context.Context, principal WindowsServicePrincipal, verifier WindowsExecutableTrustVerifier) (WindowsRuntimeProcess, error) {
	validatedPrincipal, err := ValidateWindowsProductionPrincipal(ctx)
	if err != nil {
		return WindowsRuntimeProcess{}, err
	}
	if validatedPrincipal != principal {
		return WindowsRuntimeProcess{}, principalFailure("bind Runtime executable verification to service principal", fmt.Errorf("principal capability mismatch"))
	}
	if err := HardenWindowsCurrentProcessIsolation(ctx, principal); err != nil {
		return WindowsRuntimeProcess{}, err
	}
	pid := uint32(os.Getpid())
	process, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return WindowsRuntimeProcess{}, principalFailure("open Runtime service process", err)
	}
	defer windows.CloseHandle(process)
	return verifyWindowsRuntimeProcessHandle(ctx, pid, process, principal, verifier)
}

// VerifyWindowsProductionPipeServer is the Desktop/client-side half of mutual
// named-pipe authentication. It binds the connected pipe's actual server PID
// to the running NimiRuntime SCM service, exact service token/process DACL, and
// locked production Runtime executable object.
func VerifyWindowsProductionPipeServer(ctx context.Context, clientPipeHandle uintptr, verifier WindowsExecutableTrustVerifier) (WindowsRuntimeProcess, error) {
	pipe := windows.Handle(clientPipeHandle)
	if pipe == 0 || pipe == windows.InvalidHandle {
		return WindowsRuntimeProcess{}, principalFailure("verify Windows pipe server", fmt.Errorf("connected client pipe handle required"))
	}
	var serverPID uint32
	if err := windows.GetNamedPipeServerProcessId(pipe, &serverPID); err != nil {
		return WindowsRuntimeProcess{}, principalFailure("bind Windows pipe server process id", err)
	}
	if serverPID == 0 {
		return WindowsRuntimeProcess{}, principalFailure("bind Windows pipe server process id", fmt.Errorf("empty server process id"))
	}
	process, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.READ_CONTROL, false, serverPID)
	if err != nil {
		return WindowsRuntimeProcess{}, principalFailure("open Windows pipe server process", err)
	}
	defer windows.CloseHandle(process)
	principal, err := validateWindowsProductionServiceProcess(ctx, serverPID, process, false)
	if err != nil {
		return WindowsRuntimeProcess{}, err
	}
	return verifyWindowsRuntimeProcessHandle(ctx, serverPID, process, principal, verifier)
}

func verifyWindowsRuntimeProcessHandle(ctx context.Context, pid uint32, process windows.Handle, principal WindowsServicePrincipal, verifier WindowsExecutableTrustVerifier) (WindowsRuntimeProcess, error) {
	if err := validateWindowsProcessIsolationHandle(ctx, process, principal); err != nil {
		return WindowsRuntimeProcess{}, err
	}
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return WindowsRuntimeProcess{}, principalFailure("open Runtime service process token", err)
	}
	user, userErr := token.GetTokenUser()
	sessionID, sessionErr := readWindowsTokenUint32(token, windows.TokenSessionId)
	logonLUID, luidErr := windowsTokenLogonLUID(token)
	_ = token.Close()
	if userErr != nil {
		return WindowsRuntimeProcess{}, principalFailure("bind Runtime service token user", userErr)
	}
	if user == nil || user.User.Sid == nil || user.User.Sid.String() != principal.tokenUserSID {
		return WindowsRuntimeProcess{}, principalFailure("bind Runtime service token user", fmt.Errorf("token user SID mismatch"))
	}
	if sessionErr != nil {
		return WindowsRuntimeProcess{}, principalFailure("bind Runtime service session zero", sessionErr)
	}
	if sessionID != 0 {
		return WindowsRuntimeProcess{}, principalFailure("bind Runtime service session zero", fmt.Errorf("service process is not in session zero"))
	}
	if luidErr != nil {
		return WindowsRuntimeProcess{}, principalFailure("bind Runtime service logon LUID", luidErr)
	}
	creationMarker, err := windowsProcessCreationMarker(process)
	if err != nil {
		return WindowsRuntimeProcess{}, principalFailure("read Runtime service creation marker", err)
	}
	evidence, trustSetID, err := verifyWindowsLockedExecutable(ctx, process, pid, creationMarker, WindowsExecutableRoleRuntime, verifier, WindowsRuntimeProductionTrustSetID)
	if err != nil {
		return WindowsRuntimeProcess{}, err
	}
	if result, err := windows.WaitForSingleObject(process, 0); err != nil {
		return WindowsRuntimeProcess{}, principalFailure("validate live Runtime service process", err)
	} else if result != uint32(windows.WAIT_TIMEOUT) {
		return WindowsRuntimeProcess{}, principalFailure("validate live Runtime service process", fmt.Errorf("service process already exited"))
	}
	tuple := ProcessTuple{
		OS:                          OSWindows,
		PID:                         pid,
		CreationMarker:              creationMarker,
		OSLoginSession:              logonLUID,
		SecurityPrincipal:           principal.serviceSID,
		CanonicalExecutableIdentity: evidence.CanonicalFileIdentity,
		ExecutableDigest:            evidence.Digest,
		ExecutableTrustSetID:        trustSetID,
	}
	if err := tuple.validate(); err != nil {
		return WindowsRuntimeProcess{}, principalFailure("validate Runtime service process tuple", err)
	}
	return WindowsRuntimeProcess{principalSID: principal.serviceSID, tuple: tuple}, nil
}

func (connection *WindowsDesktopPipeConnection) VerifyClientProcess(ctx context.Context, verifier WindowsExecutableTrustVerifier) (ProcessTuple, DesktopProcessLiveness, error) {
	return connection.verifyAndBindClientProcess(ctx, verifier, WindowsDesktopProductionTrustSetID)
}

func (connection *WindowsDesktopPipeConnection) verifyAndBindClientProcess(ctx context.Context, verifier WindowsExecutableTrustVerifier, expectedTrustSetID string) (ProcessTuple, DesktopProcessLiveness, error) {
	return connection.verifyAndBindClientProcessForRole(ctx, verifier, WindowsExecutableRoleDesktop, expectedTrustSetID)
}

func (connection *WindowsDesktopPipeConnection) verifyAndBindClientProcessForRole(ctx context.Context, verifier WindowsExecutableTrustVerifier, role WindowsExecutableRole, expectedTrustSetID string) (ProcessTuple, DesktopProcessLiveness, error) {
	if connection == nil {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows pipe client process", fmt.Errorf("connected pipe capability required"))
	}
	connection.verificationMu.Lock()
	defer connection.verificationMu.Unlock()
	if connection.verifiedClientHealth != nil || connection.verifiedClient != (ProcessTuple{}) {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows pipe client process", fmt.Errorf("desktop process capability is already bound"))
	}
	tuple, liveness, err := verifyWindowsPipeClientProcessForRole(ctx, connection, connection.instanceIdentity(), verifier, role, expectedTrustSetID)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	connection.instance.mu.Lock()
	closed := connection.instance.closed
	connection.instance.mu.Unlock()
	if closed {
		_ = liveness.Close()
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows pipe client process", fmt.Errorf("pipe connection closed during verification"))
	}
	connection.verifiedClient = tuple
	connection.verifiedClientHealth = liveness
	return tuple, liveness, nil
}

func (connection *WindowsDesktopPipeConnection) instanceIdentity() WindowsDesktopIdentity {
	if connection == nil || connection.instance == nil {
		return WindowsDesktopIdentity{}
	}
	return connection.instance.identity
}

func verifyWindowsPipeClientProcess(ctx context.Context, connection *WindowsDesktopPipeConnection, identity WindowsDesktopIdentity, verifier WindowsExecutableTrustVerifier, expectedTrustSetID string) (ProcessTuple, DesktopProcessLiveness, error) {
	return verifyWindowsPipeClientProcessForRole(ctx, connection, identity, verifier, WindowsExecutableRoleDesktop, expectedTrustSetID)
}

func verifyWindowsPipeClientProcessForRole(ctx context.Context, connection *WindowsDesktopPipeConnection, identity WindowsDesktopIdentity, verifier WindowsExecutableTrustVerifier, role WindowsExecutableRole, expectedTrustSetID string) (ProcessTuple, DesktopProcessLiveness, error) {
	if err := ctx.Err(); err != nil {
		return ProcessTuple{}, nil, fmt.Errorf("verify Windows pipe client process: %w", err)
	}
	if connection == nil || connection.instance == nil || connection.clientPID == 0 {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows pipe client process", fmt.Errorf("connected pipe capability required"))
	}
	connection.instance.mu.Lock()
	closed := connection.instance.closed
	connection.instance.mu.Unlock()
	if closed {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows pipe client process", fmt.Errorf("pipe connection is closed"))
	}
	if err := identity.validate(); err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows pipe client identity", err)
	}
	if activeSessionID := windows.WTSGetActiveConsoleSessionId(); activeSessionID == windowsNoActiveConsoleSession || activeSessionID != identity.sessionID {
		return ProcessTuple{}, nil, windowsPipeFailure("revalidate active Windows desktop session", fmt.Errorf("active console session changed"))
	}
	process, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, connection.clientPID)
	if err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("retain Windows pipe client process", err)
	}
	acceptedHandle := false
	defer func() {
		if !acceptedHandle {
			_ = windows.CloseHandle(process)
		}
	}()

	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("open Windows pipe client token", err)
	}
	observedIdentity, err := inspectWindowsDesktopToken(token, &identity.sessionID)
	_ = token.Close()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	if observedIdentity.userSID != identity.userSID || observedIdentity.logonSID != identity.logonSID || observedIdentity.logonLUID != identity.logonLUID || observedIdentity.accountScope != identity.accountScope {
		return ProcessTuple{}, nil, windowsPipeFailure("bind Windows pipe client logon identity", fmt.Errorf("user SID, logon SID, or logon LUID mismatch"))
	}

	creationMarker, err := windowsProcessCreationMarker(process)
	if err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("read Windows pipe client creation marker", err)
	}
	evidence, trustSetID, err := verifyWindowsLockedExecutable(ctx, process, connection.clientPID, creationMarker, role, verifier, expectedTrustSetID)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	liveness, err := newWindowsProcessLiveness(process)
	if err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("retain Windows pipe client liveness", err)
	}
	acceptedHandle = true
	tuple := ProcessTuple{
		OS:                          OSWindows,
		PID:                         connection.clientPID,
		CreationMarker:              creationMarker,
		OSLoginSession:              observedIdentity.logonLUID,
		SecurityPrincipal:           observedIdentity.userSID,
		CanonicalExecutableIdentity: evidence.CanonicalFileIdentity,
		ExecutableDigest:            evidence.Digest,
		ExecutableTrustSetID:        trustSetID,
	}
	if err := tuple.validate(); err != nil {
		_ = liveness.Close()
		return ProcessTuple{}, nil, windowsPipeFailure("validate Windows pipe client process tuple", err)
	}
	return tuple, liveness, nil
}

func verifyWindowsInstalledProcess(ctx context.Context, pid uint32, identity WindowsDesktopIdentity, verifier WindowsExecutableTrustVerifier) (ProcessTuple, DesktopProcessLiveness, error) {
	if err := ctx.Err(); err != nil || pid == 0 {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows installed process", fmt.Errorf("live process and context are required: %w", err))
	}
	if err := identity.validate(); err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows installed identity", err)
	}
	process, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("retain Windows installed process", err)
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = windows.CloseHandle(process)
		}
	}()
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("open Windows installed process token", err)
	}
	observed, err := inspectWindowsDesktopToken(token, &identity.sessionID)
	_ = token.Close()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	if observed.userSID != identity.userSID || observed.logonSID != identity.logonSID || observed.logonLUID != identity.logonLUID || observed.accountScope != identity.accountScope {
		return ProcessTuple{}, nil, windowsPipeFailure("bind Windows installed process logon identity", fmt.Errorf("user SID, logon SID, or logon LUID mismatch"))
	}
	creationMarker, err := windowsProcessCreationMarker(process)
	if err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("read Windows installed process creation marker", err)
	}
	evidence, trustSetID, err := verifyWindowsLockedExecutable(ctx, process, pid, creationMarker, WindowsExecutableRoleInstalled, verifier, WindowsInstalledReleaseTrustSetID)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	liveness, err := newWindowsProcessLiveness(process)
	if err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("retain Windows installed process liveness", err)
	}
	accepted = true
	tuple := ProcessTuple{OS: OSWindows, PID: pid, CreationMarker: creationMarker, OSLoginSession: observed.logonLUID, SecurityPrincipal: observed.userSID, CanonicalExecutableIdentity: evidence.CanonicalFileIdentity, ExecutableDigest: evidence.Digest, ExecutableTrustSetID: trustSetID}
	if err := tuple.validate(); err != nil {
		_ = liveness.Close()
		return ProcessTuple{}, nil, windowsPipeFailure("validate Windows installed process tuple", err)
	}
	return tuple, liveness, nil
}

func verifyWindowsLockedExecutable(ctx context.Context, process windows.Handle, pid uint32, creationMarker string, role WindowsExecutableRole, verifier WindowsExecutableTrustVerifier, expectedTrustSetID string) (WindowsExecutableEvidence, string, error) {
	if verifier == nil || strings.TrimSpace(expectedTrustSetID) == "" {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("verify locked Windows executable", fmt.Errorf("executable trust verifier and exact trust set are required"))
	}
	path, err := windowsProcessImagePath(process)
	if err != nil {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("resolve Windows process executable", err)
	}
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("encode Windows process executable path", err)
	}
	handle, err := windows.CreateFile(
		pathPointer,
		windows.GENERIC_READ|windows.FILE_READ_ATTRIBUTES|windows.READ_CONTROL,
		windows.FILE_SHARE_READ,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_SEQUENTIAL_SCAN,
		0,
	)
	if err != nil {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("lock Windows process executable", err)
	}
	file := os.NewFile(uintptr(handle), path)
	if file == nil {
		_ = windows.CloseHandle(handle)
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("wrap locked Windows process executable", fmt.Errorf("invalid file handle"))
	}
	defer file.Close()
	if err := validateWindowsRegularFile(handle); err != nil {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("validate locked Windows process executable", err)
	}
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("read locked Windows executable identity", err)
	}
	canonicalIdentity := fmt.Sprintf("windows-volume-%08x-file-%016x", information.VolumeSerialNumber, uint64(information.FileIndexHigh)<<32|uint64(information.FileIndexLow))
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("hash locked Windows process executable", err)
	}
	var digest Identifier
	copy(digest[:], hash.Sum(nil))
	evidence := WindowsExecutableEvidence{
		PID:                   pid,
		CreationMarker:        creationMarker,
		Path:                  path,
		CanonicalFileIdentity: canonicalIdentity,
		Digest:                digest,
	}
	if err := ctx.Err(); err != nil {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("verify locked Windows process executable", err)
	}
	locked := &windowsLockedExecutable{handle: handle, evidence: evidence}
	trustSetID, err := verifier.VerifyWindowsExecutable(ctx, role, locked)
	if err != nil {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("verify Windows executable trust record", err)
	}
	trustSetID = strings.TrimSpace(trustSetID)
	if trustSetID != expectedTrustSetID {
		return WindowsExecutableEvidence{}, "", windowsExecutableTrustFailure("verify Windows executable trust set", fmt.Errorf("exact trust set mismatch"))
	}
	return evidence, trustSetID, nil
}

func windowsProcessImagePath(process windows.Handle) (string, error) {
	buffer := make([]uint16, 32768)
	length := uint32(len(buffer))
	if err := windows.QueryFullProcessImageName(process, 0, &buffer[0], &length); err != nil {
		return "", err
	}
	path := windows.UTF16ToString(buffer[:length])
	cleaned := filepath.Clean(path)
	if path == "" || !filepath.IsAbs(cleaned) || strings.HasPrefix(cleaned, `\\`) || strings.ContainsRune(cleaned, '\x00') {
		return "", fmt.Errorf("absolute local executable path required")
	}
	return cleaned, nil
}

func windowsProcessCreationMarker(process windows.Handle) (string, error) {
	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(process, &creation, &exit, &kernel, &user); err != nil {
		return "", err
	}
	value := uint64(creation.HighDateTime)<<32 | uint64(creation.LowDateTime)
	if value == 0 {
		return "", fmt.Errorf("empty process creation time")
	}
	return fmt.Sprintf("%016x", value), nil
}

func windowsTokenLogonLUID(token windows.Token) (string, error) {
	statisticsBuffer, err := readWindowsTokenInformation(token, windows.TokenStatistics)
	if err != nil || len(statisticsBuffer) < int(unsafe.Sizeof(windowsTokenStatistics{})) {
		if err == nil {
			err = fmt.Errorf("short token statistics")
		}
		return "", err
	}
	statistics := (*windowsTokenStatistics)(unsafe.Pointer(&statisticsBuffer[0]))
	if statistics.AuthenticationID == (windows.LUID{}) {
		return "", fmt.Errorf("empty authentication identifier")
	}
	return fmt.Sprintf("%08x:%08x", uint32(statistics.AuthenticationID.HighPart), statistics.AuthenticationID.LowPart), nil
}

func newWindowsProcessLiveness(handle windows.Handle) (*windowsProcessLiveness, error) {
	if handle == 0 || handle == windows.InvalidHandle {
		return nil, fmt.Errorf("invalid process handle")
	}
	result, err := windows.WaitForSingleObject(handle, 0)
	if err != nil {
		return nil, err
	}
	if result != uint32(windows.WAIT_TIMEOUT) {
		return nil, fmt.Errorf("process already exited")
	}
	liveness := &windowsProcessLiveness{
		handle:  handle,
		revoked: make(chan struct{}),
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}
	go liveness.watch()
	return liveness, nil
}

func (liveness *windowsProcessLiveness) watch() {
	defer close(liveness.done)
	for {
		result, err := windows.WaitForSingleObject(liveness.handle, 100)
		if err != nil || result == windows.WAIT_OBJECT_0 {
			liveness.revoke()
			return
		}
		if result != uint32(windows.WAIT_TIMEOUT) {
			liveness.revoke()
			return
		}
		select {
		case <-liveness.stop:
			return
		default:
		}
	}
}

func (liveness *windowsProcessLiveness) Revoked() <-chan struct{} {
	if liveness == nil {
		return nil
	}
	return liveness.revoked
}

func (liveness *windowsProcessLiveness) revoke() {
	if liveness == nil {
		return
	}
	liveness.revokeOnce.Do(func() {
		close(liveness.revoked)
	})
}

func (liveness *windowsProcessLiveness) Close() error {
	if liveness == nil {
		return nil
	}
	liveness.closeOnce.Do(func() {
		liveness.revoke()
		close(liveness.stop)
		<-liveness.done
		liveness.closeErr = windows.CloseHandle(liveness.handle)
	})
	return liveness.closeErr
}

func windowsExecutableTrustFailure(operation string, cause error) error {
	return fail(
		ReasonDesktopExecutableTrustFailed,
		false,
		"reinstall_desktop",
		fmt.Errorf("%s: %w", operation, cause),
	)
}

var _ DesktopProcessLiveness = (*windowsProcessLiveness)(nil)
var _ InstalledProcessVerifier = (*windowsInstalledProcessVerifier)(nil)
