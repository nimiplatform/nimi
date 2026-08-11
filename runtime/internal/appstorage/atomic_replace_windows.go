//go:build windows

package appstorage

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

type localAppFileRenameInfo struct {
	flags          uint32
	rootDirectory  windows.Handle
	fileNameLength uint32
	fileName       [1]uint16
}

func replaceLocalAppJSONFile(source, target string) error {
	from, err := windows.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(
		from,
		windows.DELETE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseHandle(handle) }()

	to, err := windows.UTF16FromString(target)
	if err != nil {
		return err
	}
	fileNameLength := (len(to) - 1) * 2
	var layout localAppFileRenameInfo
	bufferSize := int(unsafe.Offsetof(layout.fileName)) + fileNameLength
	buffer := make([]byte, bufferSize)
	info := (*localAppFileRenameInfo)(unsafe.Pointer(&buffer[0]))
	info.flags = windows.FILE_RENAME_REPLACE_IF_EXISTS | windows.FILE_RENAME_POSIX_SEMANTICS
	info.fileNameLength = uint32(fileNameLength)
	copy(unsafe.Slice(&info.fileName[0], len(to)-1), to)
	return windows.SetFileInformationByHandle(handle, windows.FileRenameInfoEx, &buffer[0], uint32(bufferSize))
}
