//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

const macOSRuntimeMutableDirectoryName = "runtime"

func inspectMacOSProvisionInventory(ctx context.Context, stateRoot string, principal macOSRuntimePrincipal, secrets BinarySecretStore) (macOSProvisionInventory, error) {
	entries, err := os.ReadDir(stateRoot)
	if err != nil {
		return macOSProvisionInventory{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("inspect macOS Runtime state entries: %w", err))
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
		case LedgerFilename:
			if err := validateMacOSStateArtifact(path, principal, false); err != nil {
				return macOSProvisionInventory{}, err
			}
			inventory.ledger = true
		case LedgerFilename + "-wal":
			if err := validateMacOSStateArtifact(path, principal, false); err != nil {
				return macOSProvisionInventory{}, err
			}
			inventory.ledgerWAL = true
		case LedgerFilename + "-shm":
			if err := validateMacOSStateArtifact(path, principal, false); err != nil {
				return macOSProvisionInventory{}, err
			}
			inventory.ledgerSHM = true
		case macOSRuntimeMutableDirectoryName:
			if err := validateMacOSStateArtifact(path, principal, true); err != nil {
				return macOSProvisionInventory{}, err
			}
			inventory.runtimeDir = true
		default:
			return macOSProvisionInventory{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("macOS Runtime state contains an unrecognized entry"))
		}
	}
	inventory.recordKey, err = macOSProvisionSecretExists(ctx, secrets, macOSLedgerRecordMACKeyName)
	if err != nil {
		return macOSProvisionInventory{}, err
	}
	inventory.anchor, err = macOSProvisionSecretExists(ctx, secrets, macOSLedgerAnchorSecretName)
	if err != nil {
		return macOSProvisionInventory{}, err
	}
	return inventory, nil
}

func macOSProvisionSecretExists(ctx context.Context, secrets BinarySecretStore, name string) (bool, error) {
	value, err := secrets.Load(ctx, name)
	if errors.Is(err, ErrProtectedSecretNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	zeroBytes(value)
	return true, nil
}

func validateMacOSStateArtifact(path string, principal macOSRuntimePrincipal, directory bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("inspect macOS Runtime state artifact: %w", err))
	}
	stat, ok := info.Sys().(*unix.Stat_t)
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

func secureMacOSLedgerArtifacts(stateRoot string, principal macOSRuntimePrincipal, allowRootOwner bool) error {
	for index, name := range []string{LedgerFilename, LedgerFilename + "-wal", LedgerFilename + "-shm"} {
		path := filepath.Join(stateRoot, name)
		fd, err := unix.Open(path, unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
		if errors.Is(err, unix.ENOENT) && index > 0 {
			continue
		}
		if err != nil {
			return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("open macOS Runtime ledger artifact: %w", err))
		}
		secureErr := secureOpenMacOSLedgerArtifact(fd, path, principal, allowRootOwner)
		closeErr := unix.Close(fd)
		if secureErr != nil || closeErr != nil {
			return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", errors.Join(secureErr, closeErr))
		}
	}
	return syncMacOSProtectedStateDirectory(stateRoot)
}

func secureOpenMacOSLedgerArtifact(fd int, path string, principal macOSRuntimePrincipal, allowRootOwner bool) error {
	var opened unix.Stat_t
	if err := unix.Fstat(fd, &opened); err != nil {
		return fmt.Errorf("inspect open macOS Runtime ledger artifact: %w", err)
	}
	ownerAllowed := opened.Uid == principal.uid && opened.Gid == principal.gid
	if allowRootOwner {
		ownerAllowed = ownerAllowed || (opened.Uid == 0 && opened.Gid == 0)
	}
	if opened.Mode&unix.S_IFMT != unix.S_IFREG || opened.Nlink != 1 || !ownerAllowed {
		return fmt.Errorf("macOS Runtime ledger artifact owner, kind, or link count mismatch")
	}
	if err := unix.Fchown(fd, int(principal.uid), int(principal.gid)); err != nil {
		return fmt.Errorf("assign macOS Runtime ledger artifact owner: %w", err)
	}
	if err := unix.Fchmod(fd, 0o600); err != nil {
		return fmt.Errorf("assign macOS Runtime ledger artifact mode: %w", err)
	}
	if err := unix.Fsync(fd); err != nil {
		return fmt.Errorf("sync macOS Runtime ledger artifact: %w", err)
	}
	var linked unix.Stat_t
	if err := unix.Lstat(path, &linked); err != nil {
		return fmt.Errorf("inspect linked macOS Runtime ledger artifact: %w", err)
	}
	if linked.Mode&unix.S_IFMT != unix.S_IFREG || linked.Dev != opened.Dev || linked.Ino != opened.Ino ||
		linked.Uid != principal.uid || linked.Gid != principal.gid || linked.Mode&0o777 != 0o600 || linked.Nlink != 1 {
		return fmt.Errorf("macOS Runtime ledger artifact vnode was replaced or not secured")
	}
	return nil
}

func rollbackFreshMacOSProvision(stateRoot string, principal macOSRuntimePrincipal, stateLock *macOSRuntimeStateLock, secrets BinarySecretStore, createdLock bool) error {
	var failures []error
	for _, name := range []string{macOSLedgerAnchorSecretName, macOSLedgerRecordMACKeyName} {
		if err := secrets.Delete(context.Background(), name); err != nil && !errors.Is(err, ErrProtectedSecretNotFound) {
			failures = append(failures, err)
		}
	}
	for _, name := range []string{LedgerFilename + "-journal", LedgerFilename + "-shm", LedgerFilename + "-wal", LedgerFilename} {
		if err := removeFreshMacOSLedgerArtifact(filepath.Join(stateRoot, name), principal); err != nil {
			failures = append(failures, err)
		}
	}
	if createdLock {
		if err := removeCreatedMacOSRuntimeStateLock(stateRoot, stateLock, principal); err != nil {
			failures = append(failures, err)
		}
	}
	if err := syncMacOSProtectedStateDirectory(stateRoot); err != nil {
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}

func removeFreshMacOSLedgerArtifact(path string, principal macOSRuntimePrincipal) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect fresh macOS Runtime ledger rollback artifact: %w", err)
	}
	stat, ok := info.Sys().(*unix.Stat_t)
	ownerAllowed := ok && ((stat.Uid == 0 && stat.Gid == 0) || (stat.Uid == principal.uid && stat.Gid == principal.gid))
	if !ownerAllowed || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || stat.Nlink != 1 {
		return fmt.Errorf("refuse to remove unproven macOS Runtime ledger rollback artifact")
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("remove fresh macOS Runtime ledger rollback artifact: %w", err)
	}
	return nil
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
