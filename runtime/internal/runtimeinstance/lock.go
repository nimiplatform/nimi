package runtimeinstance

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const maxLockAcquireAttempts = 8

// LockPath resolves the singleton Runtime lease shared by normal Runtime
// startup and offline maintenance commands.
func LockPath() (string, error) {
	if override := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCK_PATH")); override != "" {
		return override, nil
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home for runtime lock: %w", err)
	}
	return filepath.Join(homeDir, ".nimi", "runtime", "runtime.lock"), nil
}

// AcquireLock atomically acquires the Runtime singleton lease. Maintenance
// callers use the same lease as daemon startup, so an offline mutation cannot
// race a live or concurrently starting Runtime.
func AcquireLock() (func() error, error) {
	lockPath, err := LockPath()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o700); err != nil {
		return nil, fmt.Errorf("create runtime lock directory: %w", err)
	}
	for attempts := 0; attempts < maxLockAcquireAttempts; attempts++ {
		lockFile, openErr := os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if openErr == nil {
			if _, err := lockFile.WriteString(strconv.Itoa(os.Getpid())); err != nil {
				_ = lockFile.Close()
				_ = os.Remove(lockPath)
				return nil, fmt.Errorf("write runtime instance lock: %w", err)
			}
			if err := lockFile.Sync(); err != nil {
				_ = lockFile.Close()
				_ = os.Remove(lockPath)
				return nil, fmt.Errorf("sync runtime instance lock: %w", err)
			}
			return func() error {
				closeErr := lockFile.Close()
				removeErr := os.Remove(lockPath)
				if errors.Is(removeErr, os.ErrNotExist) {
					removeErr = nil
				}
				return errors.Join(closeErr, removeErr)
			}, nil
		}
		if !errors.Is(openErr, os.ErrExist) {
			return nil, fmt.Errorf("acquire runtime instance lock: %w", openErr)
		}
		stale, staleErr := lockIsStale(lockPath)
		if staleErr != nil {
			return nil, staleErr
		}
		if !stale {
			return nil, fmt.Errorf("runtime instance lock already held: %s", lockPath)
		}
		if err := os.Remove(lockPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("remove stale runtime lock: %w", err)
		}
	}
	return nil, fmt.Errorf("acquire runtime instance lock: exceeded %d stale-lock recovery attempts", maxLockAcquireAttempts)
}

func lockIsStale(lockPath string) (bool, error) {
	content, err := os.ReadFile(lockPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("read runtime instance lock: %w", err)
	}
	pidText := strings.TrimSpace(string(content))
	if pidText == "" {
		return true, nil
	}
	pid, err := strconv.Atoi(pidText)
	if err != nil {
		return false, fmt.Errorf("parse runtime instance lock pid: %w", err)
	}
	return !processAlive(pid), nil
}
