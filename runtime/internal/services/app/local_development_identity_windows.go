//go:build windows

package app

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func localDevelopmentCanonicalProjectFileID(projectRoot string) (string, error) {
	path, err := windows.UTF16PtrFromString(filepath.Clean(projectRoot))
	if err != nil {
		return "", errLocalDevelopmentProjectChanged
	}
	handle, err := windows.CreateFile(path, windows.FILE_READ_ATTRIBUTES,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return "", errLocalDevelopmentProjectChanged
	}
	defer windows.CloseHandle(handle)
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil || information.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 || information.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return "", errLocalDevelopmentProjectChanged
	}
	var identity [12]byte
	binary.LittleEndian.PutUint32(identity[0:4], information.VolumeSerialNumber)
	binary.LittleEndian.PutUint32(identity[4:8], information.FileIndexHigh)
	binary.LittleEndian.PutUint32(identity[8:12], information.FileIndexLow)
	digest := sha256.Sum256(append([]byte("nimi.windows-project-file-id.v1\x00"), identity[:]...))
	return "lacpf_v1_" + base64.RawURLEncoding.EncodeToString(digest[:]), nil
}
