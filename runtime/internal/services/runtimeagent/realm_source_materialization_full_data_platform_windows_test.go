//go:build realm_v3_full_data && windows

package runtimeagent

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func validateRealmV3FullDataPrivatePathPlatformV1(target string, _ os.FileInfo, directory bool) error {
	pointer, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	flags := uint32(windows.FILE_FLAG_OPEN_REPARSE_POINT)
	if directory {
		flags |= windows.FILE_FLAG_BACKUP_SEMANTICS
	}
	handle, err := windows.CreateFile(
		pointer,
		windows.FILE_READ_ATTRIBUTES|windows.READ_CONTROL,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		flags,
		0,
	)
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseHandle(handle) }()
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil {
		return err
	}
	isDirectory := information.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0
	if information.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || isDirectory != directory {
		return fmt.Errorf("private path has an invalid Windows filesystem identity")
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return fmt.Errorf("resolve current Windows worker principal: %w", err)
	}
	descriptor, err := windows.GetSecurityInfo(
		handle,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION,
	)
	if err != nil {
		return err
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil || !windows.EqualSid(owner, user.User.Sid) {
		return fmt.Errorf("path is not owned by the current Windows worker principal: %w", err)
	}
	return nil
}

func syncRealmV3FullDataDirectoryPlatformV1(_ *os.File) error {
	// Windows does not expose POSIX directory fsync. Every file is flushed
	// before rename and the stable lock handle remains open for its lifetime.
	return nil
}

func lockRealmV3FullDataFilePlatformV1(file *os.File) error {
	var overlapped windows.Overlapped
	return windows.LockFileEx(
		windows.Handle(file.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0,
		^uint32(0),
		^uint32(0),
		&overlapped,
	)
}

func unlockRealmV3FullDataFilePlatformV1(file *os.File) error {
	var overlapped windows.Overlapped
	return windows.UnlockFileEx(
		windows.Handle(file.Fd()),
		0,
		^uint32(0),
		^uint32(0),
		&overlapped,
	)
}

func realmV3FullDataFileIdentityPlatformV1(file *os.File) (string, error) {
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &information); err != nil {
		return "", err
	}
	index := uint64(information.FileIndexHigh)<<32 | uint64(information.FileIndexLow)
	return fmt.Sprintf("%08x:%016x", information.VolumeSerialNumber, index), nil
}
