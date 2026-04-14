package grpcserver

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

func TestNewConfiguresAgentCoreDefaultExecutors(t *testing.T) {
	t.Parallel()

	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	server, err := New(cfg, health.NewState(), slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("grpcserver.New: %v", err)
	}
	t.Cleanup(func() {
		_ = server.Stop(context.Background())
		if svc := server.LocalService(); svc != nil {
			svc.Close()
		}
		if svc := server.MemoryService(); svc != nil {
			_ = svc.Close()
		}
	})

	agentCoreSvc := server.AgentCoreService()
	if agentCoreSvc == nil {
		t.Fatal("expected agent core service")
	}
	appSvc := server.AppService()
	if appSvc == nil {
		t.Fatal("expected app service")
	}
	if !agentCoreSvc.HasLifeTrackExecutor() {
		t.Fatal("expected life-track executor to be configured")
	}
	if !agentCoreSvc.HasChatTrackSidecarExecutor() {
		t.Fatal("expected chat-track sidecar executor to be configured")
	}
	if !agentCoreSvc.HasCanonicalReviewExecutor() {
		t.Fatal("expected canonical review executor to be configured")
	}
	if !appSvc.HasInternalConsumer("runtime.agentcore") {
		t.Fatal("expected runtime.agentcore app consumer to be configured")
	}
}
