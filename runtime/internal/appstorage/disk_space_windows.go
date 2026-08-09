//go:build windows

package appstorage

import (
	"math"

	"golang.org/x/sys/windows"
)

func availableDiskBytes(path string) (int64, error) {
	root, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	var available uint64
	if err := windows.GetDiskFreeSpaceEx(root, &available, nil, nil); err != nil || available > math.MaxInt64 {
		return 0, ErrAssetUnavailable
	}
	return int64(available), nil
}
