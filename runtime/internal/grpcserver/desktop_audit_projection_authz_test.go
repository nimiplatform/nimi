package grpcserver

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type desktopAuditPermitAllAuthorizer struct{}

func (desktopAuditPermitAllAuthorizer) ValidateProtectedCapability(string, string, string, string) (runtimev1.ReasonCode, string, bool) {
	return runtimev1.ReasonCode_ACTION_EXECUTED, "", true
}

func TestOrdinaryGRPCRejectsDesktopAuditProjectionBeforeHandler(t *testing.T) {
	called := false
	interceptor := newUnaryAuthzInterceptor(desktopAuditPermitAllAuthorizer{})
	_, err := interceptor(
		context.Background(),
		&runtimev1.ListDesktopAuditEventsRequest{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents"},
		func(context.Context, any) (any, error) {
			called = true
			return &runtimev1.ListDesktopAuditEventsResponse{}, nil
		},
	)
	if called {
		t.Fatal("ordinary gRPC reached protected Desktop audit handler")
	}
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("status = %v, want PermissionDenied: %v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("reason = %v, ok=%v, want PROTECTED_ORIGIN_ROLE_MISMATCH", reason, ok)
	}
}
