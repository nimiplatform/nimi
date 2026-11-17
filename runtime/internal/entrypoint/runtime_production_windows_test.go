//go:build windows && !nimi_windows_source_local_development

package entrypoint

import (
	"errors"
	"testing"
	"time"

	"golang.org/x/sys/windows/svc"
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
		windowsRuntimeStartupLocalAppListener,
		windowsRuntimeStartupConfiguration,
		windowsRuntimeStartupDaemon,
		windowsRuntimeStartupInstance,
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

func TestWindowsRuntimeServiceStartIsCheckpointed(t *testing.T) {
	status := windowsRuntimeStartPendingStatus(7, 30*time.Second)
	if status.State != svc.StartPending || status.CheckPoint != 7 || status.WaitHint != 30_000 {
		t.Fatalf("start status = %#v", status)
	}
}

func TestWindowsRuntimeServiceStopIsCheckpointedAndBounded(t *testing.T) {
	done := make(chan error)
	statuses := make(chan svc.Status, 16)
	started := time.Now()
	serviceSpecific, code := waitForWindowsRuntimeServiceStop(done, statuses, started.Add(40*time.Millisecond), 5*time.Millisecond)
	if !serviceSpecific || code != windowsRuntimeServiceStopTimeoutCode {
		t.Fatalf("stop timeout outcome = (%v, %x)", serviceSpecific, code)
	}
	if elapsed := time.Since(started); elapsed < 30*time.Millisecond || elapsed > time.Second {
		t.Fatalf("bounded stop wait took %s", elapsed)
	}
	close(statuses)
	lastCheckpoint := uint32(0)
	lastHint := uint32(40)
	count := 0
	for status := range statuses {
		count++
		if status.State != svc.StopPending || status.CheckPoint <= lastCheckpoint || status.WaitHint > lastHint {
			t.Fatalf("stop status = %#v after checkpoint %d", status, lastCheckpoint)
		}
		lastCheckpoint = status.CheckPoint
		lastHint = status.WaitHint
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
			serviceSpecific, code := waitForWindowsRuntimeServiceStop(done, make(chan svc.Status, 1), time.Now().Add(time.Second), 100*time.Millisecond)
			if serviceSpecific || code != test.code {
				t.Fatalf("stop outcome = (%v, %d), want code %d", serviceSpecific, code, test.code)
			}
		})
	}
}

func TestWindowsRuntimeServiceStopStatusBackpressureDoesNotExtendDaemonDeadline(t *testing.T) {
	result := make(chan uint32, 1)
	deadline := time.Now().Add(30 * time.Millisecond)
	go func() {
		_, code := waitForWindowsRuntimeServiceStop(make(chan error), make(chan svc.Status), deadline, 5*time.Millisecond)
		result <- code
	}()
	select {
	case code := <-result:
		if code != windowsRuntimeServiceStopTimeoutCode {
			t.Fatalf("stop returned code %x", code)
		}
	case <-time.After(time.Second):
		t.Fatal("SCM status backpressure prevented bounded shutdown")
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
