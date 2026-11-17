package daemon

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

// The lifecycle record of a shutdown is written while the Runtime backend is
// still open, so the next process reads it back.
func TestDaemonShutdownRecordSurvivesRestart(t *testing.T) {
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
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- daemon.Run(ctx) }()
	readyCtx, cancelReady := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelReady()
	if err := daemon.WaitReady(readyCtx); err != nil {
		t.Fatalf("wait for daemon ready: %v", err)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
	if err := daemon.shutdown(); err != nil {
		t.Fatalf("repeated shutdown changed the stop outcome: %v", err)
	}

	backend, err := runtimepersistence.Open(nil, cfg.LocalStatePath)
	if err != nil {
		t.Fatalf("reopen Runtime persistence: %v", err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	store, err := auditlog.Open(backend, nil, 64, 16)
	if err != nil {
		t.Fatal(err)
	}
	response, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.lifecycle", PageSize: 10})
	if err != nil {
		t.Fatal(err)
	}
	completed := 0
	for _, event := range response.GetEvents() {
		if event.GetOperation() == "shutdown.completed" {
			fields := event.GetPayload().GetFields()
			if fields["forced"] == nil || fields["forced"].GetBoolValue() ||
				fields["active_methods"].GetStructValue() == nil ||
				fields["remaining_methods"].GetStructValue() == nil {
				t.Fatalf("incomplete graceful shutdown audit: %v", event.GetPayload())
			}
			completed++
		}
	}
	if completed != 1 {
		t.Fatalf("expected one persisted shutdown lifecycle event, got %d", completed)
	}
}
