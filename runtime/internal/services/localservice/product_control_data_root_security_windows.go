//go:build windows

package localservice

import (
	"fmt"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const windowsProductControlFileModifyAccess = windows.FILE_GENERIC_READ |
	windows.FILE_GENERIC_WRITE |
	windows.FILE_GENERIC_EXECUTE |
	windows.DELETE
const windowsProductControlBroadMutationAccess = windows.FILE_WRITE_DATA |
	windows.FILE_APPEND_DATA |
	windows.FILE_WRITE_EA |
	windows.FILE_WRITE_ATTRIBUTES |
	0x00000040 | // FILE_DELETE_CHILD
	windows.DELETE |
	windows.WRITE_DAC |
	windows.WRITE_OWNER |
	windows.GENERIC_WRITE |
	windows.GENERIC_ALL

func validateProductControlRootPlatform(root string, security ProductControlDataRootSecurityBinding) error {
	if !security.PerUserRuntime {
		return nil
	}
	interactiveUserSID := strings.TrimSpace(security.InteractiveUserSID)
	if interactiveUserSID == "" || !strings.EqualFold(interactiveUserSID, strings.TrimSpace(security.RuntimeServiceSID)) {
		return fmt.Errorf("per-user Product Control requires one current-user SID")
	}
	if err := validateWindowsDirectDirectoryChain(root); err != nil {
		return err
	}
	return validateWindowsPerUserDirectoryACL(root, interactiveUserSID)
}

// validateProductControlDataRootPlatform rejects reparse traversal before a
// Product Control-selected path is admitted as Runtime data storage. When the
// protected principal binding is present, it also verifies the interactive
// user owner and the one exact inheritable fixed-service ACE prepared by the
// native Desktop host.
func validateProductControlDataRootPlatform(root string, security ProductControlDataRootSecurityBinding) error {
	volumeRoot := filepath.VolumeName(root) + string(filepath.Separator)
	if volumeRoot == string(filepath.Separator) || !strings.HasPrefix(root, volumeRoot) {
		return fmt.Errorf("data root volume is invalid")
	}
	components := []string{volumeRoot}
	current := volumeRoot
	for _, component := range strings.Split(strings.TrimPrefix(root, volumeRoot), string(filepath.Separator)) {
		if component == "" {
			continue
		}
		current = filepath.Join(current, component)
		components = append(components, current)
	}
	for _, component := range components {
		encoded, err := windows.UTF16PtrFromString(component)
		if err != nil {
			return err
		}
		attributes, err := windows.GetFileAttributes(encoded)
		if err != nil {
			return err
		}
		if attributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 ||
			attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return fmt.Errorf("data root component is not a direct directory")
		}
	}
	interactiveUserSID := strings.TrimSpace(security.InteractiveUserSID)
	runtimeServiceSID := strings.TrimSpace(security.RuntimeServiceSID)
	if security.PerUserRuntime {
		if interactiveUserSID == "" || !strings.EqualFold(interactiveUserSID, runtimeServiceSID) {
			return fmt.Errorf("per-user data root requires one current-user SID")
		}
		return validateWindowsPerUserDirectoryACL(root, interactiveUserSID)
	}
	if interactiveUserSID == "" && runtimeServiceSID == "" {
		return nil
	}
	if interactiveUserSID == "" || runtimeServiceSID == "" {
		return fmt.Errorf("data root security validation requires both interactive-user and Runtime service SIDs")
	}
	return validateWindowsProductControlDataRootACL(root, interactiveUserSID, runtimeServiceSID)
}

func validateWindowsProductControlDataRootACL(root string, interactiveUserSID string, runtimeServiceSID string) error {
	expectedOwner, err := windows.StringToSid(interactiveUserSID)
	if err != nil {
		return fmt.Errorf("parse verified interactive-user SID: %w", err)
	}
	expectedService, err := windows.StringToSid(runtimeServiceSID)
	if err != nil {
		return fmt.Errorf("parse verified Runtime service SID: %w", err)
	}
	descriptor, err := windows.GetNamedSecurityInfo(
		root,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return fmt.Errorf("read data root owner and ACL: %w", err)
	}
	if descriptor == nil {
		return fmt.Errorf("read data root owner and ACL: security descriptor is unavailable")
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil || !windows.EqualSid(owner, expectedOwner) {
		return fmt.Errorf("data root owner does not match the verified interactive user")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return fmt.Errorf("read data root DACL: %w", err)
	}
	if dacl == nil {
		return fmt.Errorf("read data root DACL: DACL is unavailable")
	}
	expectedFlags := uint8(windows.OBJECT_INHERIT_ACE | windows.CONTAINER_INHERIT_ACE)
	matchingServiceEntries := 0
	exactServiceEntry := false
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil || ace == nil {
			return fmt.Errorf("read data root DACL entry %d: %w", index, err)
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE &&
			ace.Header.AceType != windows.ACCESS_DENIED_ACE_TYPE {
			continue
		}
		entrySID := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if ace.Header.AceType == windows.ACCESS_ALLOWED_ACE_TYPE &&
			isWindowsProductControlBroadPrincipal(entrySID) &&
			uint32(ace.Mask)&windowsProductControlBroadMutationAccess != 0 {
			return fmt.Errorf("data root DACL grants write authority to a broad principal")
		}
		if !windows.EqualSid(entrySID, expectedService) {
			continue
		}
		matchingServiceEntries++
		if ace.Header.AceType == windows.ACCESS_ALLOWED_ACE_TYPE &&
			ace.Header.AceFlags == expectedFlags &&
			uint32(ace.Mask) == windowsProductControlFileModifyAccess {
			exactServiceEntry = true
		}
	}
	if matchingServiceEntries != 1 || !exactServiceEntry {
		return fmt.Errorf("data root DACL lacks the one exact inheritable fixed Runtime service SID entry")
	}
	return nil
}

func validateWindowsDirectDirectoryChain(root string) error {
	volumeRoot := filepath.VolumeName(root) + string(filepath.Separator)
	if volumeRoot == string(filepath.Separator) || !strings.HasPrefix(root, volumeRoot) {
		return fmt.Errorf("directory volume is invalid")
	}
	current := volumeRoot
	for _, component := range strings.Split(strings.TrimPrefix(root, volumeRoot), string(filepath.Separator)) {
		if component != "" {
			current = filepath.Join(current, component)
		}
		encoded, err := windows.UTF16PtrFromString(current)
		if err != nil {
			return err
		}
		attributes, err := windows.GetFileAttributes(encoded)
		if err != nil || attributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 || attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return fmt.Errorf("directory component is not direct")
		}
	}
	return nil
}

func validateWindowsPerUserDirectoryACL(root string, currentUserSID string) error {
	expectedOwner, err := windows.StringToSid(currentUserSID)
	if err != nil {
		return fmt.Errorf("parse current-user SID: %w", err)
	}
	descriptor, err := windows.GetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil || descriptor == nil {
		return fmt.Errorf("read per-user directory security: %w", err)
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil || !windows.EqualSid(owner, expectedOwner) {
		return fmt.Errorf("per-user directory owner mismatch")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		return fmt.Errorf("read per-user directory DACL: %w", err)
	}
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil || ace == nil {
			return fmt.Errorf("read per-user directory DACL entry %d: %w", index, err)
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			continue
		}
		entrySID := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if isWindowsProductControlBroadPrincipal(entrySID) && uint32(ace.Mask)&windowsProductControlBroadMutationAccess != 0 {
			return fmt.Errorf("per-user directory grants write authority to a broad principal")
		}
	}
	return nil
}

func isWindowsProductControlBroadPrincipal(sid *windows.SID) bool {
	switch sid.String() {
	case "S-1-1-0", // Everyone
		"S-1-5-11",     // Authenticated Users
		"S-1-5-32-545": // BUILTIN\Users
		return true
	default:
		return false
	}
}
