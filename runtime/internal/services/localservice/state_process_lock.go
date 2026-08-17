package localservice

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type localStateProcessLock struct {
	file *os.File
	once sync.Once
}

func acquireLocalStateProcessLock(statePath string) (*localStateProcessLock, error) {
	statePath = strings.TrimSpace(statePath)
	if statePath == "" {
		return nil, fmt.Errorf("Runtime local state path is required for exclusive access")
	}
	lockPath := filepath.Clean(statePath) + ".owner.lock"
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o700); err != nil {
		return nil, fmt.Errorf("prepare Runtime local state lock: %w", err)
	}
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open Runtime local state lock: %w", err)
	}
	locked, err := tryLockLocalStateFile(file)
	if err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("lock Runtime local state: %w", err)
	}
	if !locked {
		_ = file.Close()
		return nil, fmt.Errorf("Runtime local state is in use; stop runtime first")
	}
	return &localStateProcessLock{file: file}, nil
}

func (lock *localStateProcessLock) release() {
	if lock == nil {
		return
	}
	lock.once.Do(func() {
		if lock.file == nil {
			return
		}
		_ = unlockLocalStateFile(lock.file)
		_ = lock.file.Close()
	})
}
