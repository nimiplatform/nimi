//go:build darwin

package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

type retainedFileLock struct {
	net.Listener
	file *os.File
}

func validateSourceSupervisorPrincipal() error {
	if os.Geteuid() == 0 || os.Getuid() != os.Geteuid() || os.Getgid() != os.Getegid() {
		return fmt.Errorf("macOS source Runtime supervisor requires one non-root current user")
	}
	return nil
}

func sourceRuntimeLockPath(lockPath string) (string, error) {
	if lockPath == "" {
		home, err := os.UserHomeDir()
		if err != nil || !filepath.IsAbs(home) {
			return "", fmt.Errorf("resolve current-user home: %w", err)
		}
		lockPath = filepath.Join(home, "Library", "Application Support", "Nimi", "RuntimeLocalDevelopment", "run", "source-runtime-supervisor.lock")
	}
	if !filepath.IsAbs(lockPath) || filepath.Clean(lockPath) != lockPath {
		return "", fmt.Errorf("source Runtime owner lock path must be exact and absolute")
	}
	return lockPath, nil
}

func acquireSourceRuntimeOwnerLock(lockPath string) (net.Listener, error) {
	lockPath, err := sourceRuntimeLockPath(lockPath)
	if err != nil {
		return nil, err
	}
	runRoot := filepath.Dir(lockPath)
	if err := os.MkdirAll(runRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create source Runtime lock directory: %w", err)
	}
	if err := os.Chmod(runRoot, 0o700); err != nil {
		return nil, fmt.Errorf("protect source Runtime lock directory: %w", err)
	}
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open source Runtime owner lock: %w", err)
	}
	if err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = file.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, errSourceRuntimeAlreadyOwned
		}
		return nil, fmt.Errorf("lock source Runtime owner: %w", err)
	}
	socketPath := filepath.Join(runRoot, "control.sock")
	// Only the holder of the file lock may replace a stale socket.
	if err := os.Remove(socketPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = file.Close()
		return nil, err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("listen for source Runtime stop: %w", err)
	}
	return &retainedFileLock{Listener: listener, file: file}, nil
}

func (lock *retainedFileLock) Close() error {
	if lock == nil || lock.file == nil {
		return nil
	}
	listenerErr := lock.Listener.Close()
	unlockErr := unix.Flock(int(lock.file.Fd()), unix.LOCK_UN)
	closeErr := lock.file.Close()
	return errors.Join(listenerErr, unlockErr, closeErr)
}

func dialSourceRuntimeOwner(ctx context.Context, lockPath string) (conn net.Conn, resultErr error) {
	lockPath, err := sourceRuntimeLockPath(lockPath)
	if err != nil {
		return nil, err
	}
	conn, err = (&net.Dialer{}).DialContext(ctx, "unix", filepath.Join(filepath.Dir(lockPath), "control.sock"))
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, syscall.ECONNREFUSED) {
		// The lock can precede the socket during startup. An unavailable
		// control endpoint must not redirect stop to the installed service.
		file, openErr := os.OpenFile(lockPath, os.O_RDWR, 0)
		if errors.Is(openErr, os.ErrNotExist) {
			return nil, errSourceRuntimeNotRunning
		}
		if openErr != nil {
			return nil, openErr
		}
		defer func() {
			if closeErr := file.Close(); closeErr != nil {
				// A failed probe cleanup is not a definitive absence result.
				// Preserve the original connection failure without authorizing
				// the exit-3 fallback to an unrelated installed service.
				if resultErr == errSourceRuntimeNotRunning {
					resultErr = fmt.Errorf("source Runtime owner control is unavailable: %w", err)
				}
				resultErr = errors.Join(resultErr, fmt.Errorf("close source Runtime owner probe: %w", closeErr))
			}
		}()
		if lockErr := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); lockErr != nil {
			return nil, fmt.Errorf("source Runtime owner control is unavailable: %w", err)
		}
		return nil, errSourceRuntimeNotRunning
	}
	return conn, err
}

func requestRuntimeStop(process *os.Process) error {
	return process.Signal(syscall.SIGTERM)
}

func configureRuntimeCommand(_ *exec.Cmd) {}
