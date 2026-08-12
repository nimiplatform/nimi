//go:build darwin

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

type retainedFileLock struct {
	file *os.File
}

func validateSourceSupervisorPrincipal() error {
	if os.Geteuid() == 0 || os.Getuid() != os.Geteuid() || os.Getgid() != os.Getegid() {
		return fmt.Errorf("macOS source Runtime supervisor requires one non-root current user")
	}
	return nil
}

func acquireSourceRuntimeOwnerLock() (io.Closer, error) {
	home, err := os.UserHomeDir()
	if err != nil || !filepath.IsAbs(home) {
		return nil, fmt.Errorf("resolve current-user home: %w", err)
	}
	runRoot := filepath.Join(home, "Library", "Application Support", "Nimi", "RuntimeLocalDevelopment", "run")
	if err := os.MkdirAll(runRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create source Runtime lock directory: %w", err)
	}
	if err := os.Chmod(runRoot, 0o700); err != nil {
		return nil, fmt.Errorf("protect source Runtime lock directory: %w", err)
	}
	file, err := os.OpenFile(filepath.Join(runRoot, "source-runtime-supervisor.lock"), os.O_CREATE|os.O_RDWR, 0o600)
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
	return &retainedFileLock{file: file}, nil
}

func (lock *retainedFileLock) Close() error {
	if lock == nil || lock.file == nil {
		return nil
	}
	unlockErr := unix.Flock(int(lock.file.Fd()), unix.LOCK_UN)
	closeErr := lock.file.Close()
	return errors.Join(unlockErr, closeErr)
}

func requestRuntimeStop(process *os.Process) error {
	return process.Signal(syscall.SIGTERM)
}

func configureRuntimeCommand(_ *exec.Cmd) {}
