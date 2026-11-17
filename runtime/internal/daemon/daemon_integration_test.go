package daemon

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/health"
)

func TestDaemonRunTransitionsStartupAndShutdownStates(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	updates, cancelUpdates := daemon.state.Subscribe(16)
	defer cancelUpdates()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()
	readyCtx, cancelReady := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelReady()
	if err := daemon.WaitReady(readyCtx); err != nil {
		t.Fatalf("wait for daemon ready: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	seenStarting := false
	for time.Now().Before(deadline) {
		snapshot := <-updates
		if snapshot.Status == health.StatusStarting {
			seenStarting = true
		}
		if snapshot.Status == health.StatusReady {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !seenStarting {
		t.Fatalf("expected daemon to enter STARTING")
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status != health.StatusReady {
		t.Fatalf("expected daemon to reach READY, got %s (%s)", snapshot.Status, snapshot.Reason)
	}

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
	seenStopping := false
	seenStopped := false
	shutdownDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(shutdownDeadline) {
		select {
		case snapshot := <-updates:
			if snapshot.Status == health.StatusStopping {
				seenStopping = true
			}
			if snapshot.Status == health.StatusStopped {
				seenStopped = true
				break
			}
		case <-time.After(20 * time.Millisecond):
		}
		if seenStopped {
			break
		}
	}
	if !seenStopping {
		t.Fatalf("expected daemon to enter STOPPING")
	}
	if !seenStopped {
		t.Fatalf("expected daemon to enter STOPPED")
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status != health.StatusStopped {
		t.Fatalf("expected daemon to end in STOPPED, got %s (%s)", snapshot.Status, snapshot.Reason)
	}
}

func TestDaemonRunTransitionsReadyBeforeStartupDegraded(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   true,
		EngineLlamaPort:      18321,
		EngineLlamaVersion:   "test",
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return nil, errors.New("engine manager unavailable")
	}

	updates, cancelUpdates := daemon.state.Subscribe(32)
	defer cancelUpdates()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()

	deadline := time.Now().Add(2 * time.Second)
	seenReady := false
	seenDegraded := false
	for time.Now().Before(deadline) {
		select {
		case snapshot := <-updates:
			if snapshot.Status == health.StatusReady {
				seenReady = true
			}
			if snapshot.Status == health.StatusDegraded {
				if !seenReady {
					t.Fatal("daemon degraded before reaching ready")
				}
				seenDegraded = true
				cancel()
			}
		case <-time.After(20 * time.Millisecond):
		}
		if seenDegraded {
			break
		}
	}
	if !seenReady {
		t.Fatal("expected daemon to reach READY before DEGRADED")
	}
	if !seenDegraded {
		t.Fatal("expected daemon to enter DEGRADED after READY")
	}
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}

func TestDaemonRunNeverBootstrapsPrivateLlamaWorker(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   true,
		EngineLlamaPort:      18321,
		EngineLlamaVersion:   "test",
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return &engine.Manager{}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()

	waitForDaemonStatus(t, daemon, health.StatusReady, 2*time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}

func TestDaemonShutdownFreezesBudgetBeforeWaitingForBackgroundOwner(t *testing.T) {
	const budget = time.Second
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      budget,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatal(err)
	}
	entered, unblock, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	daemon.newEngineManager = func(*slog.Logger, engine.ManagedRoots, engine.StateChangeFunc) (*engine.Manager, error) {
		close(entered)
		<-unblock
		close(finished)
		return nil, errors.New("fixture released")
	}
	t.Cleanup(func() {
		close(unblock)
		select {
		case <-finished:
		case <-time.After(time.Second):
			t.Error("fixture owner did not return")
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		daemon.grpc.Stop(cleanup)
	})
	ctx, stop := context.WithCancel(t.Context())
	defer stop()
	exit := make(chan error, 1)
	go func() { exit <- daemon.Run(ctx) }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("fixture background owner did not begin")
	}
	ready, cancelReady := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancelReady()
	if err := daemon.WaitReady(ready); err != nil {
		t.Fatal(err)
	}
	deadline := daemon.BeginShutdown()
	stop()
	if repeated := daemon.BeginShutdown(); repeated != deadline {
		t.Fatalf("second stop changed deadline from %s to %s", deadline, repeated)
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status != health.StatusStopping {
		t.Fatalf("background wait preceded STOPPING: %v", snapshot)
	}
	select {
	case err := <-exit:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("unsettled owner was not reported: %v", err)
		}
	case <-time.After(time.Until(deadline) + time.Second):
		t.Fatal("uncooperative background owner held the daemon after its deadline")
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status != health.StatusStopped || snapshot.Reason != "shutdown incomplete" {
		t.Fatalf("unsettled owner was reported as a clean stop: %v", snapshot)
	}
}

func TestDaemonRunStartsAndStopsLifeFrameMaintenance(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       localStatePath,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()

	waitForDaemonStatus(t, daemon, health.StatusReady, 2*time.Second)

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}
