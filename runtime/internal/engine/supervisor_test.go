package engine

import (
	"bytes"
	"context"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
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

// testSupervisedRoot resolves a stable per-test data-plane environments root
// for Supervisor pid/metadata tracking. It uses the test HOME established by
// setSupervisorTestHome so repeated calls within one test agree.
func testSupervisedRoot() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".nimi", "data", "environments")
}

func testSupervisorCfg(scriptPath string) EngineConfig {
	return EngineConfig{
		Kind:             EngineMedia,
		BinaryPath:       scriptPath,
		Port:             mustAllocateTestPort(),
		Version:          "test",
		SupervisedRoot:   testSupervisedRoot(),
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

func mustAllocateTestPort() int {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	defer func() { _ = ln.Close() }()
	return ln.Addr().(*net.TCPAddr).Port
}

func startSupervisorHelperProcess(t *testing.T, mode string) *exec.Cmd {
	t.Helper()
	executablePath, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	cmd := exec.Command(executablePath, "-test.run=TestSupervisorHelperProcess", "--", mode)
	cmd.Env = append(os.Environ(), "GO_WANT_SUPERVISOR_HELPER_PROCESS=1")
	setSupervisorProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start helper process: %v", err)
	}
	t.Cleanup(func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	})
	return cmd
}

func TestSupervisorHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_SUPERVISOR_HELPER_PROCESS") != "1" {
		return
	}
	if len(os.Args) < 3 {
		os.Exit(2)
	}
	mode := os.Args[len(os.Args)-1]
	switch mode {
	case "sleep":
		time.Sleep(60 * time.Second)
		os.Exit(0)
	case "ignore-term":
		if runtime.GOOS != "windows" {
			signalChannel := make(chan os.Signal, 1)
			signal.Notify(signalChannel, syscall.SIGTERM)
		}
		time.Sleep(60 * time.Second)
		os.Exit(0)
	default:
		os.Exit(2)
	}
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

func TestSupervisorHealthFailuresDoNotConsumeCrashRestartCounter(t *testing.T) {
	sup := NewSupervisor(EngineConfig{
		Kind:           EngineMedia,
		HealthMode:     HealthModeTCP,
		Address:        "127.0.0.1:1",
		HealthInterval: 10 * time.Millisecond,
		MaxRestarts:    1,
	}, testLogger(), nil)
	sup.mu.Lock()
	sup.status = StatusHealthy
	sup.runEpoch = 1
	sup.process = &supervisedProcess{done: make(chan struct{})}
	sup.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		sup.monitor(ctx, 1)
		close(done)
	}()

	if !waitForStatus(sup, StatusUnhealthy, time.Second) {
		t.Fatalf("expected unhealthy after health probe failures, got %s", sup.Status())
	}
	if got := sup.Info().ConsecutiveFailures; got != 0 {
		t.Fatalf("crash restart counter should stay at 0 for health-only failures, got %d", got)
	}

	cancel()
	<-done
}

func TestSupervisorStreamsProcessOutputToLogger(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix shell scripts")
	}
	setSupervisorTestHome(t)

	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	script := writeTestScript(t, "echo stdout-line\n>&2 echo stderr-line\nsleep 2")
	cfg := testSupervisorCfg(script)
	cfg.StartupTimeout = 100 * time.Millisecond

	sup := NewSupervisor(cfg, logger, nil)
	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = sup.Stop() }()

	if !waitForCondition(2*time.Second, func() bool {
		output := logBuffer.String()
		return strings.Contains(output, "stdout-line") && strings.Contains(output, "stderr-line")
	}) {
		t.Fatalf("expected streamed process logs, got: %s", logBuffer.String())
	}
}

func TestSupervisorStreamsCarriageReturnProgressOutputToLogger(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix shell scripts")
	}
	setSupervisorTestHome(t)

	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	script := writeTestScript(t, "printf 'step-1\\rstep-2\\rstep-3\\n'; sleep 2")
	cfg := testSupervisorCfg(script)
	cfg.StartupTimeout = 100 * time.Millisecond

	sup := NewSupervisor(cfg, logger, nil)
	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = sup.Stop() }()

	if !waitForCondition(2*time.Second, func() bool {
		output := logBuffer.String()
		return strings.Contains(output, "step-1") &&
			strings.Contains(output, "step-2") &&
			strings.Contains(output, "step-3")
	}) {
		t.Fatalf("expected carriage-return progress logs, got: %s", logBuffer.String())
	}
}

func TestSupervisorAnnotatesManagedImageProgressPhase(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix shell scripts")
	}
	setSupervisorTestHome(t)

	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	script := writeTestScript(t, "python3 - <<'PY'\nimport sys, time\nsys.stderr.write('loading tensors from /tmp/ae.safetensors\\n')\nsys.stderr.flush()\nsys.stdout.write('453/1095 - 43.16it/s\\r')\nsys.stdout.flush()\ntime.sleep(0.1)\nsys.stderr.write('sampling using Euler method\\n')\nsys.stderr.flush()\nsys.stdout.write('1/8 - 5.71s/it\\r')\nsys.stdout.flush()\ntime.sleep(2)\nPY")
	cfg := testSupervisorCfg(script)
	cfg.Kind = engineManagedImageBackend
	cfg.StartupTimeout = 100 * time.Millisecond

	sup := NewSupervisor(cfg, logger, nil)
	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = sup.Stop() }()

	if !waitForCondition(2*time.Second, func() bool {
		output := logBuffer.String()
		return strings.Contains(output, "line=\"453/1095 - 43.16it/s\" phase=load_tensors") &&
			strings.Contains(output, "line=\"1/8 - 5.71s/it\" phase=sampling")
	}) {
		t.Fatalf("expected phased progress logs, got: %s", logBuffer.String())
	}
}

func TestCleanStalePIDKillsOnlyMatchingProcessIdentity(t *testing.T) {
	if currentGOOS() == "windows" {
		t.Skip("stale pid cleanup helper process semantics are not stable on Windows")
	}
	setSupervisorTestHome(t)

	helperCmd := startSupervisorHelperProcess(t, "sleep")
	executablePath, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	sup := NewSupervisor(EngineConfig{
		Kind:           EngineLlama,
		BinaryPath:     executablePath,
		Port:           mustAllocateTestPort(),
		SupervisedRoot: testSupervisedRoot(),
	}, testLogger(), nil)

	pidPath := sup.pidFilePath()
	metadataPath := sup.pidMetadataPath()
	if err := os.MkdirAll(filepath.Dir(pidPath), 0o755); err != nil {
		t.Fatalf("mkdir pid dir: %v", err)
	}
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(helperCmd.Process.Pid)), 0o644); err != nil {
		t.Fatalf("write pid file: %v", err)
	}
	encodedMetadata, err := encodeSupervisorPIDMetadata(supervisorPIDMetadata{
		PID:                    helperCmd.Process.Pid,
		EngineKind:             EngineLlama,
		ExpectedExecutablePath: canonicalSupervisorProcessPath(executablePath),
	})
	if err != nil {
		t.Fatalf("encode metadata: %v", err)
	}
	if err := os.WriteFile(metadataPath, encodedMetadata, 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}

	sup.cleanStalePID()

	waitErr := make(chan error, 1)
	go func() {
		waitErr <- helperCmd.Wait()
	}()
	select {
	case err := <-waitErr:
		if err != nil && !strings.Contains(err.Error(), "signal: terminated") && !strings.Contains(err.Error(), "killed") {
			t.Fatalf("expected helper process termination, got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("expected matching helper process %d to exit", helperCmd.Process.Pid)
	}
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Fatalf("expected pid file to be removed, got err=%v", err)
	}
	if _, err := os.Stat(metadataPath); !os.IsNotExist(err) {
		t.Fatalf("expected pid metadata to be removed, got err=%v", err)
	}
}

func TestCleanStalePIDSkipsMismatchedProcessIdentity(t *testing.T) {
	if currentGOOS() == "windows" {
		t.Skip("stale pid cleanup helper process semantics are not stable on Windows")
	}
	setSupervisorTestHome(t)

	helperCmd := startSupervisorHelperProcess(t, "sleep")
	executablePath, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	sup := NewSupervisor(EngineConfig{
		Kind:           EngineLlama,
		BinaryPath:     executablePath,
		Port:           mustAllocateTestPort(),
		SupervisedRoot: testSupervisedRoot(),
	}, testLogger(), nil)

	pidPath := sup.pidFilePath()
	metadataPath := sup.pidMetadataPath()
	if err := os.MkdirAll(filepath.Dir(pidPath), 0o755); err != nil {
		t.Fatalf("mkdir pid dir: %v", err)
	}
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(helperCmd.Process.Pid)), 0o644); err != nil {
		t.Fatalf("write pid file: %v", err)
	}
	encodedMetadata, err := encodeSupervisorPIDMetadata(supervisorPIDMetadata{
		PID:                    helperCmd.Process.Pid,
		EngineKind:             EngineLlama,
		ExpectedExecutablePath: canonicalSupervisorProcessPath(filepath.Join(t.TempDir(), "other-binary")),
	})
	if err != nil {
		t.Fatalf("encode metadata: %v", err)
	}
	if err := os.WriteFile(metadataPath, encodedMetadata, 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}

	sup.cleanStalePID()

	if !testProcessAlive(helperCmd.Process.Pid) {
		t.Fatalf("expected mismatched helper process %d to remain alive", helperCmd.Process.Pid)
	}
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Fatalf("expected pid file cleanup on mismatch, got err=%v", err)
	}
	if _, err := os.Stat(metadataPath); !os.IsNotExist(err) {
		t.Fatalf("expected pid metadata cleanup on mismatch, got err=%v", err)
	}
}

func TestCleanStalePIDSkipsKillWithoutMetadata(t *testing.T) {
	if currentGOOS() == "windows" {
		t.Skip("stale pid cleanup helper process semantics are not stable on Windows")
	}
	setSupervisorTestHome(t)

	helperCmd := startSupervisorHelperProcess(t, "sleep")
	executablePath, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	sup := NewSupervisor(EngineConfig{
		Kind:           EngineLlama,
		BinaryPath:     executablePath,
		Port:           mustAllocateTestPort(),
		SupervisedRoot: testSupervisedRoot(),
	}, testLogger(), nil)

	pidPath := sup.pidFilePath()
	if err := os.MkdirAll(filepath.Dir(pidPath), 0o755); err != nil {
		t.Fatalf("mkdir pid dir: %v", err)
	}
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(helperCmd.Process.Pid)), 0o644); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	sup.cleanStalePID()

	if !testProcessAlive(helperCmd.Process.Pid) {
		t.Fatalf("expected helper process %d to remain alive without metadata", helperCmd.Process.Pid)
	}
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Fatalf("expected pid file cleanup without metadata, got err=%v", err)
	}
}

func TestCleanStalePIDKillsWrappedExecProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	sleepPath, err := exec.LookPath("sleep")
	if err != nil {
		t.Fatalf("look up sleep: %v", err)
	}
	script := writeTestScript(t, "exec "+sleepPath+" 60")
	cfg := testSupervisorCfg(script)
	cfg.MaxRestarts = 1
	cfg.StartupTimeout = 100 * time.Millisecond

	sup := NewSupervisor(cfg, testLogger(), nil)
	if err := sup.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	pid := sup.Info().PID
	t.Cleanup(func() {
		if testProcessAlive(pid) {
			_ = signalSupervisorProcessDirect(pid, syscall.SIGKILL)
		}
	})

	metadata, err := readSupervisorPIDMetadata(sup.pidMetadataPath())
	if err != nil {
		t.Fatalf("read supervisor pid metadata: %v", err)
	}
	wantPath := canonicalSupervisorProcessPath(sleepPath)
	if !waitForCondition(time.Second, func() bool {
		metadata, err = readSupervisorPIDMetadata(sup.pidMetadataPath())
		return err == nil && metadata.ExpectedExecutablePath == wantPath
	}) {
		t.Fatalf("expected metadata executable path %q, got %q", wantPath, metadata.ExpectedExecutablePath)
	}

	staleCleaner := NewSupervisor(cfg, testLogger(), nil)
	staleCleaner.cleanStalePID()

	if !waitForCondition(3*time.Second, func() bool {
		return !testProcessAlive(pid)
	}) {
		t.Fatalf("expected wrapped exec process %d to exit during stale cleanup", pid)
	}
}

// TestSupervisorStartupHealthWaitFailsFastOnProcessExit is the regression guard
// for bug A: a supervised process that exits immediately (e.g. speech failing
// to bind its port) must fail the startup health wait within a couple of
// seconds — not block the full StartupTimeout on a dead process. The script
// exits non-zero right away while StartupTimeout is a deliberately long 60s.
func TestSupervisorStartupHealthWaitFailsFastOnProcessExit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	script := writeTestScript(t, "echo bind failure 1>&2\nexit 1")
	cfg := testSupervisorCfg(script)
	// A long startup timeout: the test proves the health wait does NOT block on
	// it once the process exits.
	cfg.StartupTimeout = 60 * time.Second
	cfg.HealthInterval = 50 * time.Millisecond
	cfg.MaxRestarts = 1
	cfg.RestartBaseDelay = 10 * time.Millisecond

	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	start := time.Now()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = sup.Stop() }()

	// The supervisor must observe the immediate process exit and transition out
	// of Starting well within a few seconds, not after the 60s StartupTimeout.
	if !waitForCondition(8*time.Second, func() bool {
		status := sup.Status()
		return status == StatusUnhealthy || status == StatusStopped
	}) {
		t.Fatalf("expected fast startup failure, status=%s after %s", sup.Status(), time.Since(start))
	}
	if elapsed := time.Since(start); elapsed > 20*time.Second {
		t.Fatalf("startup health wait did not fail fast on process exit: took %s", elapsed)
	}
}

// TestSupervisorStartReclaimsStalePortFromPriorInstance is the regression guard
// for bug B (port reclaim): a stale supervised process from a prior runtime
// instance — recorded in the pid file — that still holds the configured port
// must be killed and the port reclaimed before the new supervisor spawns.
func TestSupervisorStartReclaimsStalePortFromPriorInstance(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	port := mustAllocateTestPort()

	// A "prior runtime instance" supervisor binds the port and stays alive.
	priorScript := writeTestScript(t, "exec "+pythonOrNetcatPortHolder(t, port))
	priorCfg := testSupervisorCfg(priorScript)
	priorCfg.Port = port
	priorCfg.StartupTimeout = 200 * time.Millisecond
	priorCfg.MaxRestarts = 1

	prior := NewSupervisor(priorCfg, testLogger(), nil)
	if err := prior.Start(context.Background()); err != nil {
		t.Fatalf("prior Start: %v", err)
	}
	priorPID := prior.Info().PID
	t.Cleanup(func() {
		if testProcessAlive(priorPID) {
			_ = signalSupervisorProcessDirect(priorPID, syscall.SIGKILL)
		}
	})

	// The prior instance leaks its pid file (a hard runtime kill never ran
	// removePIDFile). Wait until the pid + metadata are durably written.
	if !waitForCondition(2*time.Second, func() bool {
		metadata, err := readSupervisorPIDMetadata(prior.pidMetadataPath())
		return err == nil && metadata.PID == priorPID
	}) {
		t.Fatalf("prior instance never persisted pid metadata")
	}
	// Wait until the port-holder process has actually bound the port.
	if !waitForCondition(5*time.Second, func() bool {
		return !portAvailable(port)
	}) {
		t.Skip("port holder process never bound the port on this host")
	}

	// A new runtime instance: same SupervisedRoot, same configured port. Start
	// must reclaim the stale process + port instead of crash-looping on bind.
	nextScript := writeTestScript(t, "sleep 60")
	nextCfg := testSupervisorCfg(nextScript)
	nextCfg.Port = port
	nextCfg.StartupTimeout = 500 * time.Millisecond
	nextCfg.MaxRestarts = 1

	next := NewSupervisor(nextCfg, testLogger(), nil)
	if err := next.Start(context.Background()); err != nil {
		t.Fatalf("next Start failed; stale port was not reclaimed: %v", err)
	}
	defer func() { _ = next.Stop() }()

	if !waitForCondition(3*time.Second, func() bool {
		return !testProcessAlive(priorPID)
	}) {
		t.Fatalf("expected stale prior process %d to be killed during port reclaim", priorPID)
	}
	if nextPID := next.Info().PID; nextPID <= 0 || nextPID == priorPID {
		t.Fatalf("expected new process spawned after port reclaim, got pid %d", nextPID)
	}
}

// pythonOrNetcatPortHolder returns a shell command that binds the given TCP
// port on 127.0.0.1 and holds it open, used to simulate a stale engine process
// occupying a supervised-engine port.
func pythonOrNetcatPortHolder(t *testing.T, port int) string {
	t.Helper()
	for _, name := range []string{"python3", "python"} {
		if path, err := exec.LookPath(name); err == nil {
			return path + " -c \"import socket,time;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,0);s.bind(('127.0.0.1'," +
				strconv.Itoa(port) + "));s.listen(1);time.sleep(60)\""
		}
	}
	t.Skip("no python interpreter available to simulate a stale port holder")
	return ""
}
