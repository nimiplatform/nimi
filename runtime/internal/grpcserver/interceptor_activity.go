package grpcserver

import (
	"context"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc"
)

type rpcShutdownDisposition string

const (
	rpcShutdownCancel     rpcShutdownDisposition = "cancel"
	rpcShutdownAllowDrain rpcShutdownDisposition = "allow_drain"
)

type activeRPCSnapshot struct {
	Method          string
	Category        string
	Disposition     rpcShutdownDisposition
	StartedAt       time.Time
	LastActivityAt  time.Time
	Stream          bool
	ClientStreaming bool
	ServerStreaming bool
}

type trackedServerStream struct {
	grpc.ServerStream
	ctx   context.Context
	touch func()
}

func (s *trackedServerStream) Context() context.Context {
	return s.ctx
}

func (s *trackedServerStream) SendMsg(m any) error {
	if s.touch != nil {
		s.touch()
	}
	err := s.ServerStream.SendMsg(m)
	if err == nil && s.touch != nil {
		s.touch()
	}
	return err
}

func (s *trackedServerStream) RecvMsg(m any) error {
	if s.touch != nil {
		s.touch()
	}
	err := s.ServerStream.RecvMsg(m)
	if err == nil && s.touch != nil {
		s.touch()
	}
	return err
}

func newUnaryActivityInterceptor(registry *activeRPCRegistry) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if registry == nil {
			return handler(ctx, req)
		}
		trackedCtx, finish := registry.TrackUnary(ctx, info.FullMethod)
		defer finish()
		return handler(trackedCtx, req)
	}
}

func newStreamActivityInterceptor(registry *activeRPCRegistry) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if registry == nil {
			return handler(srv, ss)
		}
		trackedCtx, signal, finish, touch := registry.TrackStream(ss.Context(), info.FullMethod, info)
		defer finish()
		wrapped := &trackedServerStream{
			ServerStream: ss,
			ctx:          trackedCtx,
			touch:        touch,
		}
		if signal == nil {
			return handler(srv, wrapped)
		}
		return handler(srv, wrapped)
	}
}

func classifyRPCMethod(fullMethod string, isStream bool) (string, rpcShutdownDisposition) {
	switch fullMethod {
	case "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents":
		return "mode_c_export", rpcShutdownAllowDrain
	case "/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
		"/nimi.runtime.v1.RuntimeAuditService/SubscribeAIProviderHealthEvents",
		"/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages":
		return "mode_d_subscription", rpcShutdownCancel
	case "/nimi.runtime.v1.RuntimeAiService/StreamScenario":
		return "mode_a_execution_stream", rpcShutdownCancel
	case "/nimi.runtime.v1.RuntimeAiService/SubscribeScenarioJobEvents",
		"/nimi.runtime.v1.RuntimeWorkflowService/SubscribeWorkflowEvents":
		return "mode_b_state_stream", rpcShutdownCancel
	case "/nimi.runtime.v1.RuntimeAiRealtimeService/ReadRealtimeEvents":
		return "realtime_read_stream", rpcShutdownCancel
	case "/nimi.runtime.v1.RuntimeLocalService/WatchLocalTransfers":
		return "local_transfer_watch", rpcShutdownCancel
	case "/grpc.health.v1.Health/Watch":
		return "grpc_health_watch", rpcShutdownCancel
	case "/grpc.health.v1.Health/Check":
		return "grpc_health_check", rpcShutdownCancel
	default:
		if isStream {
			return "stream_other", rpcShutdownCancel
		}
		return "unary", rpcShutdownCancel
	}
}

func withShutdownSignal(parent context.Context) (context.Context, *rpcctx.ShutdownSignal) {
	ctx, signal := rpcctx.WithShutdownSignal(parent)
	return ctx, signal
}
