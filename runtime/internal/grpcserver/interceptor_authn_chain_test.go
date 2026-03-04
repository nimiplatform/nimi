package grpcserver

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestUnaryAuthnInterceptorRejectsMalformedAuthorizationHeader(t *testing.T) {
	validator, err := authn.NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	interceptor := authn.NewUnaryInterceptor(validator)
	handlerCalled := false

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Basic malformed",
	))
	_, callErr := interceptor(
		ctx,
		&runtimev1.ListModelsRequest{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeModelService/ListModels"},
		func(context.Context, any) (any, error) {
			handlerCalled = true
			return &runtimev1.ListModelsResponse{}, nil
		},
	)
	if callErr == nil {
		t.Fatalf("expected auth error")
	}
	if handlerCalled {
		t.Fatalf("handler must not be called when authorization header is malformed")
	}
	st, ok := status.FromError(callErr)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID.String() {
		t.Fatalf("unexpected reason: %s", st.Message())
	}
}
