package grpcserver

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc"
)

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
