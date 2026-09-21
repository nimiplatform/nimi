//go:build !windows

package appstorage

import (
	"math"
	"syscall"
)

// AvailableDiskBytes reports physical free space to Runtime-owned storage admission.
func AvailableDiskBytes(path string) (int64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, err
	}
	if stat.Bsize <= 0 || uint64(stat.Bavail) > math.MaxInt64/uint64(stat.Bsize) {
		return 0, ErrAssetUnavailable
	}
	return int64(uint64(stat.Bavail) * uint64(stat.Bsize)), nil
}
