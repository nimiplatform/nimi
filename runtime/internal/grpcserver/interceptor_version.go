package grpcserver

import (
	"context"
	"log/slog"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const versionHeaderKey = "x-nimi-runtime-version"

// newUnaryVersionInterceptor returns a unary interceptor that sets the
// x-nimi-runtime-version response header on every gRPC call. (K-DAEMON-011)
func newUnaryVersionInterceptor(logger *slog.Logger, version string) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if err := grpc.SetHeader(ctx, metadata.Pairs(versionHeaderKey, version)); err != nil && logger != nil {
			logger.Warn("set unary version header failed", "method", info.FullMethod, "error", err)
		}
		return handler(ctx, req)
	}
}

// newStreamVersionInterceptor returns a stream interceptor that sets the
// x-nimi-runtime-version response header on every gRPC stream. (K-DAEMON-011)
func newStreamVersionInterceptor(logger *slog.Logger, version string) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if err := ss.SetHeader(metadata.Pairs(versionHeaderKey, version)); err != nil && logger != nil {
			logger.Warn("set stream version header failed", "method", info.FullMethod, "error", err)
		}
		return handler(srv, ss)
	}
}
