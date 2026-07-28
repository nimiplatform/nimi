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
	identityProjection := filepath.Join(resourcesRoot, "nimi-app-identity-surfaces.yaml")
	for path, body := range map[string]string{
		executable:         "synthetic signed runtime",
		identityProjection: "version: 1\n",
	} {
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	gotIdentityProjection, gotBundled, err := resolveWindowsProtectedPlatformAppResources(executable, programFiles)
	if err != nil {
		t.Fatalf("resolve fixed Platform resources: %v", err)
	}
	if gotIdentityProjection != identityProjection || gotBundled != filepath.Join(resourcesRoot, "nimi-apps") {
		t.Fatalf("resolved resources = (%q, %q)", gotIdentityProjection, gotBundled)
	}

	outside := filepath.Join(t.TempDir(), "nimi.exe")
	if err := os.WriteFile(outside, []byte("synthetic signed runtime"), 0o600); err != nil {
		t.Fatal(err)
	}
	if outsideIdentityProjection, outsideBundled, err := resolveWindowsProtectedPlatformAppResources(outside, programFiles); err != nil || outsideIdentityProjection != "" || outsideBundled != "" {
		t.Fatalf("outside Program Files resources = (%q, %q, %v), want fail-closed absence", outsideIdentityProjection, outsideBundled, err)
	}

	if err := os.Remove(identityProjection); err != nil {
		t.Fatal(err)
	}
	if missingIdentityProjection, bundledRoot, err := resolveWindowsProtectedPlatformAppResources(executable, programFiles); err != nil || missingIdentityProjection != "" || bundledRoot != "" {
		t.Fatalf("missing identity projection resources = (%q, %q, %v), want fail-closed absence", missingIdentityProjection, bundledRoot, err)
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
	if err := os.WriteFile(filepath.Join(outside, "nimi-app-identity-surfaces.yaml"), []byte("version: 1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(installRoot, "resources")); err != nil {
		t.Skipf("Windows symlink privilege unavailable: %v", err)
	}
	if _, _, err := resolveWindowsProtectedPlatformAppResources(executable, programFiles); err == nil {
		t.Fatal("reparse-point Platform resources were accepted")
	}
}
