package app

import (
	"errors"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLocalDevelopmentHostExecutableAllowsOnlyExactElectronAliasTarget(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	electronTarget := filepath.Join(t.TempDir(), "pnpm-store", "electron.exe")
	rogueTarget := filepath.Join(t.TempDir(), "rogue", "electron.exe")

	selected, err := validateCanonicalLocalDevelopmentHostExecutable(
		root,
		electronTarget,
		electronTarget,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	)
	if err != nil || selected != electronTarget {
		t.Fatalf("exact Electron project alias target must be admitted, got %q, %v", selected, err)
	}
	if _, err := validateCanonicalLocalDevelopmentHostExecutable(
		root,
		rogueTarget,
		electronTarget,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	); !errors.Is(err, errLocalDevelopmentProjectChanged) {
		t.Fatalf("unrelated external executable must remain rejected, got %v", err)
	}
}

func TestLocalDevelopmentHostExecutableKeepsTauriInsideProjectOutput(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	projectTarget := filepath.Join(root, "src-tauri", "target", "debug", "sample.exe")
	externalTarget := filepath.Join(t.TempDir(), "outside", "sample.exe")

	selected, err := validateCanonicalLocalDevelopmentHostExecutable(
		root,
		projectTarget,
		"",
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI,
	)
	if err != nil || selected != projectTarget {
		t.Fatalf("Tauri project build output must be admitted, got %q, %v", selected, err)
	}
	if _, err := validateCanonicalLocalDevelopmentHostExecutable(
		root,
		externalTarget,
		"",
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI,
	); !errors.Is(err, errLocalDevelopmentProjectChanged) {
		t.Fatalf("external Tauri executable must remain rejected, got %v", err)
	}
}
