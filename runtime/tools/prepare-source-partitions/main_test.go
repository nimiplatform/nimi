package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenFilePreservesNativePathAndAccessMode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "资料 #1%.db")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	writable, err := openFile(path, "rw")
	if err != nil {
		t.Fatal(err)
	}
	defer writable.Close()
	if _, err := writable.Exec("CREATE TABLE marker (value INTEGER); INSERT INTO marker VALUES (42)"); err != nil {
		t.Fatal(err)
	}

	source, err := openFile(path, "ro")
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	var value int
	if err := source.QueryRow("SELECT value FROM marker").Scan(&value); err != nil || value != 42 {
		t.Fatalf("read source value = %d, err = %v", value, err)
	}
	if _, err := source.Exec("DELETE FROM marker"); err == nil {
		t.Fatal("source allowed a write in read-only mode")
	}
}
