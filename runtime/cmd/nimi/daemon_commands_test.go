package main

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/daemonctl"
)

type stubDaemonManager struct {
	startResult daemonctl.StartResult
	startErr    error
	stopResult  daemonctl.StopResult
	stopErr     error
	status      daemonctl.Status
	statusErr   error
	logsErr     error
}

func (s stubDaemonManager) Start(_ time.Duration) (daemonctl.StartResult, error) {
	return s.startResult, s.startErr
}

func (s stubDaemonManager) Stop(_ time.Duration) (daemonctl.StopResult, error) {
	return s.stopResult, s.stopErr
}

func (s stubDaemonManager) Status() (daemonctl.Status, error) {
	return s.status, s.statusErr
}

func (s stubDaemonManager) PrintLogs(_ context.Context, _ io.Writer, _ int, _ bool) error {
	return s.logsErr
}

func TestRunRuntimeStopRejectsForceBeforeControllerAccess(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		t.Fatal("removed --force must be rejected before accessing the service controller")
		return stubDaemonManager{}
	}
	t.Cleanup(func() { daemonManagerFactory = previousFactory })
	if err := runRuntimeStop([]string{"--force"}); err == nil || !strings.Contains(err.Error(), "flag provided but not defined") {
		t.Fatalf("expected unknown flag error, got %v", err)
	}
}

func TestRunRuntimeLogsRetainsGrammarAndReportsUnavailable(t *testing.T) {
	for _, args := range [][]string{nil, {"--tail", "1"}, {"-n", "1", "-f"}, {"--follow"}} {
		output, err := captureStdoutFromRun(func() error { return runRuntimeLogs(args) })
		if err == nil || err.Error() != "protected Runtime service logs are unavailable" || output != "" {
			t.Fatalf("logs %v: output=%q, error=%v", args, output, err)
		}
	}
}

func TestRuntimeDiagnosticsPropagateControllerFailure(t *testing.T) {
	failure := errors.New("controller unavailable")
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager { return stubDaemonManager{statusErr: failure} }
	t.Cleanup(func() { daemonManagerFactory = previousFactory })
	for _, run := range []func([]string) error{runRuntimeStatus, runRuntimeHealth, runRuntimeDoctor} {
		for _, args := range [][]string{nil, {"--json"}} {
			output, err := captureStdoutFromRun(func() error { return run(args) })
			if !errors.Is(err, failure) || output != "" {
				t.Fatalf("diagnostic must fail without a success projection: output=%q, error=%v", output, err)
			}
		}
	}
}

func TestRunRuntimeStatusPrintsProcessStatus(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{
			status: daemonctl.Status{
				Mode:          daemonctl.ModeProtectedService,
				Process:       "running",
				PID:           123,
				HealthSummary: "RUNTIME_HEALTH_STATUS_READY",
			},
		}
	}
	defer func() {
		daemonManagerFactory = previousFactory
	}()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeStatus(nil)
	})
	if err != nil {
		t.Fatalf("runRuntimeStatus: %v", err)
	}
	if !strings.Contains(output, "Nimi Runtime") || !strings.Contains(output, "process:") || !strings.Contains(output, "running") || !strings.Contains(output, "mode:") || !strings.Contains(output, "protected-service") {
		t.Fatalf("unexpected status output: %q", output)
	}
}

func TestRunRuntimeStatusStoppedPrintsNextStep(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{
			status: daemonctl.Status{
				Mode:    daemonctl.ModeStopped,
				Process: "stopped",
			},
		}
	}
	defer func() {
		daemonManagerFactory = previousFactory
	}()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeStatus(nil)
	})
	var exitErr cliExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("expected cliExitError, got %v", err)
	}
	if exitErr.ExitCode() != 1 {
		t.Fatalf("unexpected exit code: %d", exitErr.ExitCode())
	}
	if !strings.Contains(output, "Next") || !strings.Contains(output, "nimi start") {
		t.Fatalf("expected next-step hint in status output: %q", output)
	}
}

func TestRunRuntimeStatusReturnsStoppedExitCode(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{
			status: daemonctl.Status{
				Mode:    daemonctl.ModeStopped,
				Process: "stopped",
			},
		}
	}
	defer func() {
		daemonManagerFactory = previousFactory
	}()

	err := runRuntimeStatus([]string{"--json"})
	var exitErr cliExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("expected cliExitError, got %v", err)
	}
	if exitErr.ExitCode() != 1 {
		t.Fatalf("unexpected exit code: %d", exitErr.ExitCode())
	}
}

func TestRunRuntimeHealthReturnsDaemonStatusExitCode(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		status   daemonctl.Status
		wantCode int
	}{
		{
			name:     "plain stopped",
			status:   daemonctl.Status{Mode: daemonctl.ModeStopped, Process: "stopped"},
			wantCode: 1,
		},
		{
			name:     "json stopped",
			args:     []string{"--json"},
			status:   daemonctl.Status{Mode: daemonctl.ModeStopped, Process: "stopped"},
			wantCode: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			previousFactory := daemonManagerFactory
			daemonManagerFactory = func() daemonManager {
				return stubDaemonManager{status: tt.status}
			}
			defer func() {
				daemonManagerFactory = previousFactory
			}()

			_, err := captureStdoutFromRun(func() error {
				return runRuntimeHealth(tt.args)
			})
			var exitErr cliExitError
			if !errors.As(err, &exitErr) {
				t.Fatalf("expected cliExitError, got %v", err)
			}
			if exitErr.ExitCode() != tt.wantCode {
				t.Fatalf("exit code = %d, want %d", exitErr.ExitCode(), tt.wantCode)
			}
		})
	}
}

func TestRunRuntimeStartProtectedServiceOmitsLegacyTransportFields(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{
			startResult: daemonctl.StartResult{
				Mode:          daemonctl.ModeProtectedService,
				PID:           426,
				Version:       "test",
				HealthSummary: "protected-service-running",
			},
		}
	}
	defer func() {
		daemonManagerFactory = previousFactory
	}()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeStart(nil)
	})
	if err != nil {
		t.Fatalf("runRuntimeStart: %v", err)
	}
	if !strings.Contains(output, "protected-service") || !strings.Contains(output, "426") {
		t.Fatalf("unexpected protected service start output: %q", output)
	}
	for _, legacyField := range []string{"grpc:", "config:", "logs:"} {
		if strings.Contains(output, legacyField) {
			t.Fatalf("protected service start output must omit %s: %q", legacyField, output)
		}
	}
}

func TestRunRuntimeDoctorProtectedServiceUsesSanitizedServiceState(t *testing.T) {
	setCmdTestHome(t, t.TempDir())
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", cmdTestPortableConfigPath(t.TempDir()))
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:1")

	statusCalls := 0
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		statusCalls++
		return stubDaemonManager{status: daemonctl.Status{
			Mode:    daemonctl.ModeProtectedService,
			Process: "running",
		}}
	}
	defer func() {
		daemonManagerFactory = previousFactory
	}()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeDoctor(nil)
	})
	if err != nil {
		t.Fatalf("runRuntimeDoctor: %v", err)
	}
	if !strings.Contains(output, "daemon:") || !strings.Contains(output, publicDaemonHealthServiceRunning) {
		t.Fatalf("missing sanitized protected-service state: %q", output)
	}
	if strings.Contains(output, "Run 'nimi start'") || strings.Contains(output, "\nNext\n\n  nimi start\n") {
		t.Fatalf("protected-service advice must not recommend nimi start: %q", output)
	}
	for _, privateTransport := range []string{"gRPC health probe", "127.0.0.1:1", "service logs"} {
		if strings.Contains(output, privateTransport) {
			t.Fatalf("doctor exposed retired private transport detail %q: %q", privateTransport, output)
		}
	}
	if !strings.Contains(output, "runtime mode:") || !strings.Contains(output, daemonctl.ModeProtectedService.String()) {
		t.Fatalf("missing protected-service runtime mode: %q", output)
	}
	if statusCalls != 1 {
		t.Fatalf("doctor status provider calls = %d, want 1", statusCalls)
	}
}
