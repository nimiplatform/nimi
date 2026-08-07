//go:build windows && nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const windowsSourceSecretMaximumBytes = 1 << 20

type windowsSourceSecretStore struct {
	root string
	mu   sync.Mutex
}

func openWindowsSourceSecretStore(root string) (BinarySecretStore, error) {
	if !filepath.IsAbs(root) || filepath.Base(root) != "secrets" {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("open current-user secret store: fixed source root required"))
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("create current-user secret store: %w", err))
	}
	return &windowsSourceSecretStore{root: root}, nil
}

func (store *windowsSourceSecretStore) Load(ctx context.Context, name string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if store == nil || validateWindowsSecretName(name) != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("load current-user secret: invalid input"))
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	encoded, err := os.ReadFile(filepath.Join(store.root, name+".bin"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrProtectedSecretNotFound
	}
	if err != nil || len(encoded) == 0 || len(encoded) > windowsSourceSecretMaximumBytes {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("load current-user secret: unavailable or invalid"))
	}
	decoded, err := windowsSourceUnprotect(encoded)
	if err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("unprotect current-user secret: %w", err))
	}
	return decoded, nil
}

func (store *windowsSourceSecretStore) Store(ctx context.Context, name string, value []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if store == nil || validateWindowsSecretName(name) != nil || len(value) == 0 || len(value) > windowsSourceSecretMaximumBytes {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("store current-user secret: invalid input"))
	}
	encoded, err := windowsSourceProtect(value)
	if err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("protect current-user secret: %w", err))
	}
	defer zeroBytes(encoded)
	store.mu.Lock()
	defer store.mu.Unlock()
	temporary, err := os.CreateTemp(store.root, ".secret-*.tmp")
	if err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("create current-user secret: %w", err))
	}
	temporaryPath := temporary.Name()
	keep := false
	defer func() {
		_ = temporary.Close()
		if !keep {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, err := temporary.Write(encoded); err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("write current-user secret: %w", err))
	}
	if err := temporary.Sync(); err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("sync current-user secret: %w", err))
	}
	if err := temporary.Close(); err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("close current-user secret: %w", err))
	}
	destination := filepath.Join(store.root, name+".bin")
	if err := os.Rename(temporaryPath, destination); err != nil {
		_ = os.Remove(destination)
		if retryErr := os.Rename(temporaryPath, destination); retryErr != nil {
			return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("replace current-user secret: %w", retryErr))
		}
	}
	keep = true
	return nil
}

func (store *windowsSourceSecretStore) Delete(ctx context.Context, name string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if store == nil || validateWindowsSecretName(name) != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime", fmt.Errorf("delete current-user secret: invalid input"))
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	err := os.Remove(filepath.Join(store.root, name+".bin"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func windowsSourceProtect(value []byte) ([]byte, error) {
	input := windows.DataBlob{Size: uint32(len(value)), Data: &value[0]}
	var output windows.DataBlob
	if err := windows.CryptProtectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output); err != nil {
		return nil, err
	}
	return copyAndFreeWindowsDataBlob(output)
}

func windowsSourceUnprotect(value []byte) ([]byte, error) {
	input := windows.DataBlob{Size: uint32(len(value)), Data: &value[0]}
	var output windows.DataBlob
	if err := windows.CryptUnprotectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output); err != nil {
		return nil, err
	}
	return copyAndFreeWindowsDataBlob(output)
}

func copyAndFreeWindowsDataBlob(blob windows.DataBlob) ([]byte, error) {
	if blob.Data == nil || blob.Size == 0 || blob.Size > windowsSourceSecretMaximumBytes {
		if blob.Data != nil {
			_, _ = windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(blob.Data))))
		}
		return nil, fmt.Errorf("DPAPI returned an invalid blob")
	}
	defer func() { _, _ = windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(blob.Data)))) }()
	return append([]byte(nil), unsafe.Slice(blob.Data, blob.Size)...), nil
}

var _ BinarySecretStore = (*windowsSourceSecretStore)(nil)
