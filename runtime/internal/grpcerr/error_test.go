package grpcerr

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestWithReasonCode_ErrorInfoPresent(t *testing.T) {
	err := WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	if err == nil {
		t.Fatal("expected non-nil error")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}

	details := st.Details()
	if len(details) != 1 {
		t.Fatalf("expected 1 detail, got %d", len(details))
	}
	info, ok := details[0].(*errdetails.ErrorInfo)
	if !ok {
		t.Fatal("expected ErrorInfo detail")
	}
	if info.GetDomain() != "nimi.runtime.v1" {
		t.Fatalf("expected domain nimi.runtime.v1, got %s", info.GetDomain())
	}
	if info.GetReason() != runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String() {
		t.Fatalf("expected reason %s, got %s",
			runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String(), info.GetReason())
	}
}

func TestWithReasonCode_PreservesCode(t *testing.T) {
	tests := []struct {
		code   codes.Code
		reason runtimev1.ReasonCode
	}{
		{codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND},
		{codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN},
		{codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
		{codes.ResourceExhausted, runtimev1.ReasonCode_AI_CONNECTOR_LIMIT_EXCEEDED},
		{codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED},
		{codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT},
	}
	for _, tc := range tests {
		err := WithReasonCode(tc.code, tc.reason)
		st, _ := status.FromError(err)
		if st.Code() != tc.code {
			t.Errorf("expected code %v, got %v", tc.code, st.Code())
		}
	}
}

func TestExtractReasonCode_Roundtrip(t *testing.T) {
	reason := runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_CONFLICT
	err := WithReasonCode(codes.InvalidArgument, reason)

	got, ok := ExtractReasonCode(err)
	if !ok {
		t.Fatal("expected to extract reason code")
	}
	if got != reason {
		t.Fatalf("expected %v, got %v", reason, got)
	}
}

func TestExtractReasonCode_NilError(t *testing.T) {
	_, ok := ExtractReasonCode(nil)
	if ok {
		t.Fatal("expected false for nil error")
	}
}

func TestExtractReasonCode_PlainStatusError(t *testing.T) {
	err := status.Error(codes.Internal, "something broke")
	_, ok := ExtractReasonCode(err)
	if ok {
		t.Fatal("expected false for plain status error without ErrorInfo")
	}
}

func TestExtractReasonCode_WrongDomain(t *testing.T) {
	st := status.New(codes.InvalidArgument, "test")
	detailed, _ := st.WithDetails(&errdetails.ErrorInfo{
		Reason: runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String(),
		Domain: "other.domain",
	})
	_, ok := ExtractReasonCode(detailed.Err())
	if ok {
		t.Fatal("expected false for wrong domain")
	}
}

func TestWithReasonCode_MessageContainsReasonString(t *testing.T) {
	reason := runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	err := WithReasonCode(codes.DeadlineExceeded, reason)
	st, _ := status.FromError(err)
	if st.Message() != reason.String() {
		t.Fatalf("expected message %q, got %q", reason.String(), st.Message())
	}
}

func TestWithReasonCodeOptions_WritesActionHintAndRetryableMetadata(t *testing.T) {
	retryable := true
	err := WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, ReasonOptions{
		ActionHint: "retry_or_restart_runtime",
		TraceID:    "trace-test-001",
		Retryable:  &retryable,
	})
	if err == nil {
		t.Fatal("expected non-nil error")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected grpc status error")
	}
	details := st.Details()
	if len(details) != 1 {
		t.Fatalf("expected 1 detail, got %d", len(details))
	}
	info, ok := details[0].(*errdetails.ErrorInfo)
	if !ok {
		t.Fatal("expected ErrorInfo detail")
	}
	if info.GetMetadata()["action_hint"] != "retry_or_restart_runtime" {
		t.Fatalf("unexpected action_hint: %q", info.GetMetadata()["action_hint"])
	}
	if info.GetMetadata()["trace_id"] != "trace-test-001" {
		t.Fatalf("unexpected trace_id: %q", info.GetMetadata()["trace_id"])
	}
	if info.GetMetadata()["retryable"] != "true" {
		t.Fatalf("unexpected retryable: %q", info.GetMetadata()["retryable"])
	}
}
