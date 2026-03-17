package engine

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func setSupervisorTestHome(t *testing.T) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
}

func writeTestScript(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test-engine.sh")
	content := "#!/bin/sh\n" + body + "\n"
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("write test script: %v", err)
	}
	return path
}

func testSupervisorCfg(scriptPath string) EngineConfig {
	return EngineConfig{
		Kind:             EngineLlama,
		BinaryPath:       scriptPath,
		Port:             0,
		Version:          "test",
		HealthPath:       "/readyz",
		StartupTimeout:   500 * time.Millisecond,
		HealthInterval:   100 * time.Millisecond,
		MaxRestarts:      2,
		RestartBaseDelay: 50 * time.Millisecond,
		ShutdownTimeout:  time.Second,
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func waitForStatus(sup *Supervisor, want EngineStatus, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if sup.Status() == want {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return sup.Status() == want
}

func waitForCondition(timeout time.Duration, check func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if check() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return check()
}

func testProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}

func TestSupervisorStartStop(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	script := writeTestScript(t, "sleep 60")
	cfg := testSupervisorCfg(script)
	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = sup.Stop() }()

	info := sup.Info()
	if info.PID <= 0 {
		t.Errorf("expected PID > 0, got %d", info.PID)
	}
	if info.Status != StatusStarting && info.Status != StatusUnhealthy && info.Status != StatusHealthy {
		t.Errorf("expected status starting/unhealthy/healthy, got %s", info.Status)
	}

	pid := info.PID
	if err := sup.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if sup.Status() != StatusStopped {
		t.Errorf("expected status stopped after Stop, got %s", sup.Status())
	}

	time.Sleep(50 * time.Millisecond)
	if testProcessAlive(pid) {
		t.Errorf("expected process %d to be dead after Stop", pid)
	}
}

func TestSupervisorStartAlreadyRunning(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	script := writeTestScript(t, "sleep 60")
	cfg := testSupervisorCfg(script)
	cfg.StartupTimeout = 5 * time.Second
	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx := context.Background()
	errCh := make(chan error, 1)
	go func() {
		errCh <- sup.Start(ctx)
	}()
	defer func() { _ = sup.Stop() }()

	if !waitForStatus(sup, StatusStarting, 3*time.Second) {
		t.Fatal("timed out waiting for starting status")
	}

	err := sup.Start(ctx)
	if err == nil {
		t.Fatal("expected error for already running, got nil")
	}
	if !strings.Contains(err.Error(), "already running") {
		t.Errorf("expected 'already running' error, got: %v", err)
	}

	<-errCh
}

func TestSupervisorCrashRestart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	runLogPath := filepath.Join(t.TempDir(), "runs.log")
	script := writeTestScript(t, "echo run >> "+runLogPath+"\nsleep 0.05\nexit 1")
	cfg := testSupervisorCfg(script)
	cfg.MaxRestarts = 10
	cfg.HealthInterval = 500 * time.Millisecond
	cfg.RestartBaseDelay = 10 * time.Millisecond
	cfg.StartupTimeout = 200 * time.Millisecond

	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = sup.Stop() }()

	if !waitForCondition(30*time.Second, func() bool {
		data, err := os.ReadFile(runLogPath)
		if err != nil {
			return false
		}
		return strings.Count(string(data), "run\n") >= 2
	}) {
		data, _ := os.ReadFile(runLogPath)
		t.Fatalf("timed out waiting for crash restart to spawn twice; got log %q", string(data))
	}
}

func TestSupervisorStopCancelsPendingRestart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	script := writeTestScript(t, "exit 1")
	cfg := testSupervisorCfg(script)
	cfg.MaxRestarts = 5
	cfg.RestartBaseDelay = 500 * time.Millisecond
	cfg.StartupTimeout = 100 * time.Millisecond

	var startingCount atomic.Int32
	onState := func(kind EngineKind, status EngineStatus, detail string) {
		if status == StatusStarting {
			startingCount.Add(1)
		}
	}

	sup := NewSupervisor(cfg, testLogger(), onState)
	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	if !waitForStatus(sup, StatusUnhealthy, 2*time.Second) {
		t.Fatalf("expected unhealthy before stop, got %s", sup.Status())
	}

	if err := sup.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	startingAfterStop := startingCount.Load()

	time.Sleep(1200 * time.Millisecond)
	if got := startingCount.Load(); got != startingAfterStop {
		t.Fatalf("unexpected restart after stop: before=%d after=%d", startingAfterStop, got)
	}
}

func TestSupervisorMaxRestartsExhausted(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	script := writeTestScript(t, "exit 1")
	cfg := testSupervisorCfg(script)
	cfg.MaxRestarts = 1
	cfg.RestartBaseDelay = 10 * time.Millisecond

	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = sup.Stop() }()

	if !waitForStatus(sup, StatusUnhealthy, 5*time.Second) {
		t.Errorf("expected status unhealthy after max restarts, got %s", sup.Status())
	}
}

func TestSupervisorGracefulShutdown(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	script := writeTestScript(t, "sleep 60")
	cfg := testSupervisorCfg(script)
	cfg.ShutdownTimeout = 5 * time.Second

	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	pid := sup.Info().PID
	start := time.Now()
	if err := sup.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	elapsed := time.Since(start)

	if sup.Status() != StatusStopped {
		t.Errorf("expected status stopped, got %s", sup.Status())
	}
	if elapsed > 4*time.Second {
		t.Errorf("expected graceful shutdown in < 4s, took %s", elapsed)
	}

	time.Sleep(50 * time.Millisecond)
	if testProcessAlive(pid) {
		t.Errorf("expected process %d to be dead after graceful stop", pid)
	}
}

func TestSupervisorForceKill(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	script := writeTestScript(t, "trap '' TERM; sleep 60")
	cfg := testSupervisorCfg(script)
	cfg.ShutdownTimeout = 500 * time.Millisecond

	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	pid := sup.Info().PID
	if err := sup.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	if sup.Status() != StatusStopped {
		t.Errorf("expected status stopped after force kill, got %s", sup.Status())
	}

	time.Sleep(50 * time.Millisecond)
	if testProcessAlive(pid) {
		t.Errorf("expected process %d to be dead after SIGKILL", pid)
	}
}

func TestSupervisorStateCallback(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	script := writeTestScript(t, "sleep 60")
	cfg := testSupervisorCfg(script)

	var mu sync.Mutex
	var states []EngineStatus

	onState := func(kind EngineKind, status EngineStatus, detail string) {
		mu.Lock()
		states = append(states, status)
		mu.Unlock()
	}

	sup := NewSupervisor(cfg, testLogger(), onState)
	ctx := context.Background()

	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = sup.Stop() }()

	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	stateCopy := make([]EngineStatus, len(states))
	copy(stateCopy, states)
	mu.Unlock()

	hasStarting := false
	for _, state := range stateCopy {
		if state == StatusStarting {
			hasStarting = true
			break
		}
	}
	if !hasStarting {
		t.Errorf("expected at least 'starting' state in callbacks, got: %v", stateCopy)
	}
}
