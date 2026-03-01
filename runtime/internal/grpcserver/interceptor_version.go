package grpcserver

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const versionHeaderKey = "x-nimi-runtime-version"

// newUnaryVersionInterceptor returns a unary interceptor that sets the
// x-nimi-runtime-version response header on every gRPC call. (K-DAEMON-011)
func newUnaryVersionInterceptor(version string) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		_ = grpc.SetHeader(ctx, metadata.Pairs(versionHeaderKey, version))
		return handler(ctx, req)
	}
}

// newStreamVersionInterceptor returns a stream interceptor that sets the
// x-nimi-runtime-version response header on every gRPC stream. (K-DAEMON-011)
func newStreamVersionInterceptor(version string) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		_ = ss.SetHeader(metadata.Pairs(versionHeaderKey, version))
		return handler(srv, ss)
	}
}
