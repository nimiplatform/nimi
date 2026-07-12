package app

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func createLocalDevelopmentDirectoryLink(t *testing.T, target string, link string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		output, err := exec.Command("cmd.exe", "/d", "/c", "mklink", "/J", link, target).CombinedOutput()
		if err != nil {
			t.Fatalf("create directory junction: %v: %s", err, output)
		}
		return
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("create directory symlink: %v", err)
	}
}

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

func TestCanonicalLocalDevelopmentHostExecutableAllowsProjectElectronAliasIntoPackageStore(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	aliasParent := filepath.Join(root, "node_modules")
	storePackage := filepath.Join(t.TempDir(), "pnpm-store", "electron")
	storeExecutable := filepath.Join(storePackage, "dist", "electron.exe")
	if err := os.MkdirAll(aliasParent, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(storeExecutable), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(storeExecutable, []byte("electron fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	createLocalDevelopmentDirectoryLink(t, storePackage, filepath.Join(aliasParent, "electron"))
	aliasExecutable := filepath.Join(aliasParent, "electron", "dist", "electron.exe")
	if _, err := os.Stat(aliasExecutable); err != nil {
		t.Fatalf("stat Electron project alias: %v", err)
	}

	selected, err := canonicalLocalDevelopmentHostExecutable(
		root,
		aliasExecutable,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	)
	if err != nil {
		t.Fatalf("canonical Electron project alias target must be admitted: %v", err)
	}
	want, err := canonicalLocalDevelopmentFilePath(storeExecutable)
	if err != nil {
		t.Fatal(err)
	}
	if !sameLocalDevelopmentPath(selected, want) {
		t.Fatalf("selected = %q, want exact package-store target %q", selected, want)
	}
}
