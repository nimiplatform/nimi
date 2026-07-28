package auth

import (
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type protectedDesktopPrivateCause struct {
	detail string
}

func (e *protectedDesktopPrivateCause) Error() string {
	return e.detail
}

func TestProtectedDesktopSessionErrorPreservesCauseWithoutLeakingDetail(t *testing.T) {
	cause := &protectedDesktopPrivateCause{detail: `open protected desktop session from C:\private\desktop.exe`}

	mapped := protectedDesktopSessionError(cause)

	if !errors.Is(mapped, cause) {
		t.Fatal("mapped error does not preserve the original cause")
	}
	var typedCause *protectedDesktopPrivateCause
	if !errors.As(mapped, &typedCause) || typedCause != cause {
		t.Fatalf("mapped error does not preserve the typed cause: %#v", typedCause)
	}
	reason, ok := grpcerr.ExtractReasonCode(mapped)
	if status.Code(mapped) != codes.Unavailable || !ok || reason != runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE {
		t.Fatalf("mapped error = code=%s reason=%s present=%v", status.Code(mapped), reason, ok)
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(mapped)
	if !ok || metadata["action_hint"] != "restart_runtime_service" {
		t.Fatalf("mapped action metadata = %#v present=%v", metadata, ok)
	}
	publicMessage := status.Convert(mapped).Message()
	if strings.Contains(publicMessage, cause.detail) || !strings.Contains(publicMessage, "protected desktop session could not be opened") {
		t.Fatalf("unsafe or unexpected public status message: %q", publicMessage)
	}
}
