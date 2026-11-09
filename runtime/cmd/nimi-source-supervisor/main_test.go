package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestWaitForOwnedRuntimeExitPreservesProcessResult(t *testing.T) {
	for _, mode := range []string{"clean", "failed"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSourceRuntimeExitProcessHelper$")
			command.Env = append(os.Environ(), "NIMI_SOURCE_SUPERVISOR_EXIT_TEST_MODE="+mode)
			waitErr := command.Run()
			if command.ProcessState == nil {
				t.Fatalf("start isolated process: %v", waitErr)
			}
			exited := make(chan runtimeExit, 1)
			exited <- runtimeExit{err: waitErr, code: command.ProcessState.ExitCode()}
			err := waitForOwnedRuntimeExit(command, exited, nil, nil, nil)
			if mode == "clean" {
				if err != nil {
					t.Fatalf("normal process exit was reported as failure: %v", err)
				}
				return
			}
			var exitError *exec.ExitError
			if !errors.As(err, &exitError) || exitError.ExitCode() != 9 {
				t.Fatalf("abnormal process result was lost: %v", err)
			}
		})
	}
}

func TestSourceRuntimeExitProcessHelper(t *testing.T) {
	switch os.Getenv("NIMI_SOURCE_SUPERVISOR_EXIT_TEST_MODE") {
	case "clean":
		os.Exit(0)
	case "failed":
		os.Exit(9)
	}
}

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
	// Lock mutual exclusion is independent of launch admission. Production run
	// still validates its principal; native CI must exercise the actual lock.
	lockPath := testControlLockPath(t)
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
