//go:build windows

package engine

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerifyPythonImportProbeUsesShortLaunchAlias(t *testing.T) {
	pythonPath, _ := pythonWithProtectedModeDirectories(t)
	venvRoot := filepath.Join(t.TempDir(), "managed python launch path with spaces")
	for len(managedPythonPath(venvRoot)) < 150 {
		venvRoot = filepath.Join(venvRoot, "managed python launch segment")
	}
	if len(managedPythonPath(venvRoot)) >= windowsLegacyMaxPath {
		t.Fatalf("test interpreter path length = %d, want below %d", len(managedPythonPath(venvRoot)), windowsLegacyMaxPath)
	}
	command := exec.Command(pythonPath, "-m", "venv", "--without-pip", venvRoot)
	if output, err := command.CombinedOutput(); err != nil {
		t.Skipf("Python venv integration fixture is unavailable: %v (%s)", err, strings.TrimSpace(string(output)))
	}

	interpreterPath := managedPythonPath(venvRoot)
	shortPath, ok := windowsShortCommandPath(interpreterPath)
	if !ok || len(shortPath) >= len(interpreterPath) {
		t.Skip("volume does not expose a shorter 8.3 alias for the managed interpreter")
	}
	if got := managedCommandPreferredPath(interpreterPath); got != shortPath {
		t.Fatalf("managed Python launch path = %q, want %q", got, shortPath)
	}

	module := "nimi_" + strings.Repeat("long_path_probe_", 7)
	moduleInit := filepath.Join(venvRoot, "Lib", "site-packages", module, "__init__.py")
	if len(moduleInit) < windowsLegacyMaxPath {
		t.Fatalf("test module path length = %d, want at least %d", len(moduleInit), windowsLegacyMaxPath)
	}
	if err := os.MkdirAll(filepath.Dir(moduleInit), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(moduleInit, []byte("READY = True\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := verifyPythonImportProbe(context.Background(), venvRoot, interpreterPath, module); err != nil {
		t.Fatalf("verify long-path Python import through short launch alias: %v", err)
	}
}
