//go:build windows

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
	registry := filepath.Join(resourcesRoot, "nimi-app-registry.yaml")
	descriptors := filepath.Join(resourcesRoot, "nimi-app-release-descriptors.yaml")
	for path, body := range map[string]string{
		executable:  "synthetic signed runtime",
		registry:    "version: 1\n",
		descriptors: "version: 1\n",
	} {
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	gotRegistry, gotBundled, err := resolveWindowsProtectedPlatformAppResources(executable, programFiles)
	if err != nil {
		t.Fatalf("resolve fixed Platform resources: %v", err)
	}
	if gotRegistry != registry || gotBundled != filepath.Join(resourcesRoot, "nimi-apps") {
		t.Fatalf("resolved resources = (%q, %q)", gotRegistry, gotBundled)
	}

	outside := filepath.Join(t.TempDir(), "nimi.exe")
	if err := os.WriteFile(outside, []byte("synthetic signed runtime"), 0o600); err != nil {
		t.Fatal(err)
	}
	if outsideRegistry, outsideBundled, err := resolveWindowsProtectedPlatformAppResources(outside, programFiles); err != nil || outsideRegistry != "" || outsideBundled != "" {
		t.Fatalf("outside Program Files resources = (%q, %q, %v), want fail-closed absence", outsideRegistry, outsideBundled, err)
	}

	if err := os.Remove(descriptors); err != nil {
		t.Fatal(err)
	}
	if _, _, err := resolveWindowsProtectedPlatformAppResources(executable, programFiles); err == nil {
		t.Fatal("partial Platform catalog pair was accepted")
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
	if err := os.WriteFile(filepath.Join(outside, "nimi-app-registry.yaml"), []byte("version: 1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "nimi-app-release-descriptors.yaml"), []byte("version: 1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(installRoot, "resources")); err != nil {
		t.Skipf("Windows symlink privilege unavailable: %v", err)
	}
	if _, _, err := resolveWindowsProtectedPlatformAppResources(executable, programFiles); err == nil {
		t.Fatal("reparse-point Platform resources were accepted")
	}
}
