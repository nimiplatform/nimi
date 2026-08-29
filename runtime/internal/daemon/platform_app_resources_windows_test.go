//go:build windows && !nimi_windows_source_local_development

package daemon

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveWindowsProtectedPlatformAppResources(t *testing.T) {
	programFiles := t.TempDir()
	installRoot := filepath.Join(programFiles, "Nimi")
	resourcesRoot := filepath.Join(installRoot, "resources")
	if err := os.MkdirAll(filepath.Join(resourcesRoot, "nimi-apps"), 0o755); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(installRoot, "nimi.exe")
	if err := os.WriteFile(executable, []byte("synthetic signed runtime"), 0o600); err != nil {
		t.Fatal(err)
	}

	gotBundled, err := resolveWindowsProtectedPlatformAppResources(executable, programFiles)
	if err != nil {
		t.Fatalf("resolve fixed Platform resources: %v", err)
	}
	if gotBundled != filepath.Join(resourcesRoot, "nimi-apps") {
		t.Fatalf("resolved bundled Apps root = %q", gotBundled)
	}

	outside := filepath.Join(t.TempDir(), "nimi.exe")
	if err := os.WriteFile(outside, []byte("synthetic signed runtime"), 0o600); err != nil {
		t.Fatal(err)
	}
	if outsideBundled, err := resolveWindowsProtectedPlatformAppResources(outside, programFiles); err != nil || outsideBundled != "" {
		t.Fatalf("outside Program Files bundled Apps root = (%q, %v), want fail-closed absence", outsideBundled, err)
	}

	if err := os.RemoveAll(filepath.Join(resourcesRoot, "nimi-apps")); err != nil {
		t.Fatal(err)
	}
	if bundledRoot, err := resolveWindowsProtectedPlatformAppResources(executable, programFiles); err == nil || bundledRoot != "" {
		t.Fatalf("missing bundled Apps root = (%q, %v), want fail-closed error", bundledRoot, err)
	}
}

func TestResolveWindowsProtectedPlatformAppResourcesRejectsReparse(t *testing.T) {
	programFiles := t.TempDir()
	installRoot := filepath.Join(programFiles, "Nimi")
	if err := os.MkdirAll(installRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(installRoot, "nimi.exe")
	if err := os.WriteFile(executable, []byte("synthetic signed runtime"), 0o600); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(outside, "nimi-apps"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(installRoot, "resources")); err != nil {
		t.Skipf("Windows symlink privilege unavailable: %v", err)
	}
	if _, err := resolveWindowsProtectedPlatformAppResources(executable, programFiles); err == nil {
		t.Fatal("reparse-point Platform resources were accepted")
	}
}
