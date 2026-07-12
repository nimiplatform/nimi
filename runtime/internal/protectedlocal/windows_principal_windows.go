//go:build windows

package protectedlocal

import (
	"context"
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const windowsSensitiveProcessAccess = windows.PROCESS_VM_READ |
	windows.PROCESS_VM_WRITE |
	windows.PROCESS_VM_OPERATION |
	windows.PROCESS_DUP_HANDLE |
	windows.PROCESS_CREATE_THREAD

func ValidateWindowsProductionPrincipal(ctx context.Context) (WindowsServicePrincipal, error) {
	return validateWindowsProductionServiceProcess(ctx, uint32(os.Getpid()), windows.CurrentProcess(), true)
}

func validateWindowsProductionServiceProcess(ctx context.Context, expectedPID uint32, process windows.Handle, allowStartPending bool) (WindowsServicePrincipal, error) {
	profile := mustActiveWindowsRuntimeProfile()
	if err := ctx.Err(); err != nil {
		return WindowsServicePrincipal{}, fmt.Errorf("validate Windows Runtime principal: %w", err)
	}
	if err := validateWindowsPrincipalProcessInput(expectedPID, process); err != nil {
		return WindowsServicePrincipal{}, err
	}
	serviceManager, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageSCMOpen, "open Windows service manager", err)
	}
	defer windows.CloseServiceHandle(serviceManager)
	serviceName, err := windows.UTF16PtrFromString(profile.serviceName)
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageServiceName, "encode fixed NimiRuntime service name", err)
	}
	serviceHandle, err := windows.OpenService(serviceManager, serviceName, windows.SERVICE_QUERY_CONFIG|windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageServiceOpen, "open fixed NimiRuntime service definition", err)
	}
	service := &mgr.Service{Name: profile.serviceName, Handle: serviceHandle}
	defer service.Close()
	configuration, err := service.Config()
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageServiceConfig, "query fixed NimiRuntime service definition", err)
	}
	status, err := service.Query()
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageServiceStatus, "query fixed NimiRuntime service status", err)
	}
	stateAllowed := status.State == svc.Running || (allowStartPending && status.State == svc.StartPending)
	if !stateAllowed || status.ProcessId != expectedPID {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageProcessBinding, "bind fixed NimiRuntime service process", fmt.Errorf("SCM state or process id mismatch"))
	}

	resolvedSID, _, _, err := windows.LookupSID("", profile.serviceAccount)
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageSIDResolution, "resolve fixed NimiRuntime service SID", err)
	}
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageTokenOpen, "open Windows service process token", err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageTokenUserQuery, "query Windows process token user", err)
	}
	groups, err := readWindowsTokenGroups(token, windows.TokenGroups)
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageTokenGroupsQuery, "query Windows process token groups", err)
	}
	restrictedSIDs, err := readWindowsTokenGroups(token, windows.TokenRestrictedSids)
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageRestrictedSIDsQuery, "query Windows restricted token SIDs", err)
	}
	sessionID, err := readWindowsTokenUint32(token, windows.TokenSessionId)
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageTokenSessionQuery, "query Windows token session", err)
	}
	tokenType, err := readWindowsTokenUint32(token, windows.TokenType)
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageTokenTypeQuery, "query Windows token type", err)
	}
	restricted, err := token.IsRestricted()
	if err != nil {
		return WindowsServicePrincipal{}, windowsPrincipalProbeFailure(WindowsPrincipalStageTokenRestrictedQuery, "query Windows restricted-token state", err)
	}
	snapshot := windowsPrincipalSnapshot{
		ResolvedServiceSID: resolvedSID.String(),
		ServiceStartName:   configuration.ServiceStartName,
		TokenUserSID:       user.User.Sid.String(),
		TokenSessionID:     sessionID,
		TokenType:          tokenType,
		TokenRestricted:    restricted,
		ServiceSIDType:     configuration.SidType,
		InteractiveService: configuration.ServiceType&windows.SERVICE_INTERACTIVE_PROCESS != 0,
		Groups:             groups,
		RestrictedSIDs:     restrictedSIDs,
	}
	return validateWindowsPrincipalSnapshot(snapshot)
}

func validateWindowsPrincipalProcessInput(expectedPID uint32, process windows.Handle) error {
	if expectedPID == 0 || process == 0 {
		return windowsPrincipalProbeFailure(WindowsPrincipalStageInput, "validate Windows Runtime service process", fmt.Errorf("process handle and PID are required"))
	}
	// GetCurrentProcess returns the documented pseudo-handle value -1, which is
	// numerically identical to INVALID_HANDLE_VALUE. Admit it only for the exact
	// current PID; external-process validation still requires a real handle.
	if process == windows.InvalidHandle && expectedPID != uint32(os.Getpid()) {
		return windowsPrincipalProbeFailure(WindowsPrincipalStageInput, "validate Windows Runtime service process", fmt.Errorf("current-process pseudo-handle does not match the current PID"))
	}
	return nil
}

// ValidateWindowsCurrentProcessIsolation verifies the process-object DACL
// required by the production profile. It does not mutate the process DACL or
// accept a caller-supplied SID.
func ValidateWindowsCurrentProcessIsolation(ctx context.Context, principal WindowsServicePrincipal) error {
	return validateWindowsProcessIsolationHandle(ctx, windows.CurrentProcess(), principal)
}

func validateWindowsProcessIsolationHandle(ctx context.Context, process windows.Handle, principal WindowsServicePrincipal) error {
	profile := mustActiveWindowsRuntimeProfile()
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("validate Windows Runtime process isolation: %w", err)
	}
	if principal.serviceSID != profile.serviceSID {
		return principalFailure("validate process isolation capability", fmt.Errorf("invalid service principal capability"))
	}
	descriptor, err := windows.GetSecurityInfo(
		process,
		windows.SE_KERNEL_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return principalFailure("read Runtime process DACL", err)
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		return principalFailure("read Runtime process DACL", err)
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return principalFailure("validate protected Runtime process DACL", err)
	}
	return validateWindowsProcessDACL(dacl)
}

func validateWindowsProcessDACL(dacl *windows.ACL) error {
	profile := mustActiveWindowsRuntimeProfile()
	if dacl == nil {
		return principalFailure("validate Runtime process DACL entries", fmt.Errorf("DACL is absent"))
	}
	if dacl.AceCount != 3 {
		return principalFailure("validate Runtime process DACL entries", fmt.Errorf("exact closed three-entry DACL required"))
	}
	deniedInteractive := false
	deniedRemoteInteractive := false
	serviceAllowed := false
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return principalFailure("read Runtime process DACL entry", err)
		}
		if ace.Header.AceFlags != 0 {
			return principalFailure("validate Runtime process DACL entry", fmt.Errorf("inherited or flagged ACE is forbidden"))
		}
		switch ace.Header.AceType {
		case windows.ACCESS_DENIED_ACE_TYPE:
			sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
			mask := uint32(ace.Mask)
			if mask != windows.GENERIC_ALL && mask&windowsSensitiveProcessAccess != windowsSensitiveProcessAccess {
				return principalFailure("validate Runtime process DACL entry", fmt.Errorf("interactive deny ACE lacks sensitive process rights"))
			}
			switch sid {
			case windowsInteractiveLogonSID:
				deniedInteractive = true
			case windowsRemoteInteractiveLogonSID:
				deniedRemoteInteractive = true
			default:
				return principalFailure("validate Runtime process DACL entry", fmt.Errorf("unexpected denied principal"))
			}
		case windows.ACCESS_ALLOWED_ACE_TYPE:
			sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
			mask := uint32(ace.Mask)
			if sid != profile.serviceSID || (mask != windows.GENERIC_ALL && mask&windows.PROCESS_ALL_ACCESS != windows.PROCESS_ALL_ACCESS) {
				return principalFailure("validate Runtime process DACL entry", fmt.Errorf("unexpected allowed principal or access mask"))
			}
			serviceAllowed = true
		default:
			return principalFailure("validate Runtime process DACL entry", fmt.Errorf("unsupported ACE type"))
		}
	}
	if !deniedInteractive || !deniedRemoteInteractive || !serviceAllowed {
		return principalFailure("validate Runtime process DACL entries", fmt.Errorf("required service allow and interactive deny entries are absent"))
	}
	return nil
}

// HardenWindowsCurrentProcessIsolation installs the frozen process DACL before
// listeners or custody are opened, then reads it back through the kernel handle.
func HardenWindowsCurrentProcessIsolation(ctx context.Context, principal WindowsServicePrincipal) error {
	profile := mustActiveWindowsRuntimeProfile()
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("harden Windows Runtime process isolation: %w", err)
	}
	if principal.serviceSID != profile.serviceSID {
		return principalFailure("harden process isolation capability", fmt.Errorf("invalid service principal capability"))
	}
	serviceSID, err := windows.StringToSid(profile.serviceSID)
	if err != nil {
		return principalFailure("parse fixed Runtime service SID", err)
	}
	interactiveSID, err := windows.StringToSid(windowsInteractiveLogonSID)
	if err != nil {
		return principalFailure("parse interactive logon SID", err)
	}
	remoteInteractiveSID, err := windows.StringToSid(windowsRemoteInteractiveLogonSID)
	if err != nil {
		return principalFailure("parse remote interactive logon SID", err)
	}
	acl, err := buildWindowsRuntimeProcessACL(serviceSID, interactiveSID, remoteInteractiveSID)
	if err != nil {
		return err
	}
	if err := windows.SetSecurityInfo(
		windows.CurrentProcess(),
		windows.SE_KERNEL_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil,
		nil,
		acl,
		nil,
	); err != nil {
		return principalFailure("apply Runtime process DACL", err)
	}
	return ValidateWindowsCurrentProcessIsolation(ctx, principal)
}

func buildWindowsRuntimeProcessACL(serviceSID, interactiveSID, remoteInteractiveSID *windows.SID) (*windows.ACL, error) {
	entries := []windows.EXPLICIT_ACCESS{
		{
			AccessPermissions: windowsSensitiveProcessAccess,
			AccessMode:        windows.DENY_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_GROUP,
				TrusteeValue: windows.TrusteeValueFromSID(interactiveSID),
			},
		},
		{
			AccessPermissions: windowsSensitiveProcessAccess,
			AccessMode:        windows.DENY_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_GROUP,
				TrusteeValue: windows.TrusteeValueFromSID(remoteInteractiveSID),
			},
		},
		{
			AccessPermissions: windows.PROCESS_ALL_ACCESS,
			AccessMode:        windows.SET_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_USER,
				TrusteeValue: windows.TrusteeValueFromSID(serviceSID),
			},
		},
	}
	acl, err := windows.ACLFromEntries(entries, nil)
	if err != nil {
		return nil, principalFailure("build Runtime process DACL", err)
	}
	return acl, nil
}

func readWindowsTokenGroups(token windows.Token, class uint32) ([]windowsSIDAttributes, error) {
	buffer, err := readWindowsTokenInformation(token, class)
	if err != nil {
		return nil, err
	}
	groups := (*windows.Tokengroups)(unsafe.Pointer(&buffer[0])).AllGroups()
	result := make([]windowsSIDAttributes, 0, len(groups))
	for _, group := range groups {
		if group.Sid == nil {
			return nil, fmt.Errorf("nil SID in access token")
		}
		result = append(result, windowsSIDAttributes{SID: group.Sid.String(), Attributes: group.Attributes})
	}
	return result, nil
}

func readWindowsTokenUint32(token windows.Token, class uint32) (uint32, error) {
	buffer, err := readWindowsTokenInformation(token, class)
	if err != nil {
		return 0, err
	}
	if len(buffer) < 4 {
		return 0, fmt.Errorf("short token information")
	}
	return *(*uint32)(unsafe.Pointer(&buffer[0])), nil
}

func readWindowsTokenInformation(token windows.Token, class uint32) ([]byte, error) {
	var size uint32
	err := windows.GetTokenInformation(token, class, nil, 0, &size)
	if err != windows.ERROR_INSUFFICIENT_BUFFER || size == 0 {
		return nil, err
	}
	buffer := make([]byte, size)
	if err := windows.GetTokenInformation(token, class, &buffer[0], size, &size); err != nil {
		return nil, err
	}
	return buffer, nil
}

func principalFailure(operation string, cause error) error {
	return fail(
		ReasonProtectedLocalRuntimePrincipalRequired,
		false,
		"repair_runtime_service",
		fmt.Errorf("%s: %w", operation, cause),
	)
}

func windowsPrincipalProbeFailure(stage WindowsPrincipalFailureStage, operation string, cause error) error {
	if cause == nil {
		cause = fmt.Errorf("Windows principal probe failed")
	}
	return principalFailure(operation, &windowsPrincipalStageError{stage: stage, cause: cause})
}
