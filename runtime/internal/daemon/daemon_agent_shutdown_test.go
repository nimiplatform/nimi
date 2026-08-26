package daemon

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestDaemonShutdownClosesAgentService(t *testing.T) {
	daemon := newTestDaemon(t, slog.New(slog.NewTextHandler(io.Discard, nil)))
	agentSvc := daemon.grpc.AgentService()
	if agentSvc == nil {
		t.Fatal("daemon has no Runtime Agent service")
	}
	if err := daemon.shutdown(); err != nil {
		t.Fatalf("daemon shutdown: %v", err)
	}
	if _, err := agentSvc.OpenConversationAnchor(context.Background(), nil); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("Agent service accepted work after daemon shutdown: %v", err)
	}
}
