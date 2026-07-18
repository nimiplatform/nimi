//go:build windows

package protectedlocal

import (
	"context"
	"fmt"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

const windowsRuntimeTokenVerificationAccess = windows.TOKEN_QUERY | windows.READ_CONTROL

const windowsSensitiveTokenAccess = windows.TOKEN_ASSIGN_PRIMARY |
	windows.TOKEN_DUPLICATE |
	windows.TOKEN_IMPERSONATE |
	windows.TOKEN_QUERY_SOURCE |
	windows.TOKEN_ADJUST_PRIVILEGES |
	windows.TOKEN_ADJUST_GROUPS |
	windows.TOKEN_ADJUST_DEFAULT |
	windows.TOKEN_ADJUST_SESSIONID |
	windows.DELETE |
	windows.WRITE_DAC |
	windows.WRITE_OWNER

func HardenWindowsCurrentTokenIsolation(ctx context.Context, principal WindowsServicePrincipal) error {
	profile := mustActiveWindowsRuntimeProfile()
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("harden Windows Runtime token isolation: %w", err)
	}
	if principal.serviceSID != profile.serviceSID {
		return principalFailure("harden token isolation capability", fmt.Errorf("invalid service principal capability"))
	}
	var token windows.Token
	const hardeningAccess = windows.TOKEN_QUERY | windows.READ_CONTROL | windows.WRITE_DAC | windows.WRITE_OWNER
	if err := windows.OpenProcessToken(windows.CurrentProcess(), hardeningAccess, &token); err != nil {
		return principalFailure("open Runtime primary token for isolation", err)
	}
	defer func() { _ = token.Close() }()

	serviceSID, err := windows.StringToSid(profile.serviceSID)
	if err != nil {
		return principalFailure("parse fixed Runtime service SID for token isolation", err)
	}
	interactiveSID, err := windows.StringToSid(windowsInteractiveLogonSID)
	if err != nil {
		return principalFailure("parse interactive logon SID for token isolation", err)
	}
	remoteInteractiveSID, err := windows.StringToSid(windowsRemoteInteractiveLogonSID)
	if err != nil {
		return principalFailure("parse remote interactive logon SID for token isolation", err)
	}
	acl, err := buildWindowsRuntimeTokenACL(serviceSID, interactiveSID, remoteInteractiveSID)
	if err != nil {
		return err
	}
	if err := windows.SetSecurityInfo(
		windows.Handle(token),
		windows.SE_KERNEL_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil,
		nil,
		acl,
		nil,
	); err != nil {
		return principalFailure("apply Runtime primary-token DACL", err)
	}
	labelDescriptor, label, err := buildWindowsRuntimeMandatoryLabel()
	if err != nil {
		return err
	}
	if err := windows.SetSecurityInfo(
		windows.Handle(token),
		windows.SE_KERNEL_OBJECT,
		windows.LABEL_SECURITY_INFORMATION,
		nil,
		nil,
		nil,
		label,
	); err != nil {
		return principalFailure("apply Runtime primary-token mandatory label", err)
	}
	runtime.KeepAlive(labelDescriptor)
	return validateWindowsRuntimeTokenIsolationHandle(ctx, token, principal)
}

func validateWindowsRuntimeTokenIsolationHandle(ctx context.Context, token windows.Token, principal WindowsServicePrincipal) error {
	profile := mustActiveWindowsRuntimeProfile()
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("validate Windows Runtime token isolation: %w", err)
	}
	if token == 0 || principal.serviceSID != profile.serviceSID {
		return principalFailure("validate token isolation capability", fmt.Errorf("exact Runtime token and service principal capability required"))
	}
	descriptor, err := windows.GetSecurityInfo(
		windows.Handle(token),
		windows.SE_KERNEL_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return principalFailure("read Runtime primary-token DACL", err)
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return principalFailure("read Runtime primary-token DACL", err)
	}
	if dacl == nil {
		return principalFailure("read Runtime primary-token DACL", fmt.Errorf("primary-token DACL is absent"))
	}
	control, _, err := descriptor.Control()
	if err != nil {
		return principalFailure("validate protected Runtime primary-token DACL", err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		return principalFailure("validate protected Runtime primary-token DACL", fmt.Errorf("protected DACL required"))
	}
	if err := validateWindowsRuntimeTokenDACL(dacl); err != nil {
		return err
	}
	labelDescriptor, err := windows.GetSecurityInfo(
		windows.Handle(token),
		windows.SE_KERNEL_OBJECT,
		windows.LABEL_SECURITY_INFORMATION,
	)
	if err != nil {
		return principalFailure("read Runtime primary-token mandatory label", err)
	}
	label, _, err := labelDescriptor.SACL()
	if err != nil {
		return principalFailure("read Runtime primary-token mandatory label", err)
	}
	if label == nil {
		return principalFailure("read Runtime primary-token mandatory label", fmt.Errorf("mandatory label is absent"))
	}
	return validateWindowsRuntimeMandatoryLabel(label)
}

func validateWindowsRuntimeTokenDACL(dacl *windows.ACL) error {
	profile := mustActiveWindowsRuntimeProfile()
	if dacl == nil || dacl.AceCount != 4 {
		return principalFailure("validate Runtime primary-token DACL", fmt.Errorf("exact closed four-entry DACL required"))
	}
	deniedInteractive := false
	deniedRemoteInteractive := false
	serviceAllowed := false
	interactiveVerificationAllowed := false
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return principalFailure("read Runtime primary-token DACL entry", err)
		}
		if ace.Header.AceFlags != 0 {
			return principalFailure("validate Runtime primary-token DACL entry", fmt.Errorf("inherited or flagged ACE is forbidden"))
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
		mask := uint32(ace.Mask)
		switch ace.Header.AceType {
		case windows.ACCESS_DENIED_ACE_TYPE:
			if mask != windowsSensitiveTokenAccess {
				return principalFailure("validate Runtime primary-token DACL entry", fmt.Errorf("interactive deny ACE must contain the exact sensitive-token mask"))
			}
			switch sid {
			case windowsInteractiveLogonSID:
				deniedInteractive = true
			case windowsRemoteInteractiveLogonSID:
				deniedRemoteInteractive = true
			default:
				return principalFailure("validate Runtime primary-token DACL entry", fmt.Errorf("unexpected denied principal"))
			}
		case windows.ACCESS_ALLOWED_ACE_TYPE:
			switch sid {
			case profile.serviceSID:
				if mask != windows.TOKEN_ALL_ACCESS {
					return principalFailure("validate Runtime primary-token DACL entry", fmt.Errorf("service SID lacks exact full token authority"))
				}
				serviceAllowed = true
			case windowsInteractiveLogonSID:
				if mask != windowsRuntimeTokenVerificationAccess || mask&windowsSensitiveTokenAccess != 0 {
					return principalFailure("validate Runtime primary-token DACL entry", fmt.Errorf("interactive principal must receive only query and read-control authority"))
				}
				interactiveVerificationAllowed = true
			default:
				return principalFailure("validate Runtime primary-token DACL entry", fmt.Errorf("unexpected allowed principal"))
			}
		default:
			return principalFailure("validate Runtime primary-token DACL entry", fmt.Errorf("unsupported ACE type"))
		}
	}
	if !deniedInteractive || !deniedRemoteInteractive || !serviceAllowed || !interactiveVerificationAllowed {
		return principalFailure("validate Runtime primary-token DACL", fmt.Errorf("required service authority, interactive query, and interactive deny entries are absent"))
	}
	return nil
}

func buildWindowsRuntimeTokenACL(serviceSID, interactiveSID, remoteInteractiveSID *windows.SID) (*windows.ACL, error) {
	if serviceSID == nil || interactiveSID == nil || remoteInteractiveSID == nil {
		return nil, principalFailure("build Runtime primary-token DACL", fmt.Errorf("exact service and interactive SIDs are required"))
	}
	entries := []windows.EXPLICIT_ACCESS{
		{
			AccessPermissions: windowsSensitiveTokenAccess,
			AccessMode:        windows.DENY_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_GROUP,
				TrusteeValue: windows.TrusteeValueFromSID(interactiveSID),
			},
		},
		{
			AccessPermissions: windowsSensitiveTokenAccess,
			AccessMode:        windows.DENY_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_GROUP,
				TrusteeValue: windows.TrusteeValueFromSID(remoteInteractiveSID),
			},
		},
		{
			AccessPermissions: windows.TOKEN_ALL_ACCESS,
			AccessMode:        windows.SET_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_USER,
				TrusteeValue: windows.TrusteeValueFromSID(serviceSID),
			},
		},
		{
			AccessPermissions: windowsRuntimeTokenVerificationAccess,
			AccessMode:        windows.SET_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_WELL_KNOWN_GROUP,
				TrusteeValue: windows.TrusteeValueFromSID(interactiveSID),
			},
		},
	}
	acl, err := windows.ACLFromEntries(entries, nil)
	if err != nil {
		return nil, principalFailure("build Runtime primary-token DACL", err)
	}
	return acl, nil
}
