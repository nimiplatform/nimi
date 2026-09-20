//go:build windows

package localservice

import (
	"os"

	"golang.org/x/sys/windows"
)

// modelFileIdentityOf returns the NTFS volume serial and file index of the
// file at path without following a reparse point, together with its Lstat
// information. Two paths with equal identities are one physical file.
func modelFileIdentityOf(path string) (modelFileIdentity, os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return modelFileIdentity{}, nil, err
	}
	handle, information, err := openWindowsModelAssetSourceHandle(path, windows.FILE_READ_ATTRIBUTES)
	if err != nil {
		return modelFileIdentity{}, nil, err
	}
	defer func() { _ = windows.CloseHandle(handle) }()
	return modelFileIdentity{
		Volume: uint64(information.VolumeSerialNumber),
		Index:  uint64(information.FileIndexHigh)<<32 | uint64(information.FileIndexLow),
	}, info, nil
}
