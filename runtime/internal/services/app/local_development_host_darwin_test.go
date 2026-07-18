//go:build darwin

package app

import (
	"errors"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestMacOSLocalDevelopmentHostNeverUsesProjectElectron(t *testing.T) {
	projectRoot := filepath.Join(t.TempDir(), "project")
	projectElectron := filepath.Join(projectRoot, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
	if validLocalDevelopmentHostPath(projectRoot, projectElectron, runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON) {
		t.Fatal("macOS local development must never admit a project-owned Electron executable")
	}
	if alias := localDevelopmentProjectHostAliasPath(projectRoot, runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON); alias != "" {
		t.Fatalf("macOS launch policy leaked a project host alias: %q", alias)
	}
}

func TestMacOSLocalDevelopmentHostIsFixedOrUnavailable(t *testing.T) {
	project := localDevelopmentProjectSnapshot{ProjectRoot: filepath.Join(t.TempDir(), "project"), ShellKind: runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON}
	host, err := localDevelopmentHostExecutable(project)
	if err == nil && host != protectedlocal.MacOSLocalAppHostPath {
		t.Fatalf("macOS resolved non-fixed host: %q", host)
	}
	if err != nil && !errors.Is(err, errLocalDevelopmentProjectChanged) {
		t.Fatalf("macOS fixed host unavailable error = %v", err)
	}
	project.ShellKind = runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI
	if _, err := localDevelopmentHostExecutable(project); !errors.Is(err, errLocalDevelopmentProjectChanged) {
		t.Fatalf("macOS Tauri must remain fail-closed, got %v", err)
	}
}
