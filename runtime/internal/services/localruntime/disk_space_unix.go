//go:build !windows

package localruntime

import "syscall"

func diskFreeBytes(path string) int64 {
	var fs syscall.Statfs_t
	if err := syscall.Statfs(path, &fs); err != nil {
		return 0
	}
	return int64(fs.Bavail) * int64(fs.Bsize)
}
