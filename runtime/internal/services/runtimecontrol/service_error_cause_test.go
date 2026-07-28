package runtimecontrol

import (
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type restartAuthorizationPrivateCause struct {
	detail string
}

func (e *restartAuthorizationPrivateCause) Error() string {
	return e.detail
}

func TestProtectedRestartAuthorizationErrorPreservesCauseWithoutLeakingDetail(t *testing.T) {
	cause := &restartAuthorizationPrivateCause{detail: `authorize runtime restart with ledger C:\private\protected-local.db`}

	mapped := protectedRestartAuthorizationError(cause)

	if !errors.Is(mapped, cause) {
		t.Fatal("mapped error does not preserve the original cause")
	}
	var typedCause *restartAuthorizationPrivateCause
	if !errors.As(mapped, &typedCause) || typedCause != cause {
		t.Fatalf("mapped error does not preserve the typed cause: %#v", typedCause)
	}
	reason, ok := grpcerr.ExtractReasonCode(mapped)
	if status.Code(mapped) != codes.Unavailable || !ok || reason != runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE {
		t.Fatalf("mapped error = code=%s reason=%s present=%v", status.Code(mapped), reason, ok)
	}
	publicMessage := status.Convert(mapped).Message()
	if strings.Contains(publicMessage, cause.detail) || !strings.Contains(publicMessage, "runtime restart authorization failed") {
		t.Fatalf("unsafe or unexpected public status message: %q", publicMessage)
	}
}
