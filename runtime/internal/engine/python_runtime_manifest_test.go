package engine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestManagedPythonOwnerManifestReusesReadOnlyVerifiedContentAndRefusesDrift(t *testing.T) {
	root := t.TempDir()
	interpreter := filepath.Join(root, "python.exe")
	if err := os.WriteFile(interpreter, []byte("explicit interpreter fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeManagedPythonRuntimeManifest(root, interpreter, ManagedPythonVersion); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(root, managedPythonRuntimeManifestFileName)
	defer os.Chmod(manifest, 0600)
	if err := os.Chmod(manifest, 0444); err != nil {
		t.Fatal(err)
	}
	if err := writeManagedPythonRuntimeManifest(root, interpreter, ManagedPythonVersion); err != nil {
		t.Fatalf("verified read-only manifest cannot be reused: %v", err)
	}
	if !verifyManagedPythonRuntimeManifest(root, interpreter) {
		t.Fatal("manifest not verified")
	}
	if err := os.WriteFile(interpreter, []byte("changed interpreter fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeManagedPythonRuntimeManifest(root, interpreter, ManagedPythonVersion); err == nil {
		t.Fatal("manifest was silently overwritten after content drift")
	}
	if verifyManagedPythonRuntimeManifest(root, interpreter) {
		t.Fatal("changed interpreter still verified")
	}
}
