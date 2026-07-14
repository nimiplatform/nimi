package protectedlocal

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
)

func TestProtectedLedgerDoesNotConstructImmutablePackageLifecycleTables(t *testing.T) {
	directory := t.TempDir()
	ledger, err := OpenLedger(context.Background(), testLedgerOptions(directory, newTestAnchorStore()))
	if err != nil {
		t.Fatalf("open protected ledger: %v", err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	assertRetiredImmutablePackageTablesAbsent(t, ledger.db)
	var version int
	if err := ledger.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != ledgerSchemaVersion {
		t.Fatalf("protected ledger schema version = %d err=%v, want %d", version, err, ledgerSchemaVersion)
	}
}

func TestProtectedLedgerMigratesEmptyVersionTwoPackageTablesOut(t *testing.T) {
	directory := t.TempDir()
	anchor := newTestAnchorStore()
	options := testLedgerOptions(directory, anchor)
	ledger, err := OpenLedger(context.Background(), options)
	if err != nil {
		t.Fatalf("open initial protected ledger: %v", err)
	}
	if err := ledger.Close(); err != nil {
		t.Fatalf("close initial protected ledger: %v", err)
	}

	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s", filepath.ToSlash(options.Path)))
	if err != nil {
		t.Fatalf("open migration fixture: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE protected_lifecycle_challenge (fixture_id INTEGER PRIMARY KEY)`,
		`CREATE TABLE protected_lifecycle_intent (fixture_id INTEGER PRIMARY KEY)`,
		`PRAGMA user_version = 2`,
	} {
		if _, err := db.Exec(statement); err != nil {
			_ = db.Close()
			t.Fatalf("prepare version-two fixture: %v", err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close migration fixture: %v", err)
	}

	migrated, err := OpenLedger(context.Background(), options)
	if err != nil {
		t.Fatalf("migrate protected ledger: %v", err)
	}
	t.Cleanup(func() { _ = migrated.Close() })
	assertRetiredImmutablePackageTablesAbsent(t, migrated.db)
}

func assertRetiredImmutablePackageTablesAbsent(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, table := range []string{"protected_lifecycle_challenge", "protected_lifecycle_intent"} {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			t.Fatalf("inspect table %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("retired immutable package table %s exists", table)
		}
	}
}
