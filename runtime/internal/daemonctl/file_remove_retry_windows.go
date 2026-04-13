//go:build windows

package daemonctl

import (
	"errors"
	"os"
	"syscall"

	"golang.org/x/sys/windows"
)

func shouldRetryFileRemove(err error) bool {
	if err == nil || os.IsNotExist(err) {
		return false
	}
	var pathErr *os.PathError
	if !errors.As(err, &pathErr) {
		return false
	}
	errno, ok := pathErr.Err.(syscall.Errno)
	if !ok {
		return false
	}
	return errno == syscall.Errno(windows.ERROR_SHARING_VIOLATION) || errno == syscall.Errno(windows.ERROR_ACCESS_DENIED)
}
