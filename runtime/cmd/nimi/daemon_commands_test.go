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
				ConfigPath:      "~/.nimi/config.json",
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
				Mode:       daemonctl.ModeStopped,
				Process:    "stopped",
				GRPCAddr:   "127.0.0.1:46371",
				ConfigPath: "~/.nimi/config.json",
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
				Mode:       daemonctl.ModeStopped,
				Process:    "stopped",
				GRPCAddr:   "127.0.0.1:46371",
				ConfigPath: "~/.nimi/config.json",
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
				ConfigPath:      "~/.nimi/config.json",
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
	if got := asString(payload["healthError"]); got != "dial failed" {
		t.Fatalf("status payload mismatch: %#v", payload)
	}
}

func TestRunRuntimeProviderTestRuntimeUnavailableHint(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:1")

	err := runRuntimeProvider([]string{"test", "openai"})
	if err == nil {
		t.Fatalf("expected provider test failure")
	}
	if !strings.Contains(err.Error(), "Run 'nimi start' for background mode, or 'nimi serve' in another terminal.") {
		t.Fatalf("unexpected provider test error: %v", err)
	}
}
