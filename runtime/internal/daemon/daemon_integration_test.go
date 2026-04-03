package daemon

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
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
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
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
	for time.Now().Before(deadline) {
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
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
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

func TestDaemonRunWaitsForBackgroundWorkersToStop(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:                "127.0.0.1:0",
		HTTPAddr:                "127.0.0.1:0",
		ShutdownTimeout:         2 * time.Second,
		LocalStatePath:          filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:     64,
		UsageStatsBufferSize:    64,
		IdempotencyCapacity:     32,
		AIHealthIntervalSeconds: 1,
		AIHTTPTimeoutSeconds:    1,
		Providers: map[string]config.RuntimeFileTarget{
			"openrouter": {BaseURL: "https://example.invalid", APIKey: "openrouter-key"},
		},
	}
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	probeStarted := make(chan struct{})
	probeStopped := make(chan struct{})
	daemon.probeAIProviderFn = func(ctx context.Context, _ *http.Client, _ aiProviderTarget) error {
		select {
		case <-probeStarted:
		default:
			close(probeStarted)
		}
		<-ctx.Done()
		close(probeStopped)
		return ctx.Err()
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()

	select {
	case <-probeStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("expected AI provider probe to start")
	}

	cancel()

	select {
	case <-probeStopped:
	case <-time.After(2 * time.Second):
		t.Fatal("expected AI provider probe to stop after shutdown")
	}

	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}

func TestDaemonStopSupervisedEnginesRunsOnlyOnce(t *testing.T) {
	daemon := &Daemon{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	stops := 0
	daemon.stopSupervisedFn = func() {
		stops++
	}

	daemon.stopSupervisedEngines("first stop")
	daemon.EmergencyStopSupervisedEngines()
	daemon.stopSupervisedEngines("third stop")

	if stops != 1 {
		t.Fatalf("expected supervised engines to stop once, got %d", stops)
	}
}
