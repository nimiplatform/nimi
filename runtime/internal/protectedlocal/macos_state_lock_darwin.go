//go:build darwin && cgo

package protectedlocal

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/unix"
)

type macOSRuntimeStateLock struct {
	file      *os.File
	closeOnce sync.Once
	closeErr  error
}

func openExistingMacOSRuntimeStateLock(stateRoot string, principal macOSRuntimePrincipal, action string) (*macOSRuntimeStateLock, error) {
	return openMacOSRuntimeStateLock(stateRoot, principal, false, action)
}

func createMacOSRuntimeStateLock(stateRoot string, principal macOSRuntimePrincipal) (*macOSRuntimeStateLock, error) {
	return openMacOSRuntimeStateLock(stateRoot, principal, true, "repair_runtime_service")
}

func openMacOSRuntimeStateLock(stateRoot string, principal macOSRuntimePrincipal, create bool, action string) (*macOSRuntimeStateLock, error) {
	if stateRoot != MacOSRuntimeStateRoot || principal.uid == 0 || principal.gid == 0 {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, fmt.Errorf("open macOS Runtime state lock: fixed state authority is required"))
	}
	directoryFD, err := unix.Open(stateRoot, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, fmt.Errorf("open macOS Runtime state directory: %w", err))
	}
	defer func() { _ = unix.Close(directoryFD) }()
	if err := validateOpenMacOSStateDirectory(directoryFD, principal); err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, err)
	}

	flags := unix.O_RDWR | unix.O_CLOEXEC | unix.O_NOFOLLOW
	if create {
		flags |= unix.O_CREAT | unix.O_EXCL
	}
	lockFD, err := unix.Openat(directoryFD, MacOSRuntimeStateLockFilename, flags, 0o600)
	if err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, fmt.Errorf("open macOS Runtime state lock: %w", err))
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = unix.Flock(lockFD, unix.LOCK_UN)
			if create {
				var opened, linked unix.Stat_t
				if unix.Fstat(lockFD, &opened) == nil &&
					unix.Fstatat(directoryFD, MacOSRuntimeStateLockFilename, &linked, unix.AT_SYMLINK_NOFOLLOW) == nil &&
					opened.Mode&unix.S_IFMT == unix.S_IFREG && linked.Mode&unix.S_IFMT == unix.S_IFREG &&
					opened.Dev == linked.Dev && opened.Ino == linked.Ino {
					_ = unix.Unlinkat(directoryFD, MacOSRuntimeStateLockFilename, 0)
					_ = unix.Fsync(directoryFD)
				}
			}
			_ = unix.Close(lockFD)
		}
	}()
	if err := unix.Flock(lockFD, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, fmt.Errorf("acquire exclusive macOS Runtime state lock: %w", err))
	}
	if create {
		if err := unix.Fchown(lockFD, int(principal.uid), int(principal.gid)); err != nil {
			return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, fmt.Errorf("assign macOS Runtime state lock owner: %w", err))
		}
		if err := unix.Fchmod(lockFD, 0o600); err != nil {
			return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, fmt.Errorf("assign macOS Runtime state lock mode: %w", err))
		}
		if err := unix.Fsync(lockFD); err != nil {
			return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, fmt.Errorf("sync macOS Runtime state lock: %w", err))
		}
	}
	if err := validateOpenMacOSStateLock(directoryFD, lockFD, principal); err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, err)
	}
	if create {
		if err := unix.Fsync(directoryFD); err != nil {
			return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, fmt.Errorf("sync macOS Runtime state directory after lock creation: %w", err))
		}
	}
	file := os.NewFile(uintptr(lockFD), filepath.Join(stateRoot, MacOSRuntimeStateLockFilename))
	if file == nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, action, fmt.Errorf("adopt macOS Runtime state lock descriptor"))
	}
	accepted = true
	return &macOSRuntimeStateLock{file: file}, nil
}

func validateOpenMacOSStateDirectory(fd int, principal macOSRuntimePrincipal) error {
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		return fmt.Errorf("inspect open macOS Runtime state directory: %w", err)
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFDIR || stat.Uid != principal.uid || stat.Gid != principal.gid ||
		stat.Mode&0o777 != 0o700 || stat.Nlink < 2 {
		return fmt.Errorf("open macOS Runtime state directory owner, mode, kind, or link count mismatch")
	}
	return nil
}

func validateOpenMacOSStateLock(directoryFD, lockFD int, principal macOSRuntimePrincipal) error {
	var opened unix.Stat_t
	if err := unix.Fstat(lockFD, &opened); err != nil {
		return fmt.Errorf("inspect open macOS Runtime state lock: %w", err)
	}
	if opened.Mode&unix.S_IFMT != unix.S_IFREG || opened.Uid != principal.uid || opened.Gid != principal.gid ||
		opened.Mode&0o777 != 0o600 || opened.Nlink != 1 {
		return fmt.Errorf("macOS Runtime state lock owner, mode, kind, or link count mismatch")
	}
	var linked unix.Stat_t
	if err := unix.Fstatat(directoryFD, MacOSRuntimeStateLockFilename, &linked, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return fmt.Errorf("inspect linked macOS Runtime state lock: %w", err)
	}
	if linked.Mode&unix.S_IFMT != unix.S_IFREG || linked.Dev != opened.Dev || linked.Ino != opened.Ino {
		return fmt.Errorf("macOS Runtime state lock vnode was replaced")
	}
	return nil
}

func (lock *macOSRuntimeStateLock) Close() error {
	if lock == nil {
		return nil
	}
	lock.closeOnce.Do(func() {
		if lock.file == nil {
			return
		}
		fd := int(lock.file.Fd())
		lock.closeErr = errors.Join(unix.Flock(fd, unix.LOCK_UN), lock.file.Close())
		lock.file = nil
	})
	return lock.closeErr
}

func removeCreatedMacOSRuntimeStateLock(stateRoot string, lock *macOSRuntimeStateLock, principal macOSRuntimePrincipal) error {
	if stateRoot != MacOSRuntimeStateRoot || lock == nil || lock.file == nil {
		return fmt.Errorf("remove created macOS Runtime state lock: retained lock is required")
	}
	openedInfo, err := lock.file.Stat()
	if err != nil {
		return fmt.Errorf("inspect retained macOS Runtime state lock: %w", err)
	}
	linkedInfo, err := os.Lstat(filepath.Join(stateRoot, MacOSRuntimeStateLockFilename))
	if err != nil {
		return fmt.Errorf("inspect linked macOS Runtime state lock for removal: %w", err)
	}
	opened, openedOK := openedInfo.Sys().(*unix.Stat_t)
	linked, linkedOK := linkedInfo.Sys().(*unix.Stat_t)
	if !openedOK || !linkedOK || !openedInfo.Mode().IsRegular() || !linkedInfo.Mode().IsRegular() ||
		linkedInfo.Mode()&os.ModeSymlink != 0 || opened.Dev != linked.Dev || opened.Ino != linked.Ino ||
		opened.Uid != principal.uid || opened.Gid != principal.gid || opened.Mode&0o777 != 0o600 || opened.Nlink != 1 {
		return fmt.Errorf("refuse to remove replaced or unproven macOS Runtime state lock")
	}
	if err := os.Remove(filepath.Join(stateRoot, MacOSRuntimeStateLockFilename)); err != nil {
		return fmt.Errorf("remove created macOS Runtime state lock: %w", err)
	}
	return nil
}
