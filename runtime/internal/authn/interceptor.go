package authn

import (
	"context"
	"log/slog"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const authorizationHeader = "authorization"
const bearerPrefix = "Bearer "

// NewUnaryInterceptor creates a unary server interceptor that extracts
// and verifies JWT tokens from the Authorization header.
// Anonymous requests (no header) pass through with nil identity. (K-AUTHN-001)
func NewUnaryInterceptor(v *Validator) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		newCtx, err := authenticate(ctx, v, info.FullMethod)
		if err != nil {
			return nil, err
		}
		return handler(newCtx, req)
	}
}

// NewStreamInterceptor creates a stream server interceptor that extracts
// and verifies JWT tokens from the Authorization header.
// Anonymous requests (no header) pass through with nil identity. (K-AUTHN-001)
func NewStreamInterceptor(v *Validator) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		newCtx, err := authenticate(ss.Context(), v, info.FullMethod)
		if err != nil {
			return err
		}
		return handler(srv, &wrappedStream{ServerStream: ss, ctx: newCtx})
	}
}

// authenticate extracts the bearer token from gRPC metadata and validates it.
func authenticate(ctx context.Context, v *Validator, method string) (context.Context, error) {
	token, hasAuthHeader, malformed := extractBearerToken(ctx)
	if malformed {
		return ctx, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	if !hasAuthHeader {
		// Anonymous request — no Authorization header
		return ctx, nil
	}

	identity, err := v.ValidateContext(ctx, token)
	if err != nil {
		fields := []any{
			"error", err,
			"method", strings.TrimSpace(method),
		}
		if caller, ok := metadataValue(ctx, "x-nimi-caller-id"); ok {
			fields = append(fields, "caller_id", caller)
		}
		if appID, ok := metadataValue(ctx, "x-nimi-app-id"); ok {
			fields = append(fields, "app_id", appID)
		}
		if participantID, ok := metadataValue(ctx, "x-nimi-participant-id"); ok {
			fields = append(fields, "participant_id", participantID)
		}
		slog.Warn("jwt validation failed", fields...)
		return ctx, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	if identity == nil {
		return ctx, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	return WithIdentity(ctx, identity), nil
}

// extractBearerToken extracts the JWT from "Authorization: Bearer <token>" metadata.
// Returns (token, hasAuthHeader, malformedHeader).
func extractBearerToken(ctx context.Context) (string, bool, bool) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", false, false
	}
	values := md.Get(authorizationHeader)
	if len(values) == 0 {
		return "", false, false
	}
	hasAuthHeader := true
	auth := strings.TrimSpace(values[0])
	if auth == "" {
		return "", hasAuthHeader, true
	}
	if len(auth) < len(bearerPrefix) {
		return "", hasAuthHeader, true
	}
	if auth[:len(bearerPrefix)] != bearerPrefix {
		return "", hasAuthHeader, true
	}
	token := strings.TrimSpace(auth[len(bearerPrefix):])
	if token == "" {
		return "", hasAuthHeader, true
	}
	return token, hasAuthHeader, false
}

func metadataValue(ctx context.Context, key string) (string, bool) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", false
	}
	value := strings.TrimSpace(strings.Join(md.Get(key), ","))
	if value == "" {
		return "", false
	}
	return value, true
}

// wrappedStream wraps a grpc.ServerStream with a modified context.
type wrappedStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (w *wrappedStream) Context() context.Context {
	return w.ctx
}
