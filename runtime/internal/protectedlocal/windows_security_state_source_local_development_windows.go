//go:build windows && nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	windowsSourceRuntimeExecutableEnvironment    = "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE"
	windowsSourceSupervisorExecutableEnvironment = "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_SUPERVISOR_EXECUTABLE"
	windowsSourceDesktopExecutableEnvironment    = "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_DESKTOP_EXECUTABLE"
)

func OpenWindowsSourceLocalDevelopmentRuntimeSecurityState(ctx context.Context) (*WindowsRuntimeSecurityState, error) {
	if ctx == nil {
		return nil, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("current-user Runtime context is required"))
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	principal, identity, err := validateWindowsSourceCurrentPrincipal(ctx)
	if err != nil {
		return nil, err
	}
	runtimePath, err := windowsSourceExpectedExecutable(windowsSourceRuntimeExecutableEnvironment)
	if err != nil {
		return nil, fail(ReasonRuntimeExecutableTrustInvalid, false, "restart_runtime", err)
	}
	runtimeIdentity, runtimeLiveness, err := inspectWindowsSourceProcess(ctx, uint32(os.Getpid()), identity, runtimePath)
	if err != nil {
		return nil, fail(ReasonRuntimeExecutableTrustInvalid, false, "restart_runtime", err)
	}
	_ = runtimeLiveness.Close()

	desktopPath, err := windowsSourceExpectedExecutable(windowsSourceDesktopExecutableEnvironment)
	if err != nil {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_runtime", fmt.Errorf("expected source Desktop executable is unavailable: %w", err))
	}
	supervisorPID := uint32(os.Getppid())
	supervisorPath, err := windowsSourceExpectedExecutable(windowsSourceSupervisorExecutableEnvironment)
	if err != nil || supervisorPID <= 1 || runtimeIdentity.parentPID != supervisorPID {
		return nil, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("exact parent source Runtime supervisor launch is unavailable"))
	}
	supervisorIdentity, supervisorLiveness, err := inspectWindowsSourceProcess(ctx, supervisorPID, identity, supervisorPath)
	if err != nil {
		return nil, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("verify source Runtime supervisor: %w", err))
	}
	keepSupervisorLiveness := false
	defer func() {
		if !keepSupervisorLiveness {
			_ = supervisorLiveness.Close()
		}
	}()

	root, err := prepareWindowsSourceStateRoot(principal.tokenUserSID)
	if err != nil {
		return nil, err
	}
	secrets, err := openWindowsSourceSecretStore(filepath.Join(root.path, "secrets"))
	if err != nil {
		return nil, err
	}
	anchorStore, err := NewWindowsServiceAnchorStore(secrets)
	if err != nil {
		return nil, err
	}
	recordMACKey, err := LoadOrCreateWindowsLedgerRecordMACKey(ctx, secrets)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(recordMACKey)
	ledgerPath, err := WindowsProtectedLedgerPath(root)
	if err != nil {
		return nil, err
	}
	ledger, err := OpenLedger(ctx, LedgerOptions{Path: ledgerPath, AnchorStore: anchorStore, RecordMACKey: recordMACKey})
	if err != nil {
		return nil, err
	}
	keepLedger := false
	defer func() {
		if !keepLedger {
			_ = ledger.Close()
		}
	}()
	desktopSessions, err := NewDirectDesktopSessionManager(nil)
	if err != nil {
		return nil, err
	}
	bootEpoch, err := NewBootEpoch(nil)
	if err != nil {
		return nil, err
	}
	state := &WindowsRuntimeSecurityState{
		root: root, principal: principal, secrets: secrets, ledger: ledger, bootEpoch: bootEpoch,
		desktopSessions: desktopSessions, directLocalAppLaunches: NewDirectLocalAppLaunches(),
		desktopIdentity: identity, sourceLocalDevelopment: true,
		ownerProcess: supervisorLiveness, ownerIdentity: supervisorIdentity, expectedDesktopPath: desktopPath,
	}
	keepSupervisorLiveness = true
	keepLedger = true
	return state, nil
}

func validateWindowsSourceCurrentPrincipal(ctx context.Context) (WindowsServicePrincipal, WindowsDesktopIdentity, error) {
	if err := ctx.Err(); err != nil {
		return WindowsServicePrincipal{}, WindowsDesktopIdentity{}, err
	}
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return WindowsServicePrincipal{}, WindowsDesktopIdentity{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("open current-user Runtime token: %w", err))
	}
	defer func() { _ = token.Close() }()
	user, err := token.GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return WindowsServicePrincipal{}, WindowsDesktopIdentity{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("read current-user Runtime SID: %w", err))
	}
	userSID := user.User.Sid.String()
	if !validWindowsSourceUserSID(userSID) {
		return WindowsServicePrincipal{}, WindowsDesktopIdentity{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("current-user Runtime SID is invalid"))
	}
	elevated, err := readWindowsTokenUint32(token, windows.TokenElevation)
	if err != nil || elevated != 0 {
		return WindowsServicePrincipal{}, WindowsDesktopIdentity{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("current-user Runtime must be non-elevated"))
	}
	sessionID, err := readWindowsTokenUint32(token, windows.TokenSessionId)
	if err != nil || sessionID == 0 || sessionID != windows.WTSGetActiveConsoleSessionId() {
		return WindowsServicePrincipal{}, WindowsDesktopIdentity{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("current-user Runtime must remain in the active interactive session"))
	}
	identity, err := resolveWindowsActiveSessionIdentity(sessionID)
	if err != nil || identity.userSID != userSID {
		return WindowsServicePrincipal{}, WindowsDesktopIdentity{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", fmt.Errorf("bind current-user Runtime to active Windows session: %w", err))
	}
	if _, err := inspectWindowsDesktopToken(token, identity); err != nil {
		return WindowsServicePrincipal{}, WindowsDesktopIdentity{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "restart_runtime", err)
	}
	return WindowsServicePrincipal{serviceSID: userSID, tokenUserSID: userSID}, identity, nil
}

func windowsSourceExpectedExecutable(environment string) (string, error) {
	raw := os.Getenv(environment)
	cleaned := filepath.Clean(strings.TrimSpace(raw))
	if raw == "" || raw != strings.TrimSpace(raw) || !filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("exact absolute source executable is required")
	}
	canonical, err := filepath.EvalSymlinks(cleaned)
	if err != nil || !strings.EqualFold(filepath.Clean(canonical), cleaned) {
		return "", fmt.Errorf("source executable must be canonical")
	}
	info, err := os.Lstat(cleaned)
	if err != nil || info == nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("source executable must be a direct regular file")
	}
	return cleaned, nil
}

func inspectWindowsSourceProcess(ctx context.Context, pid uint32, active WindowsDesktopIdentity, expectedPath string) (windowsSourceProcessIdentity, DesktopProcessLiveness, error) {
	if err := ctx.Err(); err != nil || pid == 0 || active.validate() != nil {
		return windowsSourceProcessIdentity{}, nil, fmt.Errorf("inspect source process: live process and active identity are required")
	}
	process, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return windowsSourceProcessIdentity{}, nil, fmt.Errorf("open source process: %w", err)
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = windows.CloseHandle(process)
		}
	}()
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return windowsSourceProcessIdentity{}, nil, fmt.Errorf("open source process token: %w", err)
	}
	observed, err := inspectWindowsDesktopToken(token, active)
	if err == nil {
		var elevated uint32
		elevated, err = readWindowsTokenUint32(token, windows.TokenElevation)
		if err == nil && elevated != 0 {
			err = fmt.Errorf("source process must be non-elevated")
		}
	}
	_ = token.Close()
	if err != nil {
		return windowsSourceProcessIdentity{}, nil, err
	}
	creationMarker, err := windowsProcessCreationMarker(process)
	if err != nil {
		return windowsSourceProcessIdentity{}, nil, fmt.Errorf("read source process creation marker: %w", err)
	}
	executablePath, err := windowsProcessImagePath(process)
	if err != nil || !sameWindowsSourceExecutable(executablePath, expectedPath) {
		return windowsSourceProcessIdentity{}, nil, fmt.Errorf("source process executable mismatch")
	}
	parentPID, err := windowsSourceParentProcessID(pid)
	if err != nil {
		return windowsSourceProcessIdentity{}, nil, err
	}
	liveness, err := newWindowsProcessLiveness(process, active, observed)
	if err != nil {
		return windowsSourceProcessIdentity{}, nil, err
	}
	accepted = true
	return windowsSourceProcessIdentity{
		pid: pid, parentPID: parentPID, userSID: observed.userSID, sessionID: observed.sessionID,
		creationMarker: creationMarker, executablePath: filepath.Clean(executablePath),
	}, liveness, nil
}

func sameWindowsSourceExecutable(observed, expected string) bool {
	observed = filepath.Clean(observed)
	expected = filepath.Clean(expected)
	if strings.EqualFold(observed, expected) {
		return true
	}
	observedInfo, observedErr := os.Stat(observed)
	expectedInfo, expectedErr := os.Stat(expected)
	return observedErr == nil && expectedErr == nil && observedInfo.Mode().IsRegular() && expectedInfo.Mode().IsRegular() && os.SameFile(observedInfo, expectedInfo)
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
				return 0, fmt.Errorf("source process parent is unavailable")
			}
			return entry.ParentProcessID, nil
		}
		if err := windows.Process32Next(snapshot, &entry); err != nil {
			return 0, fmt.Errorf("locate source process parent: %w", err)
		}
	}
}

func prepareWindowsSourceStateRoot(userSID string) (WindowsProtectedStateRoot, error) {
	localAppData, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, windows.KF_FLAG_DEFAULT)
	if err != nil {
		return WindowsProtectedStateRoot{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("resolve current-user local application data: %w", err))
	}
	base := filepath.Clean(localAppData)
	rootPath := filepath.Join(base, "Nimi", "RuntimeLocalDevelopment")
	if !filepath.IsAbs(base) || !filepath.IsAbs(rootPath) || !validWindowsSourceUserSID(userSID) {
		return WindowsProtectedStateRoot{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("current-user state root is invalid"))
	}
	if err := os.MkdirAll(rootPath, 0o700); err != nil {
		return WindowsProtectedStateRoot{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("create current-user state root: %w", err))
	}
	if err := validateWindowsSourceDirectoryChain(base, rootPath); err != nil {
		return WindowsProtectedStateRoot{}, err
	}
	if err := protectWindowsSourceDirectory(rootPath, userSID); err != nil {
		return WindowsProtectedStateRoot{}, err
	}
	for _, child := range []string{"runtime", "secrets"} {
		if err := os.MkdirAll(filepath.Join(rootPath, child), 0o700); err != nil {
			return WindowsProtectedStateRoot{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("create current-user state child: %w", err))
		}
	}
	file, err := os.Open(rootPath)
	if err != nil {
		return WindowsProtectedStateRoot{}, err
	}
	defer func() { _ = file.Close() }()
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &information); err != nil {
		return WindowsProtectedStateRoot{}, err
	}
	return WindowsProtectedStateRoot{
		path: rootPath, serviceSID: userSID, sourceLocalDevelopment: true,
		identity: windowsFileIdentity{volumeSerial: information.VolumeSerialNumber, fileIndex: uint64(information.FileIndexHigh)<<32 | uint64(information.FileIndexLow)},
	}, nil
}

func validateWindowsSourceDirectoryChain(base, target string) error {
	relative, err := filepath.Rel(base, target)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("current-user state root escapes local application data"))
	}
	current := base
	for _, component := range append([]string{""}, strings.Split(relative, string(filepath.Separator))...) {
		if component != "" {
			current = filepath.Join(current, component)
		}
		encoded, encodeErr := windows.UTF16PtrFromString(current)
		if encodeErr != nil {
			return encodeErr
		}
		attributes, attributeErr := windows.GetFileAttributes(encoded)
		if attributeErr != nil || attributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 || attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("current-user state root contains an invalid path component"))
		}
	}
	return nil
}

func protectWindowsSourceDirectory(path, userSID string) error {
	sddl := fmt.Sprintf("O:%sD:P(A;OICI;FA;;;%s)", userSID, userSID)
	descriptor, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("build current-user state ACL: %w", err))
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("read current-user state ACL: %w", err))
	}
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("apply current-user state ACL: %w", err))
	}
	return validateWindowsSourceOwnerAndDACL(path, userSID, true)
}

func validateWindowsSourceOwnerAndDACL(path, userSID string, directoryInheritance bool) error {
	descriptor, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil || descriptor == nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("read current-user security descriptor: %w", err))
	}
	owner, _, err := descriptor.Owner()
	expectedOwner, sidErr := windows.StringToSid(userSID)
	if err != nil || sidErr != nil || owner == nil || !windows.EqualSid(owner, expectedOwner) {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("current-user owner mismatch"))
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("current-user protected DACL is required"))
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil || dacl.AceCount != 1 {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("current-user one-entry DACL is required"))
	}
	var ace *windows.ACCESS_ALLOWED_ACE
	if err := windows.GetAce(dacl, 0, &ace); err != nil || ace == nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("read current-user DACL entry: %w", err))
	}
	principal := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
	inherited := ace.Header.AceFlags&windows.INHERITED_ACE != 0
	fullControl := uint32(ace.Mask) == windows.GENERIC_ALL || uint32(ace.Mask) == windowsFileAllAccess
	if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || validateWindowsSourceOwnerOnlyACLPolicy(userSID, []windowsSourceACLPolicyEntry{{Principal: principal, Allow: true, Inherited: inherited, FullControl: fullControl}}) != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("current-user DACL policy mismatch"))
	}
	if directoryInheritance && ace.Header.AceFlags&uint8(windows.OBJECT_INHERIT_ACE|windows.CONTAINER_INHERIT_ACE) != uint8(windows.OBJECT_INHERIT_ACE|windows.CONTAINER_INHERIT_ACE) {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("current-user state DACL must inherit to children"))
	}
	return nil
}
