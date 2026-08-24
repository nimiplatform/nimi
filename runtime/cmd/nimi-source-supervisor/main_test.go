package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestReplaceEnvironmentReplacesCaseInsensitively(t *testing.T) {
	environment := replaceEnvironment([]string{"Path=one", "OTHER=two", "PATH=three"}, "PATH", "four")
	if got := strings.Join(environment, "|"); got != "OTHER=two|PATH=four" {
		t.Fatalf("environment = %q", got)
	}
}

func TestCanonicalDirectoryRejectsRelativePath(t *testing.T) {
	if _, err := canonicalDirectory("runtime"); err == nil {
		t.Fatal("relative workspace root was admitted")
	}
}

func TestSourceRuntimeEnvironmentSeparatesOwnerAndDesktop(t *testing.T) {
	config := supervisorConfig{
		runtimePath:     filepath.Join(t.TempDir(), "nimi"),
		desktopPath:     filepath.Join(t.TempDir(), "desktop"),
		supervisorPath:  filepath.Join(t.TempDir(), "supervisor"),
		realmURL:        sourceRuntimeRealmURL,
		platformProfile: runtime.GOOS,
	}
	environment := sourceRuntimeEnvironment(config)
	joined := strings.Join(environment, "\n")
	if runtime.GOOS == "windows" {
		for _, name := range []string{
			"NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE=" + config.runtimePath,
			"NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_DESKTOP_EXECUTABLE=" + config.desktopPath,
			"NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_SUPERVISOR_EXECUTABLE=" + config.supervisorPath,
		} {
			if !strings.Contains(joined, name) {
				t.Fatalf("source Runtime environment is missing %q", name)
			}
		}
	}
}

func TestSourceRuntimeOwnerLockIsAtomic(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "darwin" {
		t.Skip("source Runtime owner lock is platform-native")
	}
	if err := validateSourceSupervisorPrincipal(); err != nil {
		t.Skipf("current test principal is not admitted: %v", err)
	}
	lockPath := filepath.Join(t.TempDir(), "source-runtime-supervisor.lock")
	first, err := acquireSourceRuntimeOwnerLock(lockPath)
	if err != nil {
		t.Fatalf("acquire first owner lock: %v", err)
	}
	defer func() { _ = first.Close() }()
	second, err := acquireSourceRuntimeOwnerLock(lockPath)
	if err == nil {
		_ = second.Close()
		t.Fatal("second source Runtime owner lock was admitted")
	}
	if !strings.Contains(err.Error(), errSourceRuntimeAlreadyOwned.Error()) {
		t.Fatalf("second owner failure = %v", err)
	}
}

func TestCanonicalExecutableAcceptsCurrentTestBinary(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := canonicalExecutable(executable); err != nil {
		t.Fatalf("canonical current executable: %v", err)
	}
}
