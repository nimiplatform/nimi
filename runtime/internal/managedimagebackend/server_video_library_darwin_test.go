//go:build darwin && arm64 && cgo

package managedimagebackend

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestVerifyMacOSProductVideoLibraryRequiresExactBundledBytes(t *testing.T) {
	directory := t.TempDir()
	library := filepath.Join(directory, macOSVideoLibraryName)
	payload := []byte("signed library bytes")
	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	if err := os.WriteFile(library, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := verifyMacOSProductVideoLibrary(library, digest); err != nil {
		t.Fatalf("exact bundled bytes: %v", err)
	}
	link := filepath.Join(directory, "redirected.dylib")
	if err := os.Symlink(library, link); err != nil {
		t.Fatal(err)
	}
	if err := verifyMacOSProductVideoLibrary(link, digest); err == nil {
		t.Fatal("accepted a redirected library path")
	}
	if err := os.WriteFile(library, []byte("different library bytes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := verifyMacOSProductVideoLibrary(library, digest); err == nil {
		t.Fatal("accepted modified library bytes")
	}
}
