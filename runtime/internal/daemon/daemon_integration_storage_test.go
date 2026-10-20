package daemon

import (
	"context"

	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
)

func TestDaemonLifecycleDoesNotCreateSQLiteBackup(t *testing.T) {
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

	entries, err := os.ReadDir(filepath.Join(filepath.Dir(cfg.LocalStatePath), "backups"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatalf("os.ReadDir(backups): %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected no lifecycle sqlite backup snapshots, got %d", len(entries))
	}
}

func TestDaemonNewFailsClosedOnCorruptedSQLiteWithoutBackup(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "memory.db"), []byte("corrupt"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(memory.db): %v", err)
	}
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(dir, "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	if _, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test"); err == nil {
		t.Fatal("expected daemon init to fail closed on corrupted sqlite without backup")
	}
}

func waitForDaemonStatus(t *testing.T, daemon *Daemon, expected health.Status, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if daemon.state.Snapshot().Status == expected {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected daemon status %s, got %s", expected, daemon.state.Snapshot().Status)
}
