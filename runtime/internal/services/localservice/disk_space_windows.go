//go:build windows

package localservice

import "golang.org/x/sys/windows"

func diskFreeBytes(path string) int64 {
	if path == "" {
		return 0
	}
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0
	}
	var available uint64
	if err := windows.GetDiskFreeSpaceEx(pointer, &available, nil, nil); err != nil {
		return 0
	}
	if available > uint64(^uint64(0)>>1) {
		return 0
	}
	return int64(available)
}
