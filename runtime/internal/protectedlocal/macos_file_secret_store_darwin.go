//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/unix"
)

const macOSRuntimeSecretDirectoryName = "secrets"

type macOSFileSecretStore struct {
	principal macOSRuntimePrincipal

	mu          sync.Mutex
	directoryFD int
	closed      bool
	closeOnce   sync.Once
	closeErr    error
}

// @nimi-authority: rule.nimi.runtime.protected-session.r003
// Production callers first validate the signed daemon and its isolated service
// principal. The same file primitive also serves D2 under its separate principal.
func openMacOSRuntimeBinarySecretStore(stateRoot string, principal macOSRuntimePrincipal) (macOSRuntimeBinarySecretStore, error) {
	if stateRoot != MacOSRuntimeStateRoot || principal.uid == 0 || principal.gid == 0 {
		return nil, fail(
			ReasonProtectedLocalCustodyBoundaryUnavailable,
			false,
			"repair_runtime_service",
			fmt.Errorf("open macOS Runtime secret custody: fixed state authority is required"),
		)
	}
	return openMacOSFileSecretStore(stateRoot, principal)
}

func openMacOSFileSecretStore(stateRoot string, principal macOSRuntimePrincipal) (*macOSFileSecretStore, error) {
	cleaned := filepath.Clean(stateRoot)
	if cleaned == "." || !filepath.IsAbs(cleaned) || principal.uid == 0 || principal.gid == 0 {
		return nil, macOSFileSecretStoreFailure("open", fmt.Errorf("absolute service-owned state root is required"))
	}
	stateDirectoryFD, err := unix.Open(cleaned, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, macOSFileSecretStoreFailure("open state root", err)
	}
	defer func() { _ = unix.Close(stateDirectoryFD) }()
	if err := validateOpenMacOSStateDirectory(stateDirectoryFD, principal); err != nil {
		return nil, macOSFileSecretStoreFailure("validate state root", err)
	}

	created := false
	if err := unix.Mkdirat(stateDirectoryFD, macOSRuntimeSecretDirectoryName, 0o700); err != nil {
		if !errors.Is(err, unix.EEXIST) {
			return nil, macOSFileSecretStoreFailure("create secret directory", err)
		}
	} else {
		created = true
	}
	secretDirectoryFD, err := unix.Openat(
		stateDirectoryFD,
		macOSRuntimeSecretDirectoryName,
		unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW,
		0,
	)
	if err != nil {
		return nil, macOSFileSecretStoreFailure("open secret directory", err)
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = unix.Close(secretDirectoryFD)
		}
	}()
	if err := validateOpenMacOSSecretDirectory(secretDirectoryFD, principal); err != nil {
		return nil, macOSFileSecretStoreFailure("validate secret directory", err)
	}
	if err := removeStaleMacOSFileSecretTemps(secretDirectoryFD, principal); err != nil {
		return nil, err
	}
	if created {
		if err := unix.Fsync(stateDirectoryFD); err != nil {
			return nil, macOSFileSecretStoreFailure("sync state root", err)
		}
	}
	accepted = true
	return &macOSFileSecretStore{
		principal:   principal,
		directoryFD: secretDirectoryFD,
	}, nil
}

func validateOpenMacOSSecretDirectory(fd int, principal macOSRuntimePrincipal) error {
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		return fmt.Errorf("inspect open secret directory: %w", err)
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFDIR || stat.Uid != principal.uid || stat.Gid != principal.gid ||
		stat.Mode&0o777 != 0o700 || stat.Nlink < 2 {
		return fmt.Errorf("secret directory owner, mode, kind, or link count mismatch")
	}
	return nil
}

func removeStaleMacOSFileSecretTemps(directoryFD int, principal macOSRuntimePrincipal) error {
	readFD, err := unix.Dup(directoryFD)
	if err != nil {
		return macOSFileSecretStoreFailure("inspect temporary secrets", err)
	}
	unix.CloseOnExec(readFD)
	directory := os.NewFile(uintptr(readFD), macOSRuntimeSecretDirectoryName)
	if directory == nil {
		_ = unix.Close(readFD)
		return macOSFileSecretStoreFailure("inspect temporary secrets", fmt.Errorf("adopt directory descriptor"))
	}
	entries, err := directory.ReadDir(-1)
	closeErr := directory.Close()
	if err != nil {
		return macOSFileSecretStoreFailure("inspect temporary secrets", err)
	}
	if closeErr != nil {
		return macOSFileSecretStoreFailure("close temporary-secret inspection", closeErr)
	}
	removed := false
	for _, entry := range entries {
		name := entry.Name()
		if !isMacOSFileSecretTempName(name) {
			continue
		}
		file, _, err := openMacOSFileSecretFile(directoryFD, name, principal, unix.O_RDONLY)
		if err != nil {
			return macOSFileSecretStoreFailure("validate temporary secret", err)
		}
		if err := file.Close(); err != nil {
			return macOSFileSecretStoreFailure("close temporary secret", err)
		}
		if err := unix.Unlinkat(directoryFD, name, 0); err != nil {
			return macOSFileSecretStoreFailure("remove temporary secret", err)
		}
		removed = true
	}
	if removed {
		if err := unix.Fsync(directoryFD); err != nil {
			return macOSFileSecretStoreFailure("sync temporary-secret cleanup", err)
		}
	}
	return nil
}

func isMacOSFileSecretTempName(name string) bool {
	const prefix = ".secret-"
	const suffix = ".tmp"
	if len(name) != len(prefix)+32+len(suffix) || name[:len(prefix)] != prefix ||
		name[len(name)-len(suffix):] != suffix {
		return false
	}
	_, err := hex.DecodeString(name[len(prefix) : len(name)-len(suffix)])
	return err == nil
}

func (store *macOSFileSecretStore) withDirectory(
	operation string,
	fn func(int, macOSRuntimePrincipal) error,
) error {
	if store == nil {
		return macOSFileSecretStoreFailure(operation, fmt.Errorf("secret store is required"))
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed || store.directoryFD < 0 {
		return macOSFileSecretStoreFailure(operation, fmt.Errorf("secret store is closed"))
	}
	return fn(store.directoryFD, store.principal)
}

func (store *macOSFileSecretStore) Load(ctx context.Context, name string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validateMacOSRuntimeSecretName(name); err != nil {
		return nil, err
	}
	var value []byte
	err := store.withDirectory("load", func(directoryFD int, principal macOSRuntimePrincipal) error {
		file, stat, err := openMacOSFileSecretFile(directoryFD, name, principal, unix.O_RDONLY)
		if errors.Is(err, unix.ENOENT) {
			return ErrProtectedSecretNotFound
		}
		if err != nil {
			return macOSFileSecretStoreFailure("load", err)
		}
		defer func() { _ = file.Close() }()
		loaded, err := io.ReadAll(io.LimitReader(file, macOSRuntimeMaxSecretBytes+1))
		if err != nil {
			return macOSFileSecretStoreFailure("read", err)
		}
		if len(loaded) == 0 || len(loaded) > macOSRuntimeMaxSecretBytes || int64(len(loaded)) != stat.Size {
			zeroBytes(loaded)
			return macOSFileSecretStoreFailure("read", fmt.Errorf("secret size changed or is outside fixed bounds"))
		}
		value = loaded
		return nil
	})
	return value, err
}

func (store *macOSFileSecretStore) Store(ctx context.Context, name string, value []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateMacOSRuntimeSecretName(name); err != nil {
		return err
	}
	if len(value) == 0 || len(value) > macOSRuntimeMaxSecretBytes {
		return macOSFileSecretStoreFailure("store", fmt.Errorf("secret size is outside fixed bounds"))
	}
	copyValue := append([]byte(nil), value...)
	defer zeroBytes(copyValue)
	return store.withDirectory("store", func(directoryFD int, principal macOSRuntimePrincipal) error {
		existing, _, err := openMacOSFileSecretFile(directoryFD, name, principal, unix.O_RDONLY)
		if err == nil {
			if closeErr := existing.Close(); closeErr != nil {
				return macOSFileSecretStoreFailure("close existing secret", closeErr)
			}
		} else if !errors.Is(err, unix.ENOENT) {
			return macOSFileSecretStoreFailure("validate existing secret", err)
		}

		tempName, err := newMacOSFileSecretTempName()
		if err != nil {
			return macOSFileSecretStoreFailure("create temporary secret name", err)
		}
		tempFD, err := unix.Openat(
			directoryFD,
			tempName,
			unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_CLOEXEC|unix.O_NOFOLLOW,
			0o600,
		)
		if err != nil {
			return macOSFileSecretStoreFailure("create temporary secret", err)
		}
		tempFile := os.NewFile(uintptr(tempFD), tempName)
		if tempFile == nil {
			_ = unix.Close(tempFD)
			_ = unix.Unlinkat(directoryFD, tempName, 0)
			return macOSFileSecretStoreFailure("adopt temporary secret", fmt.Errorf("file descriptor is invalid"))
		}
		renamed := false
		defer func() {
			if !renamed {
				_ = unix.Unlinkat(directoryFD, tempName, 0)
			}
		}()
		if err := validateOpenMacOSSecretFile(directoryFD, tempFD, tempName, principal); err != nil {
			_ = tempFile.Close()
			return macOSFileSecretStoreFailure("validate temporary secret", err)
		}
		if err := writeAllMacOSFileSecret(tempFile, copyValue); err != nil {
			_ = tempFile.Close()
			return macOSFileSecretStoreFailure("write temporary secret", err)
		}
		if err := tempFile.Sync(); err != nil {
			_ = tempFile.Close()
			return macOSFileSecretStoreFailure("sync temporary secret", err)
		}
		if err := validateOpenMacOSSecretFile(directoryFD, tempFD, tempName, principal); err != nil {
			_ = tempFile.Close()
			return macOSFileSecretStoreFailure("revalidate temporary secret", err)
		}
		if err := tempFile.Close(); err != nil {
			return macOSFileSecretStoreFailure("close temporary secret", err)
		}
		if err := unix.Renameat(directoryFD, tempName, directoryFD, name); err != nil {
			return macOSFileSecretStoreFailure("commit secret", err)
		}
		renamed = true
		committed, _, err := openMacOSFileSecretFile(directoryFD, name, principal, unix.O_RDONLY)
		if err != nil {
			return macOSFileSecretStoreFailure("validate committed secret", err)
		}
		if err := committed.Close(); err != nil {
			return macOSFileSecretStoreFailure("close committed secret", err)
		}
		if err := unix.Fsync(directoryFD); err != nil {
			return macOSFileSecretStoreFailure("sync secret directory", err)
		}
		return nil
	})
}

func (store *macOSFileSecretStore) Delete(ctx context.Context, name string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateMacOSRuntimeSecretName(name); err != nil {
		return err
	}
	return store.withDirectory("delete", func(directoryFD int, principal macOSRuntimePrincipal) error {
		file, _, err := openMacOSFileSecretFile(directoryFD, name, principal, unix.O_RDONLY)
		if errors.Is(err, unix.ENOENT) {
			return ErrProtectedSecretNotFound
		}
		if err != nil {
			return macOSFileSecretStoreFailure("delete", err)
		}
		if err := file.Close(); err != nil {
			return macOSFileSecretStoreFailure("close secret before delete", err)
		}
		if err := unix.Unlinkat(directoryFD, name, 0); err != nil {
			if errors.Is(err, unix.ENOENT) {
				return ErrProtectedSecretNotFound
			}
			return macOSFileSecretStoreFailure("delete", err)
		}
		if err := unix.Fsync(directoryFD); err != nil {
			return macOSFileSecretStoreFailure("sync secret directory", err)
		}
		return nil
	})
}

func openMacOSFileSecretFile(
	directoryFD int,
	name string,
	principal macOSRuntimePrincipal,
	flags int,
) (*os.File, unix.Stat_t, error) {
	var linked unix.Stat_t
	if err := unix.Fstatat(directoryFD, name, &linked, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return nil, unix.Stat_t{}, err
	}
	if linked.Mode&unix.S_IFMT != unix.S_IFREG || linked.Uid != principal.uid || linked.Gid != principal.gid ||
		linked.Mode&0o777 != 0o600 || linked.Nlink != 1 {
		return nil, unix.Stat_t{}, fmt.Errorf("secret owner, mode, kind, or link count mismatch")
	}
	fd, err := unix.Openat(directoryFD, name, flags|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, unix.Stat_t{}, err
	}
	if err := validateOpenMacOSSecretFile(directoryFD, fd, name, principal); err != nil {
		_ = unix.Close(fd)
		return nil, unix.Stat_t{}, err
	}
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		_ = unix.Close(fd)
		return nil, unix.Stat_t{}, err
	}
	file := os.NewFile(uintptr(fd), name)
	if file == nil {
		_ = unix.Close(fd)
		return nil, unix.Stat_t{}, fmt.Errorf("adopt secret descriptor")
	}
	return file, stat, nil
}

func validateOpenMacOSSecretFile(
	directoryFD int,
	fileFD int,
	name string,
	principal macOSRuntimePrincipal,
) error {
	var opened unix.Stat_t
	if err := unix.Fstat(fileFD, &opened); err != nil {
		return fmt.Errorf("inspect open secret: %w", err)
	}
	if opened.Mode&unix.S_IFMT != unix.S_IFREG || opened.Uid != principal.uid || opened.Gid != principal.gid ||
		opened.Mode&0o777 != 0o600 || opened.Nlink != 1 {
		return fmt.Errorf("secret owner, mode, kind, or link count mismatch")
	}
	var linked unix.Stat_t
	if err := unix.Fstatat(directoryFD, name, &linked, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return fmt.Errorf("inspect linked secret: %w", err)
	}
	if linked.Mode&unix.S_IFMT != unix.S_IFREG || linked.Uid != principal.uid || linked.Gid != principal.gid ||
		linked.Mode&0o777 != 0o600 || linked.Nlink != 1 ||
		linked.Dev != opened.Dev || linked.Ino != opened.Ino {
		return fmt.Errorf("secret vnode, owner, mode, kind, or link count mismatch")
	}
	return nil
}

func newMacOSFileSecretTempName() (string, error) {
	var entropy [16]byte
	if _, err := io.ReadFull(rand.Reader, entropy[:]); err != nil {
		return "", err
	}
	return ".secret-" + hex.EncodeToString(entropy[:]) + ".tmp", nil
}

func writeAllMacOSFileSecret(file *os.File, value []byte) error {
	for len(value) > 0 {
		written, err := file.Write(value)
		if err != nil {
			return err
		}
		if written <= 0 {
			return io.ErrShortWrite
		}
		value = value[written:]
	}
	return nil
}

func macOSFileSecretStoreFailure(operation string, err error) error {
	return fail(
		ReasonProtectedLocalCustodyBoundaryUnavailable,
		false,
		"repair_runtime_service",
		fmt.Errorf("%s macOS Runtime secret: %w", operation, err),
	)
}

func (store *macOSFileSecretStore) Close() error {
	if store == nil {
		return nil
	}
	store.closeOnce.Do(func() {
		store.mu.Lock()
		store.closed = true
		directoryFD := store.directoryFD
		store.directoryFD = -1
		store.mu.Unlock()
		if directoryFD >= 0 {
			store.closeErr = unix.Close(directoryFD)
		}
	})
	return store.closeErr
}

var _ macOSRuntimeBinarySecretStore = (*macOSFileSecretStore)(nil)
