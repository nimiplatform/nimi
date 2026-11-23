//go:build !windows

package nimiapppackage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// OpenArchiveReadOnly opens a regular non-symlink archive file on POSIX hosts
// using O_NOFOLLOW (preventing Lstat-to-Open symlink swaps) and a non-blocking
// shared advisory lock.
func OpenArchiveReadOnly(rawPath string) (*os.File, int64, error) {
	cleanPath := filepath.Clean(strings.TrimSpace(rawPath))
	if rawPath == "" || cleanPath == "." || !filepath.IsAbs(cleanPath) {
		return nil, 0, fmt.Errorf("open nimiapp archive: %w", ErrInvalidPackage)
	}
	file, err := os.OpenFile(cleanPath, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		if errors.Is(err, syscall.ELOOP) {
			return nil, 0, fmt.Errorf("validate nimiapp archive symlink: %w", errors.Join(ErrInvalidPackage, err))
		}
		return nil, 0, fmt.Errorf("open nimiapp archive: %w", err)
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 0 {
		_ = file.Close()
		return nil, 0, fmt.Errorf("stat nimiapp archive: %w", errors.Join(ErrInvalidPackage, err))
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_SH|syscall.LOCK_NB); err != nil &&
		!errors.Is(err, syscall.ENOTSUP) && !errors.Is(err, syscall.EOPNOTSUPP) && !errors.Is(err, syscall.ENOSYS) {
		_ = file.Close()
		return nil, 0, fmt.Errorf("lock nimiapp archive: %w", errors.Join(ErrPackageIntegrity, err))
	}
	return file, info.Size(), nil
}

// SealArchiveReadOnly marks a Runtime-owned candidate archive copy read-only
// inside Runtime's private 0o700 staging directory on POSIX hosts.
func SealArchiveReadOnly(file *os.File) error {
	if file == nil {
		return ErrInvalidPackage
	}
	return file.Chmod(0o400)
}
