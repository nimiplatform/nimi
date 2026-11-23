//go:build !windows

package nimiapppackage

import (
	"errors"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestOpenArchiveReadOnlyRejectsFIFOWithoutWriter(t *testing.T) {
	archive := filepath.Join(t.TempDir(), "selected.nimiapp")
	if err := syscall.Mkfifo(archive, 0o600); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		file, _, err := OpenArchiveReadOnly(archive)
		if file != nil {
			_ = file.Close()
		}
		result <- err
	}()
	select {
	case err := <-result:
		if !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("FIFO selection error = %v, want invalid package", err)
		}
	case <-time.After(time.Second):
		t.Fatal("opening the selected FIFO blocked waiting for a writer")
	}
}
