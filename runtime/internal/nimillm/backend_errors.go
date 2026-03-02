package nimillm

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

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

// MapProviderRequestError maps a network/request error to gRPC status.
func MapProviderRequestError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	}
	return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
}

// MapProviderHTTPError maps an HTTP status code to gRPC status.
func MapProviderHTTPError(statusCode int, payload map[string]any) error {
	providerMessage := normalizeProviderErrorMessage(ProviderErrorMessage(payload))
	if IsContentFilterMessage(strings.ToLower(providerMessage)) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}
	switch statusCode {
	case http.StatusBadRequest:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	case http.StatusUnauthorized, http.StatusForbidden:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED)
	case http.StatusNotFound:
		if providerMessage != "" {
			return grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, grpcerr.ReasonOptions{
				Message: providerMessage,
				Metadata: map[string]string{
					"provider_message": providerMessage,
				},
			})
		}
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
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
	if message == "" {
		return false
	}
	return strings.Contains(message, "content filter") ||
		strings.Contains(message, "content policy") ||
		strings.Contains(message, "safety") ||
		strings.Contains(message, "blocked")
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

// ProviderErrorMessage extracts an error message from a provider response payload.
func ProviderErrorMessage(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	if message, ok := payload["message"].(string); ok {
		return message
	}
	errorField, exists := payload["error"]
	if !exists {
		return ""
	}
	switch item := errorField.(type) {
	case string:
		return item
	case map[string]any:
		if message, ok := item["message"].(string); ok {
			return message
		}
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
