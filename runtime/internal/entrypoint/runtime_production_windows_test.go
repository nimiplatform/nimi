//go:build windows

package entrypoint

import (
	"errors"
	"testing"
)

func TestWindowsRuntimeStartupExitCodesAreStableAndUnique(t *testing.T) {
	stages := []windowsRuntimeStartupStage{
		windowsRuntimeStartupPrincipal,
		windowsRuntimeStartupSignerPolicy,
		windowsRuntimeStartupProcessTrust,
		windowsRuntimeStartupProgramData,
		windowsRuntimeStartupStateRoot,
		windowsRuntimeStartupSecurityState,
		windowsRuntimeStartupDesktopListener,
		windowsRuntimeStartupInstalledListener,
		windowsRuntimeStartupFixtureCustody,
		windowsRuntimeStartupConfiguration,
		windowsRuntimeStartupDaemon,
	}
	seen := make(map[uint32]struct{}, len(stages))
	for _, stage := range stages {
		code := windowsStartupExitCode(windowsStartupFailure(stage, errors.New("private startup detail")))
		if code != uint32(stage) || code <= uint32(windowsRuntimeStartupUnknown) {
			t.Fatalf("startup stage %x projected exit code %x", stage, code)
		}
		if _, exists := seen[code]; exists {
			t.Fatalf("duplicate startup exit code %x", code)
		}
		seen[code] = struct{}{}
	}
}

func TestWindowsRuntimeStartupExitCodeDoesNotDependOnRawFailureText(t *testing.T) {
	left := windowsStartupExitCode(windowsStartupFailure(windowsRuntimeStartupStateRoot, errors.New("first private detail")))
	right := windowsStartupExitCode(windowsStartupFailure(windowsRuntimeStartupStateRoot, errors.New("second private detail")))
	if left != right || left != uint32(windowsRuntimeStartupStateRoot) {
		t.Fatalf("state-root startup projection changed with raw error text: %x != %x", left, right)
	}
	if unknown := windowsStartupExitCode(errors.New("unclassified private detail")); unknown != uint32(windowsRuntimeStartupUnknown) {
		t.Fatalf("unclassified startup code = %x", unknown)
	}
}
