package nimiapppackage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInstalledEntryUsesOnlyExactCommittedPath(t *testing.T) {
	root := t.TempDir()
	expected := expectedPackage(nil)
	entry := filepath.Join(root, filepath.FromSlash(expected.RuntimeEntry))
	if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte("host bytes checked by native verifier"), 0o600); err != nil {
		t.Fatal(err)
	}
	// No manifest or other payload file is required to resolve an installed entry.
	if actual, err := ResolveInstalledRuntimeEntry(root, expected); err != nil || actual != entry {
		t.Fatalf("entry=%s err=%v", actual, err)
	}
	for _, invalid := range []string{"../outside.exe", "payload/../outside.exe", "payload/missing.exe", "payload"} {
		t.Run(invalid, func(t *testing.T) {
			modified := expected
			modified.RuntimeEntry = invalid
			if _, err := ResolveInstalledRuntimeEntry(root, modified); err == nil {
				t.Fatal("invalid entry accepted")
			}
		})
	}
	if err := os.WriteFile(entry, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveInstalledRuntimeEntry(root, expected); err == nil {
		t.Fatal("empty entry accepted")
	}
}
