//go:build darwin && cgo && nimi_macos_local_development

package protectedlocal

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"golang.org/x/sys/unix"
)

func TestMacOSLocalDevelopmentSecretStoreLifecycle(t *testing.T) {
	stateRoot, principal := newMacOSLocalDevelopmentSecretStoreRoot(t)
	store, err := openMacOSLocalDevelopmentSecretStore(stateRoot, principal)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	ctx := context.Background()
	name := "acct-v1-example"

	if _, err := store.Load(ctx, name); !errors.Is(err, ErrProtectedSecretNotFound) {
		t.Fatalf("missing load error = %v, want ErrProtectedSecretNotFound", err)
	}
	if err := store.Delete(ctx, name); !errors.Is(err, ErrProtectedSecretNotFound) {
		t.Fatalf("missing delete error = %v, want ErrProtectedSecretNotFound", err)
	}
	if err := store.Store(ctx, name, []byte("first")); err != nil {
		t.Fatalf("store first value: %v", err)
	}
	assertMacOSLocalDevelopmentSecretArtifact(
		t,
		filepath.Join(stateRoot, macOSRuntimeSecretDirectoryName),
		principal,
		true,
	)
	assertMacOSLocalDevelopmentSecretArtifact(
		t,
		filepath.Join(stateRoot, macOSRuntimeSecretDirectoryName, name),
		principal,
		false,
	)
	if loaded, err := store.Load(ctx, name); err != nil || !bytes.Equal(loaded, []byte("first")) {
		t.Fatalf("load first value = %q, %v", loaded, err)
	}
	if err := store.Store(ctx, name, []byte("second")); err != nil {
		t.Fatalf("overwrite value: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}
	staleTempName := ".secret-00000000000000000000000000000000.tmp"
	staleTempPath := filepath.Join(stateRoot, macOSRuntimeSecretDirectoryName, staleTempName)
	if err := os.WriteFile(staleTempPath, []byte("stale-secret"), 0o600); err != nil {
		t.Fatalf("create stale temporary secret: %v", err)
	}
	if err := os.Chmod(staleTempPath, 0o600); err != nil {
		t.Fatalf("set stale temporary secret mode: %v", err)
	}

	store, err = openMacOSLocalDevelopmentSecretStore(stateRoot, principal)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	defer func() { _ = store.Close() }()
	if _, err := os.Lstat(staleTempPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale temporary secret remains after reopen: %v", err)
	}
	if loaded, err := store.Load(ctx, name); err != nil || !bytes.Equal(loaded, []byte("second")) {
		t.Fatalf("load reopened value = %q, %v", loaded, err)
	}
	if err := store.Delete(ctx, name); err != nil {
		t.Fatalf("delete value: %v", err)
	}
	if _, err := store.Load(ctx, name); !errors.Is(err, ErrProtectedSecretNotFound) {
		t.Fatalf("load deleted value error = %v, want ErrProtectedSecretNotFound", err)
	}
}

func TestMacOSLocalDevelopmentSecretStoreRejectsUnsafeInputsAndArtifacts(t *testing.T) {
	stateRoot, principal := newMacOSLocalDevelopmentSecretStoreRoot(t)
	store, err := openMacOSLocalDevelopmentSecretStore(stateRoot, principal)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() { _ = store.Close() }()
	ctx := context.Background()

	for _, name := range []string{"", "../escape", "Upper", "a/b", strings.Repeat("a", 65)} {
		if err := store.Store(ctx, name, []byte("value")); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
			t.Fatalf("store invalid name %q error = %v", name, err)
		}
	}
	if err := store.Store(ctx, "empty", nil); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("store empty value error = %v", err)
	}
	if err := store.Store(ctx, "oversize", make([]byte, macOSRuntimeMaxSecretBytes+1)); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("store oversized value error = %v", err)
	}

	secretRoot := filepath.Join(stateRoot, macOSRuntimeSecretDirectoryName)
	wrongModeName := "wrong-mode"
	wrongModePath := filepath.Join(secretRoot, wrongModeName)
	if err := os.WriteFile(wrongModePath, []byte("value"), 0o600); err != nil {
		t.Fatalf("create wrong-mode file: %v", err)
	}
	if err := os.Chmod(wrongModePath, 0o644); err != nil {
		t.Fatalf("set wrong-mode file permissions: %v", err)
	}
	if _, err := store.Load(ctx, wrongModeName); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("load wrong-mode file error = %v", err)
	}
	if err := store.Store(ctx, wrongModeName, []byte("replacement")); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("overwrite wrong-mode file error = %v", err)
	}

	symlinkName := "symlink"
	if err := os.Symlink(wrongModePath, filepath.Join(secretRoot, symlinkName)); err != nil {
		t.Fatalf("create secret symlink: %v", err)
	}
	if _, err := store.Load(ctx, symlinkName); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("load symlink error = %v", err)
	}

	hardlinkName := "hardlink"
	hardlinkSource := filepath.Join(secretRoot, "hardlink-source")
	if err := os.WriteFile(hardlinkSource, []byte("value"), 0o600); err != nil {
		t.Fatalf("create hardlink source: %v", err)
	}
	if err := os.Link(hardlinkSource, filepath.Join(secretRoot, hardlinkName)); err != nil {
		t.Fatalf("create secret hardlink: %v", err)
	}
	if _, err := store.Load(ctx, hardlinkName); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("load hardlink error = %v", err)
	}

	fifoName := "fifo"
	fifoPath := filepath.Join(secretRoot, fifoName)
	if err := unix.Mkfifo(fifoPath, 0o600); err != nil {
		t.Fatalf("create secret FIFO: %v", err)
	}
	if err := os.Chmod(fifoPath, 0o600); err != nil {
		t.Fatalf("set secret FIFO mode: %v", err)
	}
	if _, err := store.Load(ctx, fifoName); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("load FIFO error = %v", err)
	}
}

func TestMacOSLocalDevelopmentSecretStoreRejectsUnsafeDirectory(t *testing.T) {
	stateRoot, principal := newMacOSLocalDevelopmentSecretStoreRoot(t)
	secretRoot := filepath.Join(stateRoot, macOSRuntimeSecretDirectoryName)
	if err := os.Mkdir(secretRoot, 0o700); err != nil {
		t.Fatalf("create secret directory: %v", err)
	}
	if err := os.Chmod(secretRoot, 0o755); err != nil {
		t.Fatalf("set unsafe secret directory mode: %v", err)
	}
	if _, err := openMacOSLocalDevelopmentSecretStore(stateRoot, principal); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("open store with unsafe directory error = %v", err)
	}
}

func newMacOSLocalDevelopmentSecretStoreRoot(t *testing.T) (string, macOSRuntimePrincipal) {
	t.Helper()
	stateRoot := t.TempDir()
	if err := os.Chmod(stateRoot, 0o700); err != nil {
		t.Fatalf("set state-root mode: %v", err)
	}
	return stateRoot, macOSRuntimePrincipal{uid: uint32(os.Getuid()), gid: uint32(os.Getgid())}
}

func assertMacOSLocalDevelopmentSecretArtifact(
	t *testing.T,
	path string,
	principal macOSRuntimePrincipal,
	directory bool,
) {
	t.Helper()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatalf("inspect %s: %v", path, err)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatalf("inspect %s ownership", path)
	}
	wantMode := os.FileMode(0o600)
	if directory {
		wantMode = 0o700
	}
	if stat.Uid != principal.uid || stat.Gid != principal.gid || info.Mode().Perm() != wantMode {
		t.Fatalf(
			"%s owner/mode = %d:%d %04o, want %d:%d %04o",
			path,
			stat.Uid,
			stat.Gid,
			info.Mode().Perm(),
			principal.uid,
			principal.gid,
			wantMode,
		)
	}
	if directory {
		if !info.IsDir() || stat.Nlink < 2 {
			t.Fatalf("%s is not a safe directory", path)
		}
		return
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || stat.Nlink != 1 {
		t.Fatalf("%s is not a safe regular file", path)
	}
}
