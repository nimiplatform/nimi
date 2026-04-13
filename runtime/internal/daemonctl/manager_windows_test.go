//go:build windows

package daemonctl

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestRemoveFileWithRetryRetriesSharingViolation(t *testing.T) {
	manager, _, _ := newTestManager(t)
	manager.now = func() time.Time { return time.Unix(0, 0) }
	sleepCalls := 0
	manager.sleep = func(time.Duration) {
		sleepCalls++
	}

	target := filepath.Join(t.TempDir(), "runtime.lock")
	removeCalls := 0
	manager.removeFile = func(path string) error {
		if path != target {
			t.Fatalf("unexpected remove path: %q", path)
		}
		removeCalls++
		if removeCalls == 1 {
			return &os.PathError{
				Op:   "remove",
				Path: path,
				Err:  syscall.Errno(windows.ERROR_SHARING_VIOLATION),
			}
		}
		return nil
	}

	if err := manager.removeFileWithRetry(target); err != nil {
		t.Fatalf("removeFileWithRetry: %v", err)
	}
	if removeCalls != 2 {
		t.Fatalf("expected 2 remove attempts, got %d", removeCalls)
	}
	if sleepCalls != 1 {
		t.Fatalf("expected 1 retry sleep, got %d", sleepCalls)
	}
}

func TestRemoveFileWithRetryDoesNotRetryNonRetryableError(t *testing.T) {
	manager, _, _ := newTestManager(t)
	manager.now = func() time.Time { return time.Unix(0, 0) }
	sleepCalls := 0
	manager.sleep = func(time.Duration) {
		sleepCalls++
	}

	target := filepath.Join(t.TempDir(), "runtime.lock")
	expected := fmt.Errorf("boom")
	removeCalls := 0
	manager.removeFile = func(path string) error {
		removeCalls++
		return expected
	}

	err := manager.removeFileWithRetry(target)
	if err == nil || err.Error() != expected.Error() {
		t.Fatalf("expected %v, got %v", expected, err)
	}
	if removeCalls != 1 {
		t.Fatalf("expected a single remove attempt, got %d", removeCalls)
	}
	if sleepCalls != 0 {
		t.Fatalf("expected no retry sleep, got %d", sleepCalls)
	}
}
