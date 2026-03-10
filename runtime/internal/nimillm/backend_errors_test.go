package nimillm

import (
	"context"
	"net"
	"strings"
	"testing"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func extractErrorInfoMetadata(err error) map[string]string {
	st, ok := status.FromError(err)
	if !ok {
		return nil
	}
	for _, detail := range st.Details() {
		info, ok := detail.(*errdetails.ErrorInfo)
		if !ok {
			continue
		}
		return info.GetMetadata()
	}
	return nil
}

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

func TestMapProviderHTTPError_BadRequestQuotaExceededMapsRateLimited(t *testing.T) {
	err := MapProviderHTTPError(400, map[string]any{
		"error": map[string]any{
			"message": "You exceeded your current quota, please check your plan and billing details",
		},
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 400 quota exceeded")
	}
	if st.Code() != codes.ResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED {
		t.Fatalf("expected AI_PROVIDER_RATE_LIMITED, got %v", reason)
	}
	metadata := extractErrorInfoMetadata(err)
	if metadata["action_hint"] != "replenish_provider_balance_or_skip_live_test" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
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

func TestMapProviderHTTPError_BadRequestModelNotFound(t *testing.T) {
	err := MapProviderHTTPError(400, map[string]any{
		"error": map[string]any{
			"message": "Model not found: qwen-tts-2025-05-22",
		},
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 400 model-not-found")
	}
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
		t.Fatalf("expected AI_MODEL_NOT_FOUND, got %v", reason)
	}
	metadata := extractErrorInfoMetadata(err)
	if metadata["provider_message"] == "" {
		t.Fatalf("expected provider_message metadata, got %#v", metadata)
	}
	if metadata["action_hint"] != "switch_model_or_refresh_connector_models" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
	}
}

func TestMapProviderHTTPError_BadRequestModalityNotSupported(t *testing.T) {
	err := MapProviderHTTPError(400, map[string]any{
		"error": map[string]any{
			"message": "This model does not support audio generation for TTS",
		},
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 400 modality-not-supported")
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("expected AI_MODALITY_NOT_SUPPORTED, got %v", reason)
	}
	metadata := extractErrorInfoMetadata(err)
	if metadata["action_hint"] != "select_model_with_required_capability" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
	}
}

func TestMapProviderHTTPError_BadRequestMediaOptionUnsupported(t *testing.T) {
	err := MapProviderHTTPError(400, map[string]any{
		"error": map[string]any{
			"message": "unsupported voice parameter: alloy",
		},
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 400 media-option-unsupported")
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v", reason)
	}
	metadata := extractErrorInfoMetadata(err)
	if metadata["action_hint"] != "adjust_tts_voice_or_audio_options" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
	}
}

func TestMapProviderHTTPError_BadRequestImageInputInvalid(t *testing.T) {
	err := MapProviderHTTPError(400, map[string]any{
		"error": map[string]any{
			"message": "url error, please check url!",
		},
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 400 image-input-invalid")
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("expected AI_INPUT_INVALID, got %v", reason)
	}
	metadata := extractErrorInfoMetadata(err)
	if metadata["action_hint"] != "check_image_input_and_response_format" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
	}
}

func TestMapProviderHTTPError_BadRequestPlanGateFromDetailMessage(t *testing.T) {
	err := MapProviderHTTPError(400, map[string]any{
		"detail": map[string]any{
			"message": "Instant Voice Cloning is only available on a paid plan. This subscription does not include instant voice cloning.",
		},
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 400 paid-plan gate")
	}
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("expected AI_PROVIDER_AUTH_FAILED, got %v", reason)
	}
	if !strings.Contains(strings.ToLower(st.Message()), "paid plan") {
		t.Fatalf("expected status message to mention paid plan, got %q", st.Message())
	}
	metadata := extractErrorInfoMetadata(err)
	if metadata["provider_message"] == "" {
		t.Fatalf("expected provider_message metadata, got %#v", metadata)
	}
	if metadata["action_hint"] != "upgrade_provider_plan_or_use_supported_capability" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
	}
}

func TestMapProviderHTTPError_ForbiddenPreservesNestedDetailMessage(t *testing.T) {
	err := MapProviderHTTPError(403, map[string]any{
		"detail": map[string]any{
			"message": "API voice creation is only available on a paid plan.",
		},
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 403")
	}
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("expected AI_PROVIDER_AUTH_FAILED, got %v", reason)
	}
	if st.Message() != "API voice creation is only available on a paid plan." {
		t.Fatalf("unexpected status message: %q", st.Message())
	}
	metadata := extractErrorInfoMetadata(err)
	if metadata["provider_message"] != "API voice creation is only available on a paid plan." {
		t.Fatalf("unexpected provider_message metadata: %#v", metadata)
	}
}

func TestMapProviderHTTPError_PaymentRequiredInsufficientBalance(t *testing.T) {
	err := MapProviderHTTPError(402, map[string]any{
		"message": "Invalid api key or insufficient balance",
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 402")
	}
	if st.Code() != codes.ResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED {
		t.Fatalf("expected AI_PROVIDER_RATE_LIMITED, got %v", reason)
	}
	if !strings.Contains(st.Message(), "Invalid api key or insufficient balance") {
		t.Fatalf("unexpected status message: %q", st.Message())
	}
	metadata := extractErrorInfoMetadata(err)
	if metadata["action_hint"] != "replenish_provider_balance_or_skip_live_test" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
	}
	if metadata["provider_message"] != "Invalid api key or insufficient balance" {
		t.Fatalf("unexpected provider_message: %q", metadata["provider_message"])
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

func TestMapProviderHTTPError_ModelNotFoundIncludesProviderMessage(t *testing.T) {
	err := MapProviderHTTPError(404, map[string]any{
		"error": map[string]any{
			"message": "model qwen3-tts-instruct-flash-2026-01-26 not found for this endpoint",
		},
	})
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error for HTTP 404")
	}
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
		t.Fatalf("expected AI_MODEL_NOT_FOUND, got %v", reason)
	}
	if st.Message() == "" {
		t.Fatal("expected provider message in status message")
	}
	metadata := extractErrorInfoMetadata(err)
	if metadata["action_hint"] != "switch_model_or_refresh_connector_models" {
		t.Fatalf("unexpected action_hint: %q", metadata["action_hint"])
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

func TestProviderErrorMessage_DetailFallbacks(t *testing.T) {
	tests := []struct {
		name    string
		payload map[string]any
		want    string
	}{
		{
			name: "detail message map",
			payload: map[string]any{
				"detail": map[string]any{
					"message": "provider detail message",
				},
			},
			want: "provider detail message",
		},
		{
			name: "detail msg map",
			payload: map[string]any{
				"detail": map[string]any{
					"msg": "provider detail msg",
				},
			},
			want: "provider detail msg",
		},
		{
			name: "detail array message",
			payload: map[string]any{
				"detail": []any{
					map[string]any{"message": "first array detail"},
					map[string]any{"message": "second array detail"},
				},
			},
			want: "first array detail",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ProviderErrorMessage(tc.payload); got != tc.want {
				t.Fatalf("ProviderErrorMessage() = %q, want %q", got, tc.want)
			}
		})
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
