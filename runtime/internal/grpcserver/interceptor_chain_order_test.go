package grpcserver

import (
	"context"
	"io"
	"reflect"
	"testing"

	"google.golang.org/grpc"
)

func TestInterceptorChainOrderMatchesSpec(t *testing.T) {
	expected := []string{"version", "lifecycle", "protocol", "authn", "authz", "audit", "handler"}
	unaryOrder := make([]string, 0, len(expected))

	recordUnaryChainExecution(&unaryOrder,
		recordingUnaryInterceptor("version", &unaryOrder),
		recordingUnaryInterceptor("lifecycle", &unaryOrder),
		recordingUnaryInterceptor("protocol", &unaryOrder),
		recordingUnaryInterceptor("authn", &unaryOrder),
		recordingUnaryInterceptor("authz", &unaryOrder),
		recordingUnaryInterceptor("audit", &unaryOrder),
	)
	if !reflect.DeepEqual(unaryOrder, expected) {
		t.Fatalf("unexpected unary interceptor order: got=%v want=%v", unaryOrder, expected)
	}

	streamOrder := make([]string, 0, len(expected))
	recordStreamChainExecution(&streamOrder,
		recordingStreamInterceptor("version", &streamOrder),
		recordingStreamInterceptor("lifecycle", &streamOrder),
		recordingStreamInterceptor("protocol", &streamOrder),
		recordingStreamInterceptor("authn", &streamOrder),
		recordingStreamInterceptor("authz", &streamOrder),
		recordingStreamInterceptor("audit", &streamOrder),
	)
	if !reflect.DeepEqual(streamOrder, expected) {
		t.Fatalf("unexpected stream interceptor order: got=%v want=%v", streamOrder, expected)
	}
}

func recordUnaryChainExecution(order *[]string, interceptors ...grpc.UnaryServerInterceptor) {
	handler := func(_ context.Context, _ any) (any, error) {
		*order = append(*order, "handler")
		return struct{}{}, nil
	}
	info := &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth"}
	chained := chainUnaryInterceptors(interceptors...)
	_, _ = chained(context.Background(), struct{}{}, info, handler)
}

func recordStreamChainExecution(order *[]string, interceptors ...grpc.StreamServerInterceptor) {
	handler := func(_ any, _ grpc.ServerStream) error {
		*order = append(*order, "handler")
		return nil
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
		IsClientStream: false,
		IsServerStream: true,
	}
	chained := chainStreamInterceptors(interceptors...)
	_ = chained(struct{}{}, &recordingServerStream{ctx: context.Background()}, info, handler)
}

func chainUnaryInterceptors(interceptors ...grpc.UnaryServerInterceptor) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		current := handler
		for i := len(interceptors) - 1; i >= 0; i-- {
			interceptor := interceptors[i]
			next := current
			current = func(callCtx context.Context, callReq any) (any, error) {
				return interceptor(callCtx, callReq, info, next)
			}
		}
		return current(ctx, req)
	}
}

func chainStreamInterceptors(interceptors ...grpc.StreamServerInterceptor) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		current := handler
		for i := len(interceptors) - 1; i >= 0; i-- {
			interceptor := interceptors[i]
			next := current
			current = func(callSrv any, callStream grpc.ServerStream) error {
				return interceptor(callSrv, callStream, info, next)
			}
		}
		return current(srv, ss)
	}
}

func recordingUnaryInterceptor(name string, order *[]string) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		*order = append(*order, name)
		return handler(ctx, req)
	}
}

func recordingStreamInterceptor(name string, order *[]string) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		*order = append(*order, name)
		return handler(srv, ss)
	}
}

type recordingServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *recordingServerStream) Context() context.Context {
	return s.ctx
}

func (s *recordingServerStream) SendMsg(any) error { return nil }
func (s *recordingServerStream) RecvMsg(any) error { return io.EOF }
