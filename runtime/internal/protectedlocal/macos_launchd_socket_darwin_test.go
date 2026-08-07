//go:build darwin && cgo && !nimi_macos_source_local_development

package protectedlocal

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestValidateActivatedMacOSSocketFDBindsAddressAndStablePathVnode(t *testing.T) {
	path := shortMacOSSocketTestPath(t)
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatalf("listen Unix socket: %v", err)
	}
	defer func() { _ = listener.Close() }()

	info, err := os.Lstat(path)
	if err != nil {
		t.Fatalf("stat Unix socket: %v", err)
	}
	endpoint, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatal("Unix socket stat type is unavailable")
	}

	raw, err := listener.SyscallConn()
	if err != nil {
		t.Fatalf("get raw listener: %v", err)
	}
	var validationErr error
	if err := raw.Control(func(fd uintptr) {
		validationErr = validateActivatedMacOSSocketFD(int(fd), path, endpoint)
	}); err != nil {
		t.Fatalf("inspect raw listener: %v", err)
	}
	if validationErr != nil {
		t.Fatalf("stable kernel address and pathname vnode rejected: %v: %v", validationErr, errors.Unwrap(validationErr))
	}
}

func TestValidateActivatedMacOSSocketFDRejectsPathReplacement(t *testing.T) {
	path := shortMacOSSocketTestPath(t)
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatalf("listen Unix socket: %v", err)
	}
	defer func() { _ = listener.Close() }()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatalf("stat Unix socket: %v", err)
	}
	endpoint := info.Sys().(*syscall.Stat_t)
	if err := os.Remove(path); err != nil {
		t.Fatalf("remove original socket path: %v", err)
	}
	replacement, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatalf("bind replacement Unix socket: %v", err)
	}
	defer func() { _ = replacement.Close() }()

	raw, err := listener.SyscallConn()
	if err != nil {
		t.Fatalf("get raw listener: %v", err)
	}
	var validationErr error
	if err := raw.Control(func(fd uintptr) {
		validationErr = validateActivatedMacOSSocketFD(int(fd), path, endpoint)
	}); err != nil {
		t.Fatalf("inspect raw listener: %v", err)
	}
	if validationErr == nil {
		t.Fatal("replaced Unix socket pathname was accepted")
	}
}

func shortMacOSSocketTestPath(t *testing.T) string {
	t.Helper()
	directory, err := os.MkdirTemp("/private/tmp", "nimi-uds-")
	if err != nil {
		t.Fatalf("create short Unix socket directory: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	return filepath.Join(directory, "runtime.sock")
}
