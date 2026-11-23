//go:build windows

package nimiapppackage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// OpenArchiveReadOnly opens a regular archive file on Windows using a handle
// that permits concurrent read sharing while denying concurrent write and
// delete sharing, preventing post-hash mutation on shared-ACL roots.
func OpenArchiveReadOnly(rawPath string) (*os.File, int64, error) {
	cleanPath := filepath.Clean(strings.TrimSpace(rawPath))
	if rawPath == "" || cleanPath == "." || !filepath.IsAbs(cleanPath) {
		return nil, 0, fmt.Errorf("open nimiapp archive: %w", ErrInvalidPackage)
	}
	winPath := toWindowsExtendedPath(cleanPath)
	pathPtr, err := windows.UTF16PtrFromString(winPath)
	if err != nil {
		return nil, 0, fmt.Errorf("encode nimiapp archive path: %w", errors.Join(ErrInvalidPackage, err))
	}
	handle, err := windows.CreateFile(
		pathPtr,
		windows.GENERIC_READ|windows.FILE_READ_ATTRIBUTES,
		windows.FILE_SHARE_READ,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_SEQUENTIAL_SCAN,
		0,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("open nimiapp archive: %w", err)
	}
	file := os.NewFile(uintptr(handle), cleanPath)
	if file == nil {
		_ = windows.CloseHandle(handle)
		return nil, 0, fmt.Errorf("wrap nimiapp archive handle: %w", ErrInvalidPackage)
	}
	var fileInfo windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &fileInfo); err != nil ||
		fileInfo.FileAttributes&(windows.FILE_ATTRIBUTE_DIRECTORY|windows.FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
		_ = file.Close()
		return nil, 0, fmt.Errorf("validate nimiapp archive file: %w", errors.Join(ErrInvalidPackage, err))
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 0 {
		_ = file.Close()
		return nil, 0, fmt.Errorf("stat nimiapp archive: %w", errors.Join(ErrInvalidPackage, err))
	}
	return file, info.Size(), nil
}

// SealArchiveReadOnly is a no-op on Windows, where FILE_SHARE_READ prevents
// concurrent writes without setting FILE_ATTRIBUTE_READONLY (which would block
// directory cleanup on discard or recovery).
func SealArchiveReadOnly(file *os.File) error {
	if file == nil {
		return ErrInvalidPackage
	}
	return nil
}

func toWindowsExtendedPath(cleanPath string) string {
	if strings.HasPrefix(cleanPath, `\\?\`) || strings.HasPrefix(cleanPath, `\\.\`) {
		return cleanPath
	}
	if len(cleanPath) < 248 {
		return cleanPath
	}
	if strings.HasPrefix(cleanPath, `\\`) {
		return `\\?\UNC\` + strings.TrimPrefix(cleanPath, `\\`)
	}
	return `\\?\` + cleanPath
}
