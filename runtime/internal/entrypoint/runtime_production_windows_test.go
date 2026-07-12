//go:build windows

package entrypoint

import (
	"context"
	"errors"
	"testing"
	"time"

	"golang.org/x/sys/windows/svc"
)

type recordingWindowsRuntimeStopper struct{ calls int }

func (stopper *recordingWindowsRuntimeStopper) EmergencyStopSupervisedEngines() { stopper.calls++ }

type recordingWindowsRuntimeCloser struct{ calls int }

func (closer *recordingWindowsRuntimeCloser) Close() error {
	closer.calls++
	return nil
}

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

func TestWindowsRuntimeServiceStopIsCheckpointedAndBounded(t *testing.T) {
	done := make(chan error)
	statuses := make(chan svc.Status, 16)
	started := time.Now()
	serviceSpecific, code := waitForWindowsRuntimeServiceStop(done, statuses, 40*time.Millisecond, 5*time.Millisecond)
	if !serviceSpecific || code != windowsRuntimeServiceStopTimeoutCode {
		t.Fatalf("stop timeout outcome = (%v, %x)", serviceSpecific, code)
	}
	if elapsed := time.Since(started); elapsed < 30*time.Millisecond || elapsed > time.Second {
		t.Fatalf("bounded stop wait took %s", elapsed)
	}
	close(statuses)
	lastCheckpoint := uint32(1)
	count := 0
	for status := range statuses {
		count++
		if status.State != svc.StopPending || status.CheckPoint <= lastCheckpoint || status.WaitHint != 40 {
			t.Fatalf("stop status = %#v after checkpoint %d", status, lastCheckpoint)
		}
		lastCheckpoint = status.CheckPoint
	}
	if count == 0 {
		t.Fatal("bounded stop wait emitted no SCM checkpoints")
	}
}

func TestWindowsRuntimeServiceStopPreservesDaemonOutcome(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code uint32
	}{
		{name: "clean", code: 0},
		{name: "failure", err: errors.New("daemon shutdown failed"), code: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			done := make(chan error, 1)
			done <- test.err
			serviceSpecific, code := waitForWindowsRuntimeServiceStop(done, make(chan svc.Status, 1), time.Second, 100*time.Millisecond)
			if serviceSpecific || code != test.code {
				t.Fatalf("stop outcome = (%v, %d), want code %d", serviceSpecific, code, test.code)
			}
		})
	}
}

func TestWindowsRuntimeServiceStopCancelsAndClosesOwnedRuntimeResources(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	stopper := &recordingWindowsRuntimeStopper{}
	installed := &recordingWindowsRuntimeCloser{}
	desktop := &recordingWindowsRuntimeCloser{}
	initiateWindowsRuntimeServiceStop(cancel, stopper, installed, desktop)
	if ctx.Err() != context.Canceled {
		t.Fatalf("service stop context = %v", ctx.Err())
	}
	if stopper.calls != 1 || installed.calls != 1 || desktop.calls != 1 {
		t.Fatalf("service stop calls = stopper:%d installed:%d desktop:%d", stopper.calls, installed.calls, desktop.calls)
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
