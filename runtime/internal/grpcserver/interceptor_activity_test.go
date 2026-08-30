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

func TestRootHandoffAdmissionDrainsAndReopensOnlyBeforeCommit(t *testing.T) {
	registry := newActiveRPCRegistry(nil)
	rootCtx, rootFinish, admitted := registry.TrackUnary(context.Background(), "/nimi.runtime.v1.RuntimeAppService/SendAppMessage")
	if !admitted {
		t.Fatal("root-bound RPC was not admitted before handoff")
	}
	_, replaceFinish, replaceAdmitted := registry.TrackUnary(context.Background(), "/nimi.runtime.v1.RuntimeLocalService/ReplaceProductControlDataRoot")
	if !replaceAdmitted {
		t.Fatal("Product Control replacement control plane was not admitted")
	}
	defer replaceFinish()

	closed := make(chan error, 1)
	go func() { closed <- registry.CloseRootAdmission(context.Background()) }()
	select {
	case <-rootCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("root-bound RPC was not canceled by handoff")
	}
	rootFinish()
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	_, rejectedFinish, nextAdmitted := registry.TrackUnary(context.Background(), "/nimi.runtime.v1.RuntimeAppService/SendAppMessage")
	rejectedFinish()
	if nextAdmitted {
		t.Fatal("new root-bound RPC crossed a closed handoff")
	}

	registry.AbortRootHandoff()
	_, reopenedFinish, reopened := registry.TrackUnary(context.Background(), "/nimi.runtime.v1.RuntimeAppService/SendAppMessage")
	reopenedFinish()
	if !reopened {
		t.Fatal("pre-commit abort did not reopen unchanged activation")
	}

	if err := registry.CloseRootAdmission(context.Background()); err != nil {
		t.Fatal(err)
	}
	registry.CommitRootHandoff()
	registry.AbortRootHandoff()
	_, committedFinish, committedAdmitted := registry.TrackUnary(context.Background(), "/nimi.runtime.v1.RuntimeAppService/SendAppMessage")
	committedFinish()
	if committedAdmitted {
		t.Fatal("post-commit handoff reopened without Runtime restart")
	}
}

func TestRootHandoffAdmitsRestartOnlyAfterCommit(t *testing.T) {
	registry := newActiveRPCRegistry(nil)
	inFlightRestartCtx, inFlightRestartFinish, inFlightRestartAdmitted := registry.TrackUnary(
		context.Background(),
		"/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeRestart",
	)
	if !inFlightRestartAdmitted {
		t.Fatal("Runtime restart was not admitted before root handoff began")
	}
	closed := make(chan error, 1)
	go func() { closed <- registry.CloseRootAdmission(context.Background()) }()
	select {
	case <-inFlightRestartCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("in-flight Runtime restart was not canceled before Product Control commit")
	}
	inFlightRestartFinish()
	if err := <-closed; err != nil {
		t.Fatal(err)
	}

	_, productControlFinish, productControlAdmitted := registry.TrackUnary(
		context.Background(),
		"/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord",
	)
	productControlFinish()
	if !productControlAdmitted {
		t.Fatal("Product Control observation was not admitted while the handoff was prepared")
	}

	_, restartFinish, restartAdmitted := registry.TrackUnary(
		context.Background(),
		"/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeRestart",
	)
	restartFinish()
	if restartAdmitted {
		t.Fatal("Runtime restart crossed root admission before Product Control committed the new root")
	}

	registry.CommitRootHandoff()
	_, committedRestartFinish, committedRestartAdmitted := registry.TrackUnary(
		context.Background(),
		"/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeRestart",
	)
	committedRestartFinish()
	if !committedRestartAdmitted {
		t.Fatal("Runtime restart was not admitted after Product Control committed the new root")
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
