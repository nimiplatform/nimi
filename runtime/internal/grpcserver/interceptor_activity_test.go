package grpcserver

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestActivityInterceptorFailsClosedWithoutRegistry(t *testing.T) {
	unaryCalled := false
	_, err := newUnaryActivityInterceptor(nil)(
		context.Background(),
		struct{}{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth"},
		func(ctx context.Context, req any) (any, error) {
			unaryCalled = true
			return struct{}{}, nil
		},
	)
	if status.Code(err) != codes.Internal {
		t.Fatalf("expected Internal for missing unary registry, got %v", err)
	}
	if unaryCalled {
		t.Fatal("unary handler ran without active RPC registry")
	}

	streamCalled := false
	err = newStreamActivityInterceptor(nil)(
		struct{}{},
		&recordingServerStream{ctx: context.Background()},
		&grpc.StreamServerInfo{FullMethod: "/grpc.health.v1.Health/Watch", IsServerStream: true},
		func(_ any, _ grpc.ServerStream) error {
			streamCalled = true
			return nil
		},
	)
	if status.Code(err) != codes.Internal {
		t.Fatalf("expected Internal for missing stream registry, got %v", err)
	}
	if streamCalled {
		t.Fatal("stream handler ran without active RPC registry")
	}
}

func TestStreamActivityInterceptorCancelsHealthWatchOnShutdown(t *testing.T) {
	registry := newActiveRPCRegistry(nil)
	interceptor := newStreamActivityInterceptor(registry)
	started := make(chan struct{})
	done := make(chan error, 1)

	go func() {
		done <- interceptor(
			struct{}{},
			&recordingServerStream{ctx: context.Background()},
			&grpc.StreamServerInfo{FullMethod: "/grpc.health.v1.Health/Watch", IsServerStream: true},
			func(_ any, ss grpc.ServerStream) error {
				close(started)
				<-ss.Context().Done()
				return ss.Context().Err()
			},
		)
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("handler did not start")
	}

	registry.BeginShutdown()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context canceled, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("health watch was not canceled on shutdown")
	}
}

func TestStreamActivityInterceptorAllowsExportAuditDrainOnShutdown(t *testing.T) {
	registry := newActiveRPCRegistry(nil)
	interceptor := newStreamActivityInterceptor(registry)
	parentCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- interceptor(
			struct{}{},
			&recordingServerStream{ctx: parentCtx},
			&grpc.StreamServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents", IsServerStream: true},
			func(_ any, ss grpc.ServerStream) error {
				close(started)
				<-ss.Context().Done()
				return ss.Context().Err()
			},
		)
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("handler did not start")
	}

	registry.BeginShutdown()

	select {
	case err := <-done:
		t.Fatalf("export audit stream should not be canceled during shutdown begin, got %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	cancel()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected parent cancellation, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("export audit stream did not exit after parent cancellation")
	}
}
