package main

import (
	"context"
	"encoding/json"
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

func (s stubDaemonManager) Stop(_ time.Duration, _ bool) (daemonctl.StopResult, error) {
	return s.stopResult, s.stopErr
}

func (s stubDaemonManager) Status() (daemonctl.Status, error) {
	return s.status, s.statusErr
}

func (s stubDaemonManager) PrintLogs(_ context.Context, _ io.Writer, _ int, _ bool) error {
	return s.logsErr
}

func TestRunRuntimeStatusPrintsProcessStatus(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{
			status: daemonctl.Status{
				Mode:            daemonctl.ModeExternal,
				Process:         "running",
				PID:             123,
				GRPCAddr:        "127.0.0.1:46371",
				HealthSummary:   "RUNTIME_HEALTH_STATUS_READY",
				HealthReachable: true,
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
	if !strings.Contains(output, "Nimi Runtime") || !strings.Contains(output, "process:") || !strings.Contains(output, "running") || !strings.Contains(output, "mode:") || !strings.Contains(output, "external") {
		t.Fatalf("unexpected status output: %q", output)
	}
}

func TestRunRuntimeStatusStoppedPrintsNextStep(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{
			status: daemonctl.Status{
				Mode:     daemonctl.ModeStopped,
				Process:  "stopped",
				GRPCAddr: "127.0.0.1:46371",
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
				Mode:     daemonctl.ModeStopped,
				Process:  "stopped",
				GRPCAddr: "127.0.0.1:46371",
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

func TestRunRuntimeStatusReturnsUnreachableExitCode(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{
			status: daemonctl.Status{
				Mode:            daemonctl.ModeBackground,
				Process:         "running",
				PID:             124,
				GRPCAddr:        "127.0.0.1:46371",
				HealthSummary:   "unreachable",
				HealthReachable: false,
				HealthError:     "dial failed",
			},
		}
	}
	defer func() {
		daemonManagerFactory = previousFactory
	}()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeStatus([]string{"--json"})
	})
	var exitErr cliExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("expected cliExitError, got %v", err)
	}
	if exitErr.ExitCode() != 2 {
		t.Fatalf("unexpected exit code: %d", exitErr.ExitCode())
	}
	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal status output: %v output=%q", unmarshalErr, output)
	}
	if got := asString(payload["health"]); got != publicDaemonHealthUnreachable {
		t.Fatalf("status payload mismatch: %#v", payload)
	}
	for _, privateDetail := range []string{"healthError", "dial failed", "grpc", "config", "logPath"} {
		if strings.Contains(output, privateDetail) {
			t.Fatalf("status payload exposed private detail %q: %s", privateDetail, output)
		}
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
			name: "plain unreachable",
			status: daemonctl.Status{
				Mode:            daemonctl.ModeBackground,
				Process:         "running",
				HealthReachable: false,
			},
			wantCode: 2,
		},
		{
			name:     "json stopped",
			args:     []string{"--json"},
			status:   daemonctl.Status{Mode: daemonctl.ModeStopped, Process: "stopped"},
			wantCode: 1,
		},
		{
			name: "json unreachable",
			args: []string{"--json"},
			status: daemonctl.Status{
				Mode:            daemonctl.ModeBackground,
				Process:         "running",
				HealthReachable: false,
			},
			wantCode: 2,
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
