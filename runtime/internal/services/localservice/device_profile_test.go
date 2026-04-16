package localservice

import (
	"context"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

func TestProbePythonProfileSkipsWindowsStoreAlias(t *testing.T) {
	originalGOOS := localRuntimeGOOS
	originalLookPath := localRuntimeLookPath
	originalCommand := localRuntimeCommand
	t.Cleanup(func() {
		localRuntimeGOOS = originalGOOS
		localRuntimeLookPath = originalLookPath
		localRuntimeCommand = originalCommand
	})

	localRuntimeGOOS = "windows"
	commandName := "cmd"
	commandArgs := func(script string) []string {
		return []string{"/c", script}
	}
	if runtime.GOOS != "windows" {
		commandName = "sh"
		commandArgs = func(script string) []string {
			return []string{"-c", script}
		}
	}
	localRuntimeLookPath = func(name string) (string, error) {
		switch name {
		case "python":
			return `C:\Python313\python.exe`, nil
		case "python3":
			return `C:\Users\Eric\AppData\Local\Microsoft\WindowsApps\python3.exe`, nil
		default:
			return "", exec.ErrNotFound
		}
	}
	aliasCalled := false
	localRuntimeCommand = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		if shouldSkipPythonExecutable(name) {
			aliasCalled = true
			return exec.CommandContext(ctx, commandName, commandArgs("exit 1")...)
		}
		return exec.CommandContext(ctx, commandName, commandArgs("echo Python 3.13.0")...)
	}

	profile := probePythonProfile()
	if !profile.GetAvailable() {
		t.Fatalf("expected python profile to be available: %#v", profile)
	}
	if strings.Trim(profile.GetVersion(), "\"") != "Python 3.13.0" {
		t.Fatalf("unexpected python version: %q", profile.GetVersion())
	}
	if aliasCalled {
		t.Fatal("windows store python alias should have been skipped")
	}
}
