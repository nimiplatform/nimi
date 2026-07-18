//go:build windows

package runtimeagent

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

const realmSourceMaterializationWindowsFileAllAccessV3 = 0x001f01ff

func ensureRealmSourceMaterializationPrivateDirectoryV3(path string) error {
	descriptor, _, err := realmSourceMaterializationWindowsSecurityDescriptorV3(true)
	if err != nil {
		return err
	}
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	attributes := realmSourceMaterializationWindowsSecurityAttributesV3(descriptor)
	err = windows.CreateDirectory(pointer, &attributes)
	if err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return err
	}
	return validateRealmSourceMaterializationPrivatePathV3(path, true)
}

func createRealmSourceMaterializationPrivateTempDirectoryV3(parent, prefix string) (string, error) {
	descriptor, _, err := realmSourceMaterializationWindowsSecurityDescriptorV3(true)
	if err != nil {
		return "", err
	}
	attributes := realmSourceMaterializationWindowsSecurityAttributesV3(descriptor)
	for attempts := 0; attempts < 128; attempts++ {
		guid, err := windows.GenerateGUID()
		if err != nil {
			return "", err
		}
		suffix := fmt.Sprintf("%08x%04x%04x%x", guid.Data1, guid.Data2, guid.Data3, guid.Data4)
		path := filepath.Join(parent, prefix+suffix)
		pointer, err := windows.UTF16PtrFromString(path)
		if err != nil {
			return "", err
		}
		if err := windows.CreateDirectory(pointer, &attributes); err != nil {
			if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
				continue
			}
			return "", err
		}
		if err := validateRealmSourceMaterializationPrivatePathV3(path, true); err != nil {
			_ = os.Remove(path)
			return "", err
		}
		return path, nil
	}
	return "", fmt.Errorf("create private Packet attempt: unique directory exhausted")
}

func openRealmSourceMaterializationPrivateFileV3(path string) (*os.File, error) {
	descriptor, _, err := realmSourceMaterializationWindowsSecurityDescriptorV3(false)
	if err != nil {
		return nil, err
	}
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	attributes := realmSourceMaterializationWindowsSecurityAttributesV3(descriptor)
	handle, err := windows.CreateFile(
		pointer,
		windows.GENERIC_READ|windows.GENERIC_WRITE|windows.READ_CONTROL,
		0,
		&attributes,
		windows.CREATE_NEW,
		windows.FILE_ATTRIBUTE_TEMPORARY|windows.FILE_ATTRIBUTE_NOT_CONTENT_INDEXED|windows.FILE_FLAG_OPEN_REPARSE_POINT,
		0,
	)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(handle), path)
	if file == nil {
		windows.CloseHandle(handle)
		return nil, fmt.Errorf("wrap private Packet staging handle")
	}
	if err := validateRealmSourceMaterializationPrivateHandleV3(handle, false); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return nil, err
	}
	return file, nil
}

func validateRealmSourceMaterializationPrivatePathV3(path string, directory bool) error {
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	flags := uint32(windows.FILE_FLAG_OPEN_REPARSE_POINT)
	if directory {
		flags |= windows.FILE_FLAG_BACKUP_SEMANTICS
	}
	handle, err := windows.CreateFile(
		pointer,
		windows.READ_CONTROL,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		flags,
		0,
	)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	return validateRealmSourceMaterializationPrivateHandleV3(handle, directory)
}

func validateRealmSourceMaterializationPrivateHandleV3(handle windows.Handle, directory bool) error {
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil {
		return err
	}
	isDirectory := information.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0
	if information.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || isDirectory != directory {
		return fmt.Errorf("private staging path has an invalid Windows filesystem identity")
	}
	descriptor, err := windows.GetSecurityInfo(
		handle,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return err
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return fmt.Errorf("private staging path requires a protected Windows DACL: %w", err)
	}
	_, principalSID, err := realmSourceMaterializationWindowsSecurityDescriptorV3(directory)
	if err != nil {
		return err
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil || !windows.EqualSid(owner, principalSID) {
		return fmt.Errorf("private staging path owner differs from the Runtime principal: %w", err)
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil || dacl.AceCount != 1 {
		return fmt.Errorf("private staging path requires an exact one-principal Windows DACL: %w", err)
	}
	var ace *windows.ACCESS_ALLOWED_ACE
	if err := windows.GetAce(dacl, 0, &ace); err != nil {
		return err
	}
	entrySID := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
	if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE ||
		ace.Header.AceFlags&windows.INHERITED_ACE != 0 ||
		!windows.EqualSid(entrySID, principalSID) {
		return fmt.Errorf("private staging DACL contains an unexpected principal or inherited ACE")
	}
	mask := uint32(ace.Mask)
	if mask != windows.GENERIC_ALL && mask != realmSourceMaterializationWindowsFileAllAccessV3 {
		return fmt.Errorf("private staging DACL does not grant full Runtime-principal access")
	}
	if directory {
		required := uint8(windows.OBJECT_INHERIT_ACE | windows.CONTAINER_INHERIT_ACE)
		if ace.Header.AceFlags != required {
			return fmt.Errorf("private staging directory DACL requires exact child inheritance")
		}
	} else if ace.Header.AceFlags != 0 {
		return fmt.Errorf("private staging file DACL contains unexpected flags")
	}
	return nil
}

func realmSourceMaterializationWindowsSecurityDescriptorV3(directory bool) (*windows.SECURITY_DESCRIPTOR, *windows.SID, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, nil, fmt.Errorf("resolve Runtime Windows principal: %w", err)
	}
	if user == nil || user.User.Sid == nil {
		return nil, nil, fmt.Errorf("resolve Runtime Windows principal: SID is absent")
	}
	sid := user.User.Sid
	inheritance := ""
	if directory {
		inheritance = "OICI"
	}
	descriptor, err := windows.SecurityDescriptorFromString(
		fmt.Sprintf("O:%sD:P(A;%s;FA;;;%s)", sid.String(), inheritance, sid.String()),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("build private staging Windows security descriptor: %w", err)
	}
	return descriptor, sid, nil
}

func realmSourceMaterializationWindowsSecurityAttributesV3(
	descriptor *windows.SECURITY_DESCRIPTOR,
) windows.SecurityAttributes {
	return windows.SecurityAttributes{
		Length:             uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		SecurityDescriptor: descriptor,
	}
}
