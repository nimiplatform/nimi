package grpcserver

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func TestUnaryVersionInterceptorLogsHeaderFailures(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	interceptor := newUnaryVersionInterceptor(logger, "test-version")

	_, err := interceptor(context.Background(), struct{}{}, &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth",
	}, func(_ context.Context, _ any) (any, error) {
		return struct{}{}, nil
	})
	if err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}
	if !strings.Contains(logs.String(), "set unary version header failed") {
		t.Fatalf("expected unary header failure log, got=%s", logs.String())
	}
}

func TestStreamVersionInterceptorLogsHeaderFailures(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	interceptor := newStreamVersionInterceptor(logger, "test-version")

	err := interceptor(struct{}{}, &versionFailingStream{ctx: context.Background()}, &grpc.StreamServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
	}, func(_ any, _ grpc.ServerStream) error {
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}
	if !strings.Contains(logs.String(), "set stream version header failed") {
		t.Fatalf("expected stream header failure log, got=%s", logs.String())
	}
}

type versionFailingStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *versionFailingStream) Context() context.Context     { return s.ctx }
func (s *versionFailingStream) SendMsg(any) error            { return nil }
func (s *versionFailingStream) RecvMsg(any) error            { return io.EOF }
func (s *versionFailingStream) SetHeader(metadata.MD) error  { return io.ErrClosedPipe }
func (s *versionFailingStream) SendHeader(metadata.MD) error { return nil }
func (s *versionFailingStream) SetTrailer(metadata.MD)       {}
