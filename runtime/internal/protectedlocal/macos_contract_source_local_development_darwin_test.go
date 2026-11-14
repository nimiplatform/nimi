//go:build darwin && nimi_macos_source_local_development

package protectedlocal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMacOSSourceLocalDevelopmentContractHasNoPrivilegedTopology(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	realm := os.Getenv("NIMI_DEV_REALM")
	if realm == "" {
		realm = "official"
	}
	base := filepath.Join(home, "Library", "Application Support", "Nimi", "RuntimeLocalDevelopment")
	expectedRoot := filepath.Join(base, realm)
	if MacOSRuntimeStateRoot != expectedRoot {
		t.Fatalf("state root = %q, want %q", MacOSRuntimeStateRoot, expectedRoot)
	}
	if want := filepath.Join(base, "run", "runtime-desktop.sock"); MacOSDesktopSocketPath != want {
		t.Fatalf("desktop socket = %q, want %q", MacOSDesktopSocketPath, want)
	}
	if want := filepath.Join(base, "run", "runtime-local-app.sock"); MacOSLocalAppSocketPath != want {
		t.Fatalf("local-app socket = %q, want %q", MacOSLocalAppSocketPath, want)
	}
	for label, value := range map[string]string{
		"state":              MacOSRuntimeStateRoot,
		"desktop socket":     MacOSDesktopSocketPath,
		"local-app socket":   MacOSLocalAppSocketPath,
		"runtime executable": MacOSRuntimeExecutablePath,
	} {
		if strings.HasPrefix(value, "/Library/") || strings.HasPrefix(value, "/Applications/") ||
			strings.HasPrefix(value, "/private/var/run/") {
			t.Fatalf("%s retained privileged topology: %q", label, value)
		}
	}
	if MacOSRuntimeAccountName != "" || MacOSDesktopExecutablePath != "" || MacOSLocalAppHostPath != "" {
		t.Fatal("source local development retained a fixed account, Desktop, or Host path")
	}
}
