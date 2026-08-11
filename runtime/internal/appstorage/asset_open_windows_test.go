//go:build windows

package appstorage

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestCommittedAssetOpenAllowsAtomicReplacementWhilePinned(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.asset")
	candidate := filepath.Join(root, "candidate.asset")
	if err := os.WriteFile(target, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(candidate, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	pinned, err := openCommittedAssetFile(target)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pinned.Close() }()
	if err := replaceLocalAppJSONFile(candidate, target); err != nil {
		t.Fatalf("replace pinned committed asset: %v", err)
	}
	payload, err := io.ReadAll(pinned)
	if err != nil || string(payload) != "old" {
		t.Fatalf("pinned payload=%q err=%v", payload, err)
	}
	current, err := os.ReadFile(target)
	if err != nil || string(current) != "new" {
		t.Fatalf("current payload=%q err=%v", current, err)
	}
}
