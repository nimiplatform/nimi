package runtimeinstance

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAcquireLockIsSharedExclusiveAndRecoversStaleLease(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "runtime.lock")
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", lockPath)

	release, err := AcquireLock()
	if err != nil {
		t.Fatalf("AcquireLock(first): %v", err)
	}
	if _, err := AcquireLock(); err == nil {
		_ = release()
		t.Fatal("second Runtime lease acquisition succeeded")
	}
	if err := release(); err != nil {
		t.Fatalf("release first Runtime lease: %v", err)
	}

	if err := os.WriteFile(lockPath, nil, 0o600); err != nil {
		t.Fatalf("write stale Runtime lease: %v", err)
	}
	release, err = AcquireLock()
	if err != nil {
		t.Fatalf("AcquireLock(stale recovery): %v", err)
	}
	if err := release(); err != nil {
		t.Fatalf("release recovered Runtime lease: %v", err)
	}
	if _, err := os.Stat(lockPath); !os.IsNotExist(err) {
		t.Fatalf("Runtime lease residue: %v", err)
	}
}
