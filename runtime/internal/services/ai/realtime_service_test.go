package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestOpenRealtimeSessionReturnsUnimplemented(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.OpenRealtimeSession(context.Background(), &runtimev1.OpenRealtimeSessionRequest{})
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("status code mismatch: got=%s want=%s", status.Code(err), codes.Unimplemented)
	}
}

func TestAppendRealtimeInputReturnsUnimplemented(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.AppendRealtimeInput(context.Background(), &runtimev1.AppendRealtimeInputRequest{})
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("status code mismatch: got=%s want=%s", status.Code(err), codes.Unimplemented)
	}
}

func TestCloseRealtimeSessionReturnsUnimplemented(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.CloseRealtimeSession(context.Background(), &runtimev1.CloseRealtimeSessionRequest{})
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("status code mismatch: got=%s want=%s", status.Code(err), codes.Unimplemented)
	}
}
