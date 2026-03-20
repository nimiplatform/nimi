package daemon

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
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
