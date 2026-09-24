//go:build windows

package localservice

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

// volumeNameGUID is VOLUME_NAME_GUID. A file on a network share has no volume
// GUID path, although the share reports its server's file system name.
const volumeNameGUID = 0x1

// openAdmissionPayloadHold opens a payload for reading without write sharing.
// On a local NTFS volume that open fails while any handle can write the file or
// a writable mapping of it exists, even one whose handles are closed, and while
// it stays open every write open and writable mapping fails. A sharing
// conflict, a reparse point, or any other volume leaves the payload unheld.
func openAdmissionPayloadHold(path string) (*os.File, modelFileIdentity, bool, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, modelFileIdentity{}, false, err
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_SEQUENTIAL_SCAN, 0)
	if errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		return nil, modelFileIdentity{}, false, nil
	}
	if err != nil {
		return nil, modelFileIdentity{}, false, &os.PathError{Op: "open", Path: path, Err: err}
	}
	identity, ok := payloadHandleIdentity(handle)
	if !ok || !localNTFSHandle(handle) {
		_ = windows.CloseHandle(handle)
		return nil, modelFileIdentity{}, false, nil
	}
	return os.NewFile(uintptr(handle), path), identity, true, nil
}

// heldPayloadIdentity reads a retained hold's file identity; it fails once the
// hold is closed or its volume is gone.
func heldPayloadIdentity(file *os.File) (modelFileIdentity, bool) {
	raw, err := file.SyscallConn()
	if err != nil {
		return modelFileIdentity{}, false
	}
	var identity modelFileIdentity
	ok := false
	if err := raw.Control(func(fd uintptr) { identity, ok = payloadHandleIdentity(windows.Handle(fd)) }); err != nil {
		return modelFileIdentity{}, false
	}
	return identity, ok
}

// payloadHandleIdentity returns the identity modelFileIdentityOf reports for a
// plain file, and nothing for a directory or reparse point.
func payloadHandleIdentity(handle windows.Handle) (modelFileIdentity, bool) {
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil ||
		information.FileAttributes&(windows.FILE_ATTRIBUTE_DIRECTORY|windows.FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
		return modelFileIdentity{}, false
	}
	return modelFileIdentity{
		Volume: uint64(information.VolumeSerialNumber),
		Index:  uint64(information.FileIndexHigh)<<32 | uint64(information.FileIndexLow),
	}, true
}

// localNTFSHandle reports whether a handle's file lives on a local NTFS volume,
// where the hold's sharing and writable-mapping refusals were verified.
func localNTFSHandle(handle windows.Handle) bool {
	fileSystem := make([]uint16, windows.MAX_PATH+1)
	if err := windows.GetVolumeInformationByHandle(handle, nil, 0, nil, nil, nil, &fileSystem[0], uint32(len(fileSystem))); err != nil ||
		windows.UTF16ToString(fileSystem) != "NTFS" {
		return false
	}
	path := make([]uint16, windows.MAX_PATH+1)
	n, err := windows.GetFinalPathNameByHandle(handle, &path[0], uint32(len(path)), volumeNameGUID)
	return err == nil && n > 0
}

// openVerificationFile opens a payload for reading without blocking a
// concurrent Runtime delete or rename of the same file.
func openVerificationFile(path string) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: path, Err: err}
	}
	return os.NewFile(uintptr(handle), path), nil
}
