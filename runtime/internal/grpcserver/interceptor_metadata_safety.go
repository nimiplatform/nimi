package grpcserver

import (
	"context"

	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc"
)

func newUnaryCredentialScrubInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		return handler(envelope.ScrubIncomingCredentialMetadata(ctx), req)
	}
}

func newStreamCredentialScrubInterceptor() grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		return handler(srv, &credentialScrubServerStream{
			ServerStream: ss,
			ctx:          envelope.ScrubIncomingCredentialMetadata(ss.Context()),
		})
	}
}

type credentialScrubServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *credentialScrubServerStream) Context() context.Context {
	return s.ctx
}
