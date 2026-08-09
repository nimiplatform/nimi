//go:build !windows

package appstorage

import (
	"math"
	"syscall"
)

func availableDiskBytes(path string) (int64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, err
	}
	if stat.Bsize <= 0 || uint64(stat.Bavail) > math.MaxInt64/uint64(stat.Bsize) {
		return 0, ErrAssetUnavailable
	}
	return int64(uint64(stat.Bavail) * uint64(stat.Bsize)), nil
}
