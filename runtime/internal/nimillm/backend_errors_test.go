package nimillm

import (
	"context"
	"net"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestMapProviderHTTPError_ProviderAuthFailed(t *testing.T) {
	for _, code := range []int{401, 403} {
		err := MapProviderHTTPError(code, nil)
		st, ok := status.FromError(err)
		if !ok {
			t.Fatalf("expected gRPC status error for HTTP %d", code)
		}
		if st.Code() != codes.FailedPrecondition {
			t.Fatalf("HTTP %d: expected FailedPrecondition, got %v", code, st.Code())
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
			t.Fatalf("HTTP %d: expected AI_PROVIDER_AUTH_FAILED, got %v", code, reason)
		}
	}
}

func TestMapProviderHTTPError_ProviderRateLimited(t *testing.T) {
	err := MapProviderHTTPError(429, nil)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 429")
	}
	if st.Code() != codes.ResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED {
		t.Fatalf("expected AI_PROVIDER_RATE_LIMITED, got %v", reason)
	}
}

func TestMapProviderHTTPError_ProviderInternal(t *testing.T) {
	err := MapProviderHTTPError(500, nil)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 500")
	}
	if st.Code() != codes.Internal {
		t.Fatalf("expected Internal, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_INTERNAL {
		t.Fatalf("expected AI_PROVIDER_INTERNAL, got %v", reason)
	}
}

func TestMapProviderHTTPError_ProviderUnavailable(t *testing.T) {
	for _, code := range []int{502, 503} {
		err := MapProviderHTTPError(code, nil)
		st, ok := status.FromError(err)
		if !ok {
			t.Fatalf("expected gRPC status error for HTTP %d", code)
		}
		if st.Code() != codes.Unavailable {
			t.Fatalf("HTTP %d: expected Unavailable, got %v", code, st.Code())
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
			t.Fatalf("HTTP %d: expected AI_PROVIDER_UNAVAILABLE, got %v", code, reason)
		}
	}
}

func TestMapProviderHTTPError_ContentFilter(t *testing.T) {
	err := MapProviderHTTPError(400, map[string]any{"error": map[string]any{"message": "content filter blocked"}})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
		t.Fatalf("expected AI_CONTENT_FILTER_BLOCKED, got %v", reason)
	}
}

func TestMapProviderHTTPError_BadRequest(t *testing.T) {
	err := MapProviderHTTPError(400, nil)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 400")
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("expected AI_INPUT_INVALID, got %v", reason)
	}
}

func TestMapProviderHTTPError_Timeout(t *testing.T) {
	for _, code := range []int{408, 504} {
		err := MapProviderHTTPError(code, nil)
		st, ok := status.FromError(err)
		if !ok {
			t.Fatalf("expected gRPC status error for HTTP %d", code)
		}
		if st.Code() != codes.DeadlineExceeded {
			t.Fatalf("HTTP %d: expected DeadlineExceeded, got %v", code, st.Code())
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
			t.Fatalf("HTTP %d: expected AI_PROVIDER_TIMEOUT, got %v", code, reason)
		}
	}
}

func TestMapProviderRequestError_DeadlineExceeded(t *testing.T) {
	err := MapProviderRequestError(context.DeadlineExceeded)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if st.Code() != codes.DeadlineExceeded {
		t.Fatalf("expected DeadlineExceeded, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("expected AI_PROVIDER_TIMEOUT, got %v", reason)
	}
}

func TestMapProviderRequestError_NetworkTimeout(t *testing.T) {
	err := MapProviderRequestError(&net.DNSError{IsTimeout: true})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("expected AI_PROVIDER_TIMEOUT, got %v", reason)
	}
}

func TestMapProviderRequestError_GenericNetwork(t *testing.T) {
	err := MapProviderRequestError(&net.DNSError{})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("expected AI_PROVIDER_UNAVAILABLE, got %v", reason)
	}
}

func TestMapProviderRequestError_Nil(t *testing.T) {
	if err := MapProviderRequestError(nil); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestMapOpenAIFinishReason(t *testing.T) {
	tests := []struct {
		input string
		want  runtimev1.FinishReason
	}{
		{"stop", runtimev1.FinishReason_FINISH_REASON_STOP},
		{"length", runtimev1.FinishReason_FINISH_REASON_LENGTH},
		{"tool_calls", runtimev1.FinishReason_FINISH_REASON_TOOL_CALL},
		{"tool_call", runtimev1.FinishReason_FINISH_REASON_TOOL_CALL},
		{"content_filter", runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER},
		{"error", runtimev1.FinishReason_FINISH_REASON_ERROR},
		{"unknown", runtimev1.FinishReason_FINISH_REASON_STOP},
		{"STOP", runtimev1.FinishReason_FINISH_REASON_STOP},
		{" Length ", runtimev1.FinishReason_FINISH_REASON_LENGTH},
	}
	for _, tc := range tests {
		got := MapOpenAIFinishReason(tc.input)
		if got != tc.want {
			t.Errorf("MapOpenAIFinishReason(%q) = %v, want %v", tc.input, got, tc.want)
		}
	}
}
