//go:build windows

package nimiapppackage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenArchiveReadOnlyBlocksConcurrentWriteAndSupportsLongPaths(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "sample.nimiapp")
	if err := os.WriteFile(filePath, []byte("hello-nimi"), 0o600); err != nil {
		t.Fatal(err)
	}

	// 1. While OpenArchiveReadOnly holds the file open, concurrent write open MUST fail.
	readHandle, size, err := OpenArchiveReadOnly(filePath)
	if err != nil {
		t.Fatalf("OpenArchiveReadOnly: %v", err)
	}
	if size != 10 {
		_ = readHandle.Close()
		t.Fatalf("size = %d, want 10", size)
	}
	if writeHandle, writeErr := os.OpenFile(filePath, os.O_WRONLY, 0); writeErr == nil {
		_ = writeHandle.Close()
		_ = readHandle.Close()
		t.Fatal("concurrent writer succeeded while OpenArchiveReadOnly handle was open")
	}
	_ = readHandle.Close()

	// 2. If a writer already holds the file open, OpenArchiveReadOnly MUST fail.
	writer, err := os.OpenFile(filePath, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if conflicting, _, conflictErr := OpenArchiveReadOnly(filePath); conflictErr == nil {
		_ = conflicting.Close()
		_ = writer.Close()
		t.Fatal("OpenArchiveReadOnly succeeded despite active conflicting writer")
	}
	_ = writer.Close()

	// 3. Long path (> 260 chars) must open cleanly via \\?\ prefix.
	deepDir := dir
	for len(deepDir) < 255 {
		deepDir = filepath.Join(deepDir, strings.Repeat("x", 40))
	}
	longDir := toWindowsExtendedPath(deepDir)
	if err := os.MkdirAll(longDir, 0o700); err != nil {
		t.Fatalf("MkdirAll long dir: %v", err)
	}
	longFile := filepath.Join(deepDir, "long-archive.nimiapp")
	if err := os.WriteFile(toWindowsExtendedPath(longFile), []byte("long-path-ok"), 0o600); err != nil {
		t.Fatalf("WriteFile long path: %v", err)
	}
	longHandle, longSize, err := OpenArchiveReadOnly(longFile)
	if err != nil {
		t.Fatalf("OpenArchiveReadOnly long path: %v", err)
	}
	_ = longHandle.Close()
	if longSize != 12 {
		t.Fatalf("longSize = %d, want 12", longSize)
	}
}
