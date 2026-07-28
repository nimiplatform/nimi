package authn

import (
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type authnPrivateCause struct {
	detail string
	cause  error
}

func (e *authnPrivateCause) Error() string {
	return e.detail
}

func (e *authnPrivateCause) Unwrap() error {
	return e.cause
}

func TestAuthnFailureErrorPreservesCauseWithoutLeakingDetail(t *testing.T) {
	cause := &authnPrivateCause{
		detail: "revoked private bearer token: eyJ-secret",
		cause:  errSessionRevoked,
	}

	mapped := authnFailureError(cause)

	if !errors.Is(mapped, cause) {
		t.Fatal("mapped error does not preserve the original cause")
	}
	var typedCause *authnPrivateCause
	if !errors.As(mapped, &typedCause) || typedCause != cause {
		t.Fatalf("mapped error does not preserve the typed cause: %#v", typedCause)
	}
	reason, ok := grpcerr.ExtractReasonCode(mapped)
	if status.Code(mapped) != codes.Unauthenticated || !ok || reason != runtimev1.ReasonCode_SESSION_EXPIRED {
		t.Fatalf("mapped error = code=%s reason=%s present=%v", status.Code(mapped), reason, ok)
	}
	publicMessage := status.Convert(mapped).Message()
	if strings.Contains(publicMessage, cause.detail) || !strings.Contains(publicMessage, "runtime account session has expired") {
		t.Fatalf("unsafe or unexpected public status message: %q", publicMessage)
	}
}
