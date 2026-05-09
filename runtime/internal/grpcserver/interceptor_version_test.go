package grpcserver

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestUnaryVersionInterceptorFailsClosedOnHeaderFailure(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	interceptor := newUnaryVersionInterceptor(logger, "test-version")
	handlerCalled := false

	_, err := interceptor(context.Background(), struct{}{}, &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth",
	}, func(_ context.Context, _ any) (any, error) {
		handlerCalled = true
		return struct{}{}, nil
	})
	if err == nil {
		t.Fatal("expected required response metadata failure")
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("unexpected status code: %v", status.Code(err))
	}
	if handlerCalled {
		t.Fatal("handler must not run when required runtime version metadata cannot be set")
	}
	if !strings.Contains(logs.String(), "set unary version header failed") {
		t.Fatalf("expected unary header failure log, got=%s", logs.String())
	}
}

func TestStreamVersionInterceptorFailsClosedOnHeaderFailure(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	interceptor := newStreamVersionInterceptor(logger, "test-version")
	handlerCalled := false

	err := interceptor(struct{}{}, &versionFailingStream{ctx: context.Background()}, &grpc.StreamServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
	}, func(_ any, _ grpc.ServerStream) error {
		handlerCalled = true
		return nil
	})
	if err == nil {
		t.Fatal("expected required response metadata failure")
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("unexpected status code: %v", status.Code(err))
	}
	if handlerCalled {
		t.Fatal("handler must not run when required runtime version metadata cannot be set")
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
