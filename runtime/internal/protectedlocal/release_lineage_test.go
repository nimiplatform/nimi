package protectedlocal

import (
	"context"
	"testing"
)

func TestReleaseLineagePersistsHighWaterAndRejectsRollbackOrRebinding(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	anchor := newTestAnchorStore()
	ledger, err := OpenLedger(ctx, testLedgerOptions(directory, anchor))
	if err != nil {
		t.Fatalf("open ledger: %v", err)
	}
	first := ReleaseLineageRecord{
		ExecutableRole: "nimi_runtime_service",
		ReleaseID:      "runtime-2026.07",
		Generation:     7,
		ArtifactSHA256: identifierFilled(0x71),
	}
	if err := ledger.AdmitReleaseLineage(ctx, first); err != nil {
		t.Fatalf("admit first release: %v", err)
	}
	anchorAfterFirst, err := ledger.Anchor(ctx)
	if err != nil {
		t.Fatalf("read first anchor: %v", err)
	}
	if err := ledger.AdmitReleaseLineage(ctx, first); err != nil {
		t.Fatalf("readmit identical release: %v", err)
	}
	anchorAfterRepeat, err := ledger.Anchor(ctx)
	if err != nil || anchorAfterRepeat != anchorAfterFirst {
		t.Fatalf("identical release created a new commit: before=%#v after=%#v err=%v", anchorAfterFirst, anchorAfterRepeat, err)
	}

	rebound := first
	rebound.ReleaseID = "runtime-rebound"
	if err := ledger.AdmitReleaseLineage(ctx, rebound); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
		t.Fatalf("generation rebinding error = %v", err)
	}
	rollback := first
	rollback.Generation = 6
	rollback.ReleaseID = "runtime-2026.06"
	if err := ledger.AdmitReleaseLineage(ctx, rollback); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
		t.Fatalf("rollback error = %v", err)
	}

	second := first
	second.Generation = 8
	second.ReleaseID = "runtime-2026.08"
	second.ArtifactSHA256 = identifierFilled(0x81)
	if err := ledger.AdmitReleaseLineage(ctx, second); err != nil {
		t.Fatalf("advance release: %v", err)
	}
	if err := ledger.Close(); err != nil {
		t.Fatalf("close ledger: %v", err)
	}
	reopened, err := OpenLedger(ctx, testLedgerOptions(directory, anchor))
	if err != nil {
		t.Fatalf("reopen ledger: %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	if err := reopened.AdmitReleaseLineage(ctx, first); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
		t.Fatalf("persistent rollback error = %v", err)
	}
}

func TestReleaseLineageTamperingFailsLedgerRecovery(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	anchor := newTestAnchorStore()
	options := testLedgerOptions(directory, anchor)
	ledger, err := OpenLedger(ctx, options)
	if err != nil {
		t.Fatalf("open ledger: %v", err)
	}
	if err := ledger.AdmitReleaseLineage(ctx, ReleaseLineageRecord{
		ExecutableRole: "nimi_desktop",
		ReleaseID:      "desktop-2026.07",
		Generation:     7,
		ArtifactSHA256: identifierFilled(0x72),
	}); err != nil {
		t.Fatalf("admit release: %v", err)
	}
	if _, err := ledger.db.ExecContext(ctx, `UPDATE protected_release_lineage SET release_id = 'desktop-tampered'`); err != nil {
		t.Fatalf("tamper lineage: %v", err)
	}
	if err := ledger.Close(); err != nil {
		t.Fatalf("close ledger: %v", err)
	}
	if _, err := OpenLedger(ctx, options); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
		t.Fatalf("tampered recovery error = %v", err)
	}
}
