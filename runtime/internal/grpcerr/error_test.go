package grpcerr

import (
	"encoding/json"
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

func TestWithReasonCodeOptions_EncodesStructuredFieldsInStatusMessage(t *testing.T) {
	retryable := true
	err := WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, ReasonOptions{
		ActionHint: "retry_or_restart_runtime",
		TraceID:    "trace-test-002",
		Retryable:  &retryable,
		Message:    "provider request failed",
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected grpc status error")
	}
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(st.Message()), &payload); err != nil {
		t.Fatalf("expected structured status message json, got %q (%v)", st.Message(), err)
	}
	if payload["reasonCode"] != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String() {
		t.Fatalf("unexpected reasonCode payload: %#v", payload)
	}
	if payload["actionHint"] != "retry_or_restart_runtime" || payload["traceId"] != "trace-test-002" {
		t.Fatalf("unexpected structured payload: %#v", payload)
	}
	if payload["retryable"] != true {
		t.Fatalf("unexpected retryable payload: %#v", payload)
	}
}

func TestWithReasonCodeAlreadyExistsForMediaIdempotencyConflict(t *testing.T) {
	err := WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_MEDIA_IDEMPOTENCY_CONFLICT)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected grpc status error")
	}
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists, got %v", st.Code())
	}
	reason, ok := ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_IDEMPOTENCY_CONFLICT {
		t.Fatalf("unexpected reason: %v", reason)
	}
}

func TestReasonCodeEnumValuesMatchSpec(t *testing.T) {
	tests := []struct {
		name string
		got  int32
		want int32
	}{
		{"SESSION_EXPIRED", int32(runtimev1.ReasonCode_SESSION_EXPIRED), 7},
		{"AUTH_TOKEN_INVALID", int32(runtimev1.ReasonCode_AUTH_TOKEN_INVALID), 300},
		{"AUTH_TOKEN_EXPIRED", int32(runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED), 301},
		{"AI_CONNECTOR_NOT_FOUND", int32(runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND), 310},
		{"AI_CONNECTOR_DISABLED", int32(runtimev1.ReasonCode_AI_CONNECTOR_DISABLED), 311},
		{"AI_CONNECTOR_CREDENTIAL_MISSING", int32(runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING), 312},
		{"AI_REQUEST_CREDENTIAL_CONFLICT", int32(runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_CONFLICT), 330},
		{"AI_APP_ID_REQUIRED", int32(runtimev1.ReasonCode_AI_APP_ID_REQUIRED), 340},
		{"AI_MODEL_ID_REQUIRED", int32(runtimev1.ReasonCode_AI_MODEL_ID_REQUIRED), 350},
		{"AI_MODEL_NOT_FOUND", int32(runtimev1.ReasonCode_AI_MODEL_NOT_FOUND), 200},
		{"AI_MODALITY_NOT_SUPPORTED", int32(runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED), 351},
		{"AI_LOCAL_MODEL_UNAVAILABLE", int32(runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE), 352},
		{"AI_FINISH_LENGTH", int32(runtimev1.ReasonCode_AI_FINISH_LENGTH), 370},
		{"AI_FINISH_CONTENT_FILTER", int32(runtimev1.ReasonCode_AI_FINISH_CONTENT_FILTER), 371},
		{"AI_PROVIDER_ENDPOINT_FORBIDDEN", int32(runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN), 390},
		{"AI_PROVIDER_AUTH_FAILED", int32(runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED), 391},
		{"AI_PROVIDER_UNAVAILABLE", int32(runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE), 202},
		{"AI_PROVIDER_INTERNAL", int32(runtimev1.ReasonCode_AI_PROVIDER_INTERNAL), 392},
		{"AI_PROVIDER_RATE_LIMITED", int32(runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED), 393},
		{"AI_PROVIDER_TIMEOUT", int32(runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT), 394},
		{"AI_STREAM_BROKEN", int32(runtimev1.ReasonCode_AI_STREAM_BROKEN), 208},
		{"AI_MEDIA_SPEC_INVALID", int32(runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID), 410},
		{"AI_MEDIA_JOB_NOT_FOUND", int32(runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND), 412},
		{"AI_MEDIA_IDEMPOTENCY_CONFLICT", int32(runtimev1.ReasonCode_AI_MEDIA_IDEMPOTENCY_CONFLICT), 414},
		{"AI_VOICE_INPUT_INVALID", int32(runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID), 420},
		{"AI_VOICE_ASSET_NOT_FOUND", int32(runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND), 422},
		{"WF_DAG_INVALID", int32(runtimev1.ReasonCode_WF_DAG_INVALID), 440},
		{"APP_MODE_DOMAIN_FORBIDDEN", int32(runtimev1.ReasonCode_APP_MODE_DOMAIN_FORBIDDEN), 500},
		{"GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND", int32(runtimev1.ReasonCode_GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND), 510},
		{"PAGE_TOKEN_INVALID", int32(runtimev1.ReasonCode_PAGE_TOKEN_INVALID), 520},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != tc.want {
				t.Errorf("ReasonCode_%s = %d, want %d (spec: reason-codes.yaml)", tc.name, tc.got, tc.want)
			}
		})
	}
}
