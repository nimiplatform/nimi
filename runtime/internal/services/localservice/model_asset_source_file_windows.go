//go:build windows

package localservice

import (
	"os"

	"golang.org/x/sys/windows"
)

type modelAssetSourceFileIdentity struct {
	valid        bool
	volumeSerial uint32
	fileIndex    uint64
}

func preflightModelAssetSourceFile(path string, _ os.FileInfo) (modelAssetSourceFileIdentity, error) {
	handle, information, err := openWindowsModelAssetSourceHandle(path, windows.FILE_READ_ATTRIBUTES)
	if err != nil {
		return modelAssetSourceFileIdentity{}, &modelAssetSourceSafetyError{Path: path, Reason: "open no-follow preflight handle", Cause: err}
	}
	defer func() { _ = windows.CloseHandle(handle) }()
	if err := validateWindowsModelAssetSourceHandle(path, information, nil); err != nil {
		return modelAssetSourceFileIdentity{}, err
	}
	return windowsModelAssetSourceFileIdentity(information), nil
}

func openVerifiedModelAssetSourceFile(path string, expected modelAssetSourceFileIdentity) (*os.File, error) {
	handle, information, err := openWindowsModelAssetSourceHandle(path, windows.GENERIC_READ)
	if err != nil {
		return nil, &modelAssetSourceSafetyError{Path: path, Reason: "open no-follow read handle", Cause: err}
	}
	if err := validateWindowsModelAssetSourceHandle(path, information, &expected); err != nil {
		_ = windows.CloseHandle(handle)
		return nil, err
	}
	file := os.NewFile(uintptr(handle), path)
	if file == nil {
		_ = windows.CloseHandle(handle)
		return nil, &modelAssetSourceSafetyError{Path: path, Reason: "wrap verified read handle", Cause: windows.ERROR_INVALID_HANDLE}
	}
	return file, nil
}

func openWindowsModelAssetSourceHandle(path string, access uint32) (windows.Handle, windows.ByHandleFileInformation, error) {
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return windows.InvalidHandle, windows.ByHandleFileInformation{}, err
	}
	handle, err := windows.CreateFile(
		pointer,
		access,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_SEQUENTIAL_SCAN,
		0,
	)
	if err != nil {
		return windows.InvalidHandle, windows.ByHandleFileInformation{}, err
	}
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil {
		_ = windows.CloseHandle(handle)
		return windows.InvalidHandle, windows.ByHandleFileInformation{}, err
	}
	return handle, information, nil
}

func validateWindowsModelAssetSourceHandle(path string, information windows.ByHandleFileInformation, expected *modelAssetSourceFileIdentity) error {
	if windowsModelAssetSourceHandleIsReparse(information) {
		return &modelAssetSourceSafetyError{Path: path, Reason: "opened handle is a reparse point"}
	}
	if information.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
		return &modelAssetSourceSafetyError{Path: path, Reason: "opened handle is not a regular file"}
	}
	if expected != nil && !windowsModelAssetSourceHandleMatchesIdentity(information, *expected) {
		return &modelAssetSourceSafetyError{Path: path, Reason: "opened handle identity differs from preflight identity"}
	}
	return nil
}

func windowsModelAssetSourceHandleIsReparse(information windows.ByHandleFileInformation) bool {
	return information.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0
}

func windowsModelAssetSourceHandleMatchesIdentity(information windows.ByHandleFileInformation, expected modelAssetSourceFileIdentity) bool {
	return expected.valid && windowsModelAssetSourceFileIdentity(information) == expected
}

func windowsModelAssetSourceFileIdentity(information windows.ByHandleFileInformation) modelAssetSourceFileIdentity {
	return modelAssetSourceFileIdentity{
		valid:        true,
		volumeSerial: information.VolumeSerialNumber,
		fileIndex:    uint64(information.FileIndexHigh)<<32 | uint64(information.FileIndexLow),
	}
}
