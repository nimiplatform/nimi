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
		{stateLock: true, runtimeDir: true},
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
		{runtimeDir: true},
	}
	for _, inventory := range partials {
		if _, err := classifyMacOSProvisionInventory(inventory); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
			t.Fatalf("partial inventory %+v error = %v", inventory, err)
		}
	}
}

func TestInspectMacOSProvisionInventoryRejectsUnknownEntries(t *testing.T) {
	stateRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(stateRoot, "unexpected-entry"), []byte("unexpected"), 0o600); err != nil {
		t.Fatalf("write unknown macOS state entry: %v", err)
	}
	_, err := inspectMacOSProvisionInventory(stateRoot, macOSRuntimePrincipal{uid: uint32(os.Geteuid()), gid: uint32(os.Getegid())})
	if !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("unknown state entry inventory error = %v", err)
	}
}
