//go:build darwin && cgo

package protectedlocal

import (
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestMacOSReleaseTrustPathAcceptsNativeApplicationSupportOwnership(t *testing.T) {
	var metadata unix.Stat_t
	if err := unix.Lstat("/Library/Application Support", &metadata); err != nil {
		t.Fatalf("stat native Application Support: %v", err)
	}
	if err := validateMacOSReleaseRecordPathComponent("/Library/Application Support", metadata, false); err != nil {
		t.Fatalf("native OS-owned Application Support must be admitted without reownership: %v", err)
	}
}

func TestMacOSReleaseTrustRecordFinalOpenCannotBlockOnFIFO(t *testing.T) {
	flags := macOSReleaseRecordOpenFlags(true)
	if flags&unix.O_NONBLOCK == 0 || flags&unix.O_NOFOLLOW == 0 || flags&unix.O_DIRECTORY != 0 {
		t.Fatalf("final record open flags = %#x", flags)
	}
	directoryFlags := macOSReleaseRecordOpenFlags(false)
	if directoryFlags&unix.O_DIRECTORY == 0 || directoryFlags&unix.O_NOFOLLOW == 0 {
		t.Fatalf("directory open flags = %#x", directoryFlags)
	}
	fifo := filepath.Join(t.TempDir(), "record")
	if err := unix.Mkfifo(fifo, 0o600); err != nil {
		t.Fatalf("create FIFO: %v", err)
	}
	fd, err := unix.Open(fifo, flags, 0)
	if err != nil {
		t.Fatalf("nonblocking FIFO open: %v", err)
	}
	defer unix.Close(fd)
	var metadata unix.Stat_t
	if err := unix.Fstat(fd, &metadata); err != nil {
		t.Fatalf("stat FIFO: %v", err)
	}
	if err := validateMacOSReleaseRecordPathComponent(
		"/Library/Application Support/Nimi/RuntimeDev/record.json", metadata, true,
	); err == nil {
		t.Fatal("FIFO was accepted as a release record")
	}
}

func TestMacOSReleaseTrustPathComponentClasses(t *testing.T) {
	osDirectory := unix.Stat_t{Uid: 0, Gid: 80, Mode: unix.S_IFDIR | 0o755, Nlink: 2}
	if err := validateMacOSReleaseRecordPathComponent("/Library/Application Support", osDirectory, false); err != nil {
		t.Fatalf("root:admin nonwritable OS ancestor rejected: %v", err)
	}

	nimiDirectory := unix.Stat_t{Uid: 0, Gid: 0, Mode: unix.S_IFDIR | 0o755, Nlink: 2}
	if err := validateMacOSReleaseRecordPathComponent("/Library/Application Support/Nimi/RuntimeDev", nimiDirectory, false); err != nil {
		t.Fatalf("exact Nimi-owned directory rejected: %v", err)
	}

	record := unix.Stat_t{Uid: 0, Gid: 0, Mode: unix.S_IFREG | 0o644, Nlink: 1}
	if err := validateMacOSReleaseRecordPathComponent("/Library/Application Support/Nimi/RuntimeDev/record.json", record, true); err != nil {
		t.Fatalf("exact release record rejected: %v", err)
	}
}

func TestMacOSReleaseTrustPathRejectsWritableOrMisownedComponents(t *testing.T) {
	tests := []struct {
		name  string
		path  string
		stat  unix.Stat_t
		final bool
	}{
		{
			name: "OS ancestor non-root",
			path: "/Library/Application Support",
			stat: unix.Stat_t{Uid: 501, Gid: 80, Mode: unix.S_IFDIR | 0o755, Nlink: 2},
		},
		{
			name: "OS ancestor group writable",
			path: "/Library/Application Support",
			stat: unix.Stat_t{Uid: 0, Gid: 80, Mode: unix.S_IFDIR | 0o775, Nlink: 2},
		},
		{
			name: "Nimi subtree wrong group",
			path: "/Library/Application Support/Nimi",
			stat: unix.Stat_t{Uid: 0, Gid: 80, Mode: unix.S_IFDIR | 0o755, Nlink: 2},
		},
		{
			name: "Nimi subtree writable",
			path: "/Library/Application Support/Nimi",
			stat: unix.Stat_t{Uid: 0, Gid: 0, Mode: unix.S_IFDIR | 0o775, Nlink: 2},
		},
		{
			name:  "record multiple links",
			path:  "/Library/Application Support/Nimi/RuntimeDev/record.json",
			stat:  unix.Stat_t{Uid: 0, Gid: 0, Mode: unix.S_IFREG | 0o644, Nlink: 2},
			final: true,
		},
		{
			name:  "record wrong group",
			path:  "/Library/Application Support/Nimi/RuntimeDev/record.json",
			stat:  unix.Stat_t{Uid: 0, Gid: 80, Mode: unix.S_IFREG | 0o644, Nlink: 1},
			final: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateMacOSReleaseRecordPathComponent(test.path, test.stat, test.final); err == nil {
				t.Fatal("unsafe path component was accepted")
			}
		})
	}
}
