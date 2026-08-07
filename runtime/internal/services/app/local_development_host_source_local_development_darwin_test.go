//go:build darwin && nimi_macos_source_local_development

package app

import (
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestSourceLocalDevelopmentLocalDevelopmentHostUsesExactCurrentUserExecutable(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(macOSSourceLocalDevelopmentHostExecutableEnvironment, executable)
	host, err := localDevelopmentHostExecutable(localDevelopmentProjectSnapshot{
		ShellKind: runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	})
	if err != nil {
		t.Fatalf("resolve source local development host: %v", err)
	}
	if host != executable {
		t.Fatalf("host = %q, want %q", host, executable)
	}
}
