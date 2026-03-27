//go:build !windows

package localservice

import "syscall"

func diskFreeBytes(path string) int64 {
	var fs syscall.Statfs_t
	if err := syscall.Statfs(path, &fs); err != nil {
		return 0
	}
	return statfsAvailBytes(fs.Bavail, int64(fs.Bsize))
}

func statfsAvailBytes(blocks uint64, blockSize int64) int64 {
	if blockSize <= 0 {
		return 0
	}
	maxInt64 := int64(^uint64(0) >> 1)
	if blocks > uint64(maxInt64)/uint64(blockSize) {
		return 0
	}
	return int64(blocks) * blockSize
}
