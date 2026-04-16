package nimillm

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const maxProviderErrorMessageLen = 240

func normalizeProviderErrorMessage(input string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(input, "\n", " "), "\t", " "))
	if normalized == "" {
		return ""
	}
	if len(normalized) > maxProviderErrorMessageLen {
		return strings.TrimSpace(normalized[:maxProviderErrorMessageLen]) + "..."
	}
	return normalized
}

func containsAnyToken(input string, tokens ...string) bool {
	for _, token := range tokens {
		if token == "" {
			continue
		}
		if strings.Contains(input, token) {
			return true
		}
	}
	return false
}

func classifyProviderBadRequest(providerMessage string) (codes.Code, runtimev1.ReasonCode, string) {
	normalized := strings.ToLower(strings.TrimSpace(providerMessage))

	planOrEntitlementBlocked := containsAnyToken(
		normalized,
		"paid plan",
		"subscription does not include",
		"payment required",
		"paid_plan_required",
		"only available on a paid plan",
		"upgrade your plan",
	)
	if planOrEntitlementBlocked {
		return codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, "upgrade_provider_plan_or_use_supported_capability"
	}

	balanceBlocked := containsAnyToken(
		normalized,
		"insufficient balance",
		"insufficient credits",
		"not enough balance",
		"out of credits",
		"exceeded your current quota",
		"check your plan and billing details",
		"quota exceeded",
		"quota_exceeded",
	)
	if balanceBlocked {
		return codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, "replenish_provider_balance_or_skip_live_test"
	}

	authFailed := containsAnyToken(
		normalized,
		"api key not valid",
		"api key invalid",
		"invalid api key",
		"invalid_api_key",
		"api_key_invalid",
		"invalid authentication",
		"invalid auth",
		"authentication failed",
		"auth failed",
	)
	if authFailed {
		return codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, "refresh_provider_api_key_or_reconnect_connector"
	}

	modelNotFound := containsAnyToken(
		normalized,
		"model not found",
		"unknown model",
		"no such model",
		"model does not exist",
		"model is not available",
		"invalid model",
	)
	if modelNotFound {
		return codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, "switch_model_or_refresh_connector_models"
	}

	modalityNotSupported := containsAnyToken(
		normalized,
		"modality not supported",
		"unsupported modality",
		"does not support tts",
		"not support tts",
		"audio generation is not supported",
		"speech synthesis is not supported",
		"does not support audio",
	)
	if modalityNotSupported {
		return codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED, "select_model_with_required_capability"
	}

	mentionsTTSOption := containsAnyToken(
		normalized,
		"voice",
		"audio format",
		"sample rate",
		"speaker",
		"speed",
		"pitch",
		"style",
		"instruct",
	)
	invalidOrUnsupported := containsAnyToken(
		normalized,
		"unsupported",
		"not supported",
		"invalid",
		"must be",
		"out of range",
		"unrecognized",
	)
	if mentionsTTSOption && invalidOrUnsupported {
		return codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, "adjust_tts_voice_or_audio_options"
	}

	mentionsImageInput := containsAnyToken(
		normalized,
		"url error",
		"image url",
		"reference image",
		"mask",
		"aspect ratio",
		"ratio",
		"resolution",
		"size",
		"width",
		"height",
		"png",
		"jpg",
		"jpeg",
		"webp",
	)
	if mentionsImageInput || (containsAnyToken(normalized, "image") && invalidOrUnsupported) {
		return codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, "check_image_input_and_response_format"
	}

	return codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, "check_input_and_extensions"
}

// MapProviderRequestError maps a network/request error to gRPC status.
func MapProviderRequestError(err error) error {
	if err == nil {
		return nil
	}
	providerMessage := normalizeProviderErrorMessage(err.Error())
	metadata := map[string]string{}
	if providerMessage != "" {
		metadata["provider_message"] = providerMessage
	}
	if st, ok := status.FromError(err); ok {
		switch st.Code() {
		case codes.DeadlineExceeded:
			return grpcerr.WithReasonCodeOptions(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, grpcerr.ReasonOptions{
				ActionHint: "retry_or_check_provider_endpoint",
				Message:    "provider request timed out",
				Metadata:   metadata,
			})
		case codes.Unavailable:
			return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
				ActionHint: "check_provider_endpoint_or_local_runtime_health",
				Message:    "provider request failed",
				Metadata:   metadata,
			})
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return grpcerr.WithReasonCodeOptions(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_provider_endpoint",
			Message:    "provider request timed out",
			Metadata:   metadata,
		})
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return grpcerr.WithReasonCodeOptions(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_provider_endpoint",
			Message:    "provider request timed out",
			Metadata:   metadata,
		})
	}
	return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
		ActionHint: "check_provider_endpoint_or_local_runtime_health",
		Message:    "provider request failed",
		Metadata:   metadata,
	})
}

// MapProviderHTTPError maps an HTTP status code to gRPC status.
func MapProviderHTTPError(statusCode int, payload map[string]any) error {
	providerMessage := normalizeProviderErrorMessage(ProviderErrorMessage(payload))
	metadata := map[string]string{}
	if providerMessage != "" {
		metadata["provider_message"] = providerMessage
	}
	if IsContentFilterMessage(strings.ToLower(providerMessage)) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}
	const genericProviderFailure = "provider request failed"
	const genericAuthFailure = "provider authentication failed"
	const genericModelNotFound = "requested model is unavailable"
	switch statusCode {
	case http.StatusBadRequest:
		grpcCode, reasonCode, actionHint := classifyProviderBadRequest(providerMessage)
		message := genericProviderFailure
		if reasonCode == runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
			message = genericAuthFailure
		}
		return grpcerr.WithReasonCodeOptions(grpcCode, reasonCode, grpcerr.ReasonOptions{
			ActionHint: actionHint,
			Message:    message,
			Metadata:   metadata,
		})
	case http.StatusUnauthorized, http.StatusForbidden:
		return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, grpcerr.ReasonOptions{
			Message:  genericAuthFailure,
			Metadata: metadata,
		})
	case http.StatusPaymentRequired:
		if providerMessage == "" {
			return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED)
		}
		grpcCode, reasonCode, actionHint := classifyProviderBadRequest(providerMessage)
		return grpcerr.WithReasonCodeOptions(grpcCode, reasonCode, grpcerr.ReasonOptions{
			ActionHint: actionHint,
			Message:    genericProviderFailure,
			Metadata:   metadata,
		})
	case http.StatusNotFound:
		return grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, grpcerr.ReasonOptions{
			ActionHint: "switch_model_or_refresh_connector_models",
			Message:    genericModelNotFound,
			Metadata:   metadata,
		})
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	case http.StatusTooManyRequests:
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED)
	case http.StatusInternalServerError:
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	case http.StatusBadGateway, http.StatusServiceUnavailable:
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	default:
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}

// IsContentFilterMessage checks if an error message indicates content filtering.
func IsContentFilterMessage(message string) bool {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if normalized == "" {
		return false
	}
	return strings.Contains(normalized, "content filter") ||
		strings.Contains(normalized, "content policy") ||
		strings.Contains(normalized, "safety filter") ||
		strings.Contains(normalized, "blocked by safety") ||
		strings.Contains(normalized, "blocked by policy")
}

// IsStreamUnsupported checks if the response indicates streaming is not supported.
func IsStreamUnsupported(statusCode int, payload map[string]any) bool {
	switch statusCode {
	case http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusNotImplemented:
		return true
	}
	message := strings.ToLower(strings.TrimSpace(ProviderErrorMessage(payload)))
	if message == "" {
		return false
	}
	if strings.Contains(message, "stream") && strings.Contains(message, "support") {
		return true
	}
	if strings.Contains(message, "sse") && strings.Contains(message, "support") {
		return true
	}
	return false
}

func providerErrorMessageFromValue(value any) string {
	switch item := value.(type) {
	case string:
		return item
	case map[string]any:
		if message, ok := item["message"].(string); ok {
			return message
		}
		if message, ok := item["msg"].(string); ok {
			return message
		}
	case []any:
		for _, entry := range item {
			if message := providerErrorMessageFromValue(entry); message != "" {
				return message
			}
		}
	}
	return ""
}

// ProviderErrorMessage extracts an error message from a provider response payload.
func ProviderErrorMessage(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	if message, ok := payload["message"].(string); ok {
		return message
	}
	if message := providerErrorMessageFromValue(payload["error"]); message != "" {
		return message
	}
	if message := providerErrorMessageFromValue(payload["detail"]); message != "" {
		return message
	}
	return ""
}

// MapOpenAIFinishReason maps an OpenAI finish_reason string to proto enum.
func MapOpenAIFinishReason(value string) runtimev1.FinishReason {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "stop":
		return runtimev1.FinishReason_FINISH_REASON_STOP
	case "length":
		return runtimev1.FinishReason_FINISH_REASON_LENGTH
	case "tool_calls", "tool_call":
		return runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
	case "content_filter":
		return runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER
	case "error":
		return runtimev1.FinishReason_FINISH_REASON_ERROR
	default:
		return runtimev1.FinishReason_FINISH_REASON_STOP
	}
}
