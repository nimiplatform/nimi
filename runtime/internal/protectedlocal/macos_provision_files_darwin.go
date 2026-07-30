//go:build darwin && cgo

package protectedlocal

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

const macOSRuntimeMutableDirectoryName = "runtime"

func inspectMacOSProvisionInventory(stateRoot string, principal macOSRuntimePrincipal) (macOSProvisionInventory, error) {
	entries, err := os.ReadDir(stateRoot)
	if err != nil {
		return macOSProvisionInventory{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("inspect macOS Runtime state: %w", err))
	}
	var inventory macOSProvisionInventory
	for _, entry := range entries {
		path := filepath.Join(stateRoot, entry.Name())
		switch entry.Name() {
		case MacOSRuntimeStateLockFilename:
			if err := validateMacOSStateArtifact(path, principal, false); err != nil {
				return macOSProvisionInventory{}, err
			}
			inventory.stateLock = true
		case macOSRuntimeMutableDirectoryName:
			if err := validateMacOSStateArtifact(path, principal, true); err != nil {
				return macOSProvisionInventory{}, err
			}
			inventory.mutableState = true
		default:
			// The verified service principal owns the complete 0700 state root.
			// Runtime services may add product state here without turning the
			// installer into a second schema or inventory authority.
			inventory.mutableState = true
		}
	}
	return inventory, nil
}

func removeMacOSRuntimeMutableState(stateRoot string, stateLock *macOSRuntimeStateLock) error {
	if stateRoot != MacOSRuntimeStateRoot || stateLock == nil || stateLock.file == nil {
		return fmt.Errorf("remove macOS Runtime mutable state: retained fixed state lock is required")
	}
	return removeMacOSRuntimeMutableStateEntries(stateRoot, stateLock)
}

func removeMacOSRuntimeMutableStateEntries(stateRoot string, stateLock *macOSRuntimeStateLock) error {
	if stateLock == nil || stateLock.file == nil {
		return fmt.Errorf("remove macOS Runtime mutable state entries: retained state lock is required")
	}
	entries, err := os.ReadDir(stateRoot)
	if err != nil {
		return fmt.Errorf("inspect macOS Runtime mutable state for removal: %w", err)
	}
	for _, entry := range entries {
		if entry.Name() == MacOSRuntimeStateLockFilename {
			continue
		}
		if err := os.RemoveAll(filepath.Join(stateRoot, entry.Name())); err != nil {
			return fmt.Errorf("remove macOS Runtime mutable state entry %q: %w", entry.Name(), err)
		}
	}
	return syncMacOSProtectedStateDirectory(stateRoot)
}

func validateMacOSStateArtifact(path string, principal macOSRuntimePrincipal, directory bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("inspect macOS Runtime state artifact: %w", err))
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.Mode()&os.ModeSymlink != 0 || stat.Uid != principal.uid || stat.Gid != principal.gid {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("macOS Runtime state artifact owner or kind mismatch"))
	}
	if directory {
		if !info.IsDir() || info.Mode().Perm() != 0o700 || stat.Nlink < 2 {
			return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("macOS Runtime mutable directory mode, kind, or link count mismatch"))
		}
		return nil
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 || stat.Nlink != 1 {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("macOS Runtime state file mode, kind, or link count mismatch"))
	}
	return nil
}

func rollbackFreshMacOSProvision(stateRoot string, principal macOSRuntimePrincipal, stateLock *macOSRuntimeStateLock, createdLock bool) error {
	if !createdLock {
		return nil
	}
	if err := removeCreatedMacOSRuntimeStateLock(stateRoot, stateLock, principal); err != nil {
		return err
	}
	return syncMacOSProtectedStateDirectory(stateRoot)
}

func syncMacOSProtectedStateDirectory(path string) error {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return fmt.Errorf("open macOS Runtime state directory for sync: %w", err)
	}
	defer func() { _ = unix.Close(fd) }()
	if err := unix.Fsync(fd); err != nil {
		return fmt.Errorf("sync macOS Runtime state directory: %w", err)
	}
	return nil
}
