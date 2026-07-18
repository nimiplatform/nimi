//go:build darwin && cgo

package protectedlocal

import "testing"

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
		{stateLock: true, ledger: true, recordKey: true, anchor: true},
		{stateLock: true, ledger: true, ledgerWAL: true, ledgerSHM: true, runtimeDir: true, recordKey: true, anchor: true},
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
		{stateLock: true},
		{ledger: true},
		{ledgerWAL: true},
		{ledgerSHM: true},
		{runtimeDir: true},
		{recordKey: true},
		{anchor: true},
		{stateLock: true, ledger: true, recordKey: true},
		{stateLock: true, ledger: true, anchor: true},
		{stateLock: true, recordKey: true, anchor: true},
		{ledger: true, recordKey: true, anchor: true},
	}
	for _, inventory := range partials {
		if _, err := classifyMacOSProvisionInventory(inventory); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
			t.Fatalf("partial inventory %+v error = %v", inventory, err)
		}
	}
}
