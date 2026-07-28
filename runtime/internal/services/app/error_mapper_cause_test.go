package app

import (
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type appMapperPrivateCause struct {
	detail string
	cause  error
}

func (e *appMapperPrivateCause) Error() string {
	return e.detail
}

func (e *appMapperPrivateCause) Unwrap() error {
	return e.cause
}

func TestLocalAppStorageFailurePreservesCauseWithoutLeakingDetail(t *testing.T) {
	cause := &appMapperPrivateCause{
		detail: `read local app storage C:\Users\private\principal-a\state.json`,
		cause:  appstorage.ErrLocalAppJSONNotFound,
	}

	mapped := localAppStorageFailure(cause)

	if !errors.Is(mapped, cause) {
		t.Fatal("mapped error does not preserve the original cause")
	}
	var typedCause *appMapperPrivateCause
	if !errors.As(mapped, &typedCause) || typedCause != cause {
		t.Fatalf("mapped error does not preserve the typed cause: %#v", typedCause)
	}
	reason, ok := grpcerr.ExtractReasonCode(mapped)
	if status.Code(mapped) != codes.NotFound || !ok || reason != runtimev1.ReasonCode_APP_STORAGE_ENTRY_NOT_FOUND {
		t.Fatalf("mapped error = code=%s reason=%s present=%v", status.Code(mapped), reason, ok)
	}
	publicMessage := status.Convert(mapped).Message()
	if strings.Contains(publicMessage, cause.detail) || !strings.Contains(publicMessage, "local app storage operation failed") {
		t.Fatalf("unsafe or unexpected public status message: %q", publicMessage)
	}
}

func TestLocalDevelopmentSessionOpenErrorPreservesCauseAndPureValidationShape(t *testing.T) {
	cause := &appMapperPrivateCause{
		detail: `open local development session with private proof at C:\workspace\secret`,
		cause:  errLocalDevelopmentProcessMismatch,
	}

	mapped := localDevelopmentSessionOpenError(cause)

	if !errors.Is(mapped, cause) {
		t.Fatal("mapped session-open error does not preserve the original cause")
	}
	var typedCause *appMapperPrivateCause
	if !errors.As(mapped, &typedCause) || typedCause != cause {
		t.Fatalf("mapped session-open error does not preserve the typed cause: %#v", typedCause)
	}
	reason, ok := grpcerr.ExtractReasonCode(mapped)
	if status.Code(mapped) != codes.PermissionDenied || !ok || reason != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("mapped session-open error = code=%s reason=%s present=%v", status.Code(mapped), reason, ok)
	}
	publicMessage := status.Convert(mapped).Message()
	if strings.Contains(publicMessage, cause.detail) || !strings.Contains(publicMessage, "local development operation failed") {
		t.Fatalf("unsafe or unexpected public session-open message: %q", publicMessage)
	}

	validation := localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	if got := status.Convert(validation).Message(); got != runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED.String() {
		t.Fatalf("pure validation message changed to %q", got)
	}
}

func TestLocalDevelopmentStoreErrorPreservesCauseWithoutLeakingDetail(t *testing.T) {
	cause := &appMapperPrivateCause{
		detail: `load local development state from C:\workspace\private\.nimi`,
		cause:  errLocalDevelopmentLaunchMismatch,
	}

	mapped := localDevelopmentStoreError(cause)

	if !errors.Is(mapped, cause) {
		t.Fatal("mapped store error does not preserve the original cause")
	}
	var typedCause *appMapperPrivateCause
	if !errors.As(mapped, &typedCause) || typedCause != cause {
		t.Fatalf("mapped store error does not preserve the typed cause: %#v", typedCause)
	}
	reason, ok := grpcerr.ExtractReasonCode(mapped)
	if status.Code(mapped) != codes.PermissionDenied || !ok || reason != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("mapped store error = code=%s reason=%s present=%v", status.Code(mapped), reason, ok)
	}
	publicMessage := status.Convert(mapped).Message()
	if strings.Contains(publicMessage, cause.detail) || !strings.Contains(publicMessage, "local development operation failed") {
		t.Fatalf("unsafe or unexpected public store message: %q", publicMessage)
	}
}

func TestLocalDevelopmentFailureAtStagePreservesCauseAndMetadata(t *testing.T) {
	cause := &appMapperPrivateCause{
		detail: `resolve local development project at C:\workspace\private`,
		cause:  errLocalDevelopmentProjectChanged,
	}

	mapped := localDevelopmentFailureAtStageFromCause(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE,
		"project-authority",
		cause,
	)

	if !errors.Is(mapped, cause) {
		t.Fatal("mapped staged error does not preserve the original cause")
	}
	var typedCause *appMapperPrivateCause
	if !errors.As(mapped, &typedCause) || typedCause != cause {
		t.Fatalf("mapped staged error does not preserve the typed cause: %#v", typedCause)
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(mapped)
	if !ok || metadata["diagnostic_stage"] != "project-authority" || metadata["action_hint"] == "" {
		t.Fatalf("mapped staged metadata = %#v present=%v", metadata, ok)
	}
	publicMessage := status.Convert(mapped).Message()
	if strings.Contains(publicMessage, cause.detail) || !strings.Contains(publicMessage, "local development operation failed") {
		t.Fatalf("unsafe or unexpected public staged message: %q", publicMessage)
	}
}
