//go:build darwin && cgo

package protectedlocal

import (
	"os"
	"path/filepath"
	"testing"
)

func TestClassifyMacOSProvisionInventoryFresh(t *testing.T) {
	disposition, err := classifyMacOSProvisionInventory(macOSProvisionInventory{})
	if err != nil {
		t.Fatalf("classify fresh macOS provision inventory: %v", err)
	}
	if disposition != macOSProvisionFresh {
		t.Fatalf("fresh disposition = %q", disposition)
	}
}

func TestClassifyMacOSProvisionInventoryExisting(t *testing.T) {
	for _, inventory := range []macOSProvisionInventory{
		{stateLock: true},
		{stateLock: true, mutableState: true},
	} {
		disposition, err := classifyMacOSProvisionInventory(inventory)
		if err != nil {
			t.Fatalf("classify existing macOS provision inventory %+v: %v", inventory, err)
		}
		if disposition != macOSProvisionExisting {
			t.Fatalf("existing disposition = %q for %+v", disposition, inventory)
		}
	}
}

func TestClassifyMacOSProvisionInventoryRejectsPartialState(t *testing.T) {
	partials := []macOSProvisionInventory{
		{mutableState: true},
	}
	for _, inventory := range partials {
		if _, err := classifyMacOSProvisionInventory(inventory); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
			t.Fatalf("partial inventory %+v error = %v", inventory, err)
		}
	}
}

func TestInspectMacOSProvisionInventoryTreatsProductEntriesAsMutableState(t *testing.T) {
	stateRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(stateRoot, "unexpected-entry"), []byte("unexpected"), 0o600); err != nil {
		t.Fatalf("write unknown macOS state entry: %v", err)
	}
	inventory, err := inspectMacOSProvisionInventory(stateRoot, macOSRuntimePrincipal{uid: uint32(os.Geteuid()), gid: uint32(os.Getegid())})
	if err != nil {
		t.Fatalf("inspect Runtime-owned product state: %v", err)
	}
	if inventory.stateLock || !inventory.mutableState {
		t.Fatalf("product state inventory = %+v", inventory)
	}
	if _, err := classifyMacOSProvisionInventory(inventory); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("mutable state without fixed lock error = %v", err)
	}
}

func TestRemoveMacOSRuntimeMutableStateEntriesPreservesOnlyLock(t *testing.T) {
	stateRoot := t.TempDir()
	lockPath := filepath.Join(stateRoot, MacOSRuntimeStateLockFilename)
	lockFile, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR|os.O_EXCL, 0o600)
	if err != nil {
		t.Fatalf("create retained state lock: %v", err)
	}
	defer func() { _ = lockFile.Close() }()
	lock := &macOSRuntimeStateLock{file: lockFile}

	if err := os.Mkdir(filepath.Join(stateRoot, "connectors"), 0o700); err != nil {
		t.Fatalf("create mutable directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(stateRoot, "local-app-kernel.db"), []byte("state"), 0o600); err != nil {
		t.Fatalf("create mutable file: %v", err)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("keep"), 0o600); err != nil {
		t.Fatalf("create symlink target: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(stateRoot, "link")); err != nil {
		t.Fatalf("create mutable symlink: %v", err)
	}

	if err := removeMacOSRuntimeMutableStateEntries(stateRoot, lock); err != nil {
		t.Fatalf("remove mutable state entries: %v", err)
	}
	entries, err := os.ReadDir(stateRoot)
	if err != nil {
		t.Fatalf("inspect reset state root: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != MacOSRuntimeStateLockFilename {
		t.Fatalf("remaining state entries = %v", entries)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("mutable symlink target was removed: %v", err)
	}
}
