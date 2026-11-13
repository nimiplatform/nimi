//go:build !windows

package runtimeinstance

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/unix"
)

func acquireLock(name string) (func() error, error) {
	// /tmp is machine-wide; os.TempDir may select a per-user directory on macOS.
	lockPath := filepath.Join("/tmp", name+".lock")
	file, err := os.OpenFile(lockPath, os.O_RDONLY|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, 0o644)
	if err == nil {
		err = file.Chmod(0o644) // Also readable by the service after a user creates it.
	} else if errors.Is(err, os.ErrExist) {
		file, err = os.OpenFile(lockPath, os.O_RDONLY|unix.O_NOFOLLOW, 0)
	}
	if err != nil {
		if file != nil {
			_ = file.Close()
		}
		return nil, fmt.Errorf("open Runtime instance lock: %w", err)
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		return nil, fmt.Errorf("Runtime instance lock must be a regular file: %s", lockPath)
	}
	if err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = file.Close()
		if errors.Is(err, unix.EWOULDBLOCK) {
			return nil, ErrAlreadyRunning
		}
		return nil, fmt.Errorf("acquire Runtime instance lock: %w", err)
	}
	// Never unlink: every process must lock the same inode. Close or process
	// termination releases the kernel lock, so stale PID recovery is unnecessary.
	return sync.OnceValue(file.Close), nil
}
