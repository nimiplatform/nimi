package main

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestDatabaseURLReadOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "memory #1.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('preserved')"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	u := databaseURL(path, "ro")
	ro, err := sql.Open("sqlite", u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := ro.Close(); err != nil {
			t.Errorf("close test storage: %v", err)
		}
	}()
	var value string
	if err := ro.QueryRow("SELECT value FROM marker").Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != "preserved" {
		t.Fatalf("unexpected value %q", value)
	}
	if _, err := ro.Exec("DELETE FROM marker"); err == nil {
		t.Fatal("read-only database allowed a write")
	}
}
