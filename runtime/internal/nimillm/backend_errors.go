package nimillm

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// MapProviderRequestError maps a network/request error to gRPC status.
func MapProviderRequestError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
	}
	return status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

// MapProviderHTTPError maps an HTTP status code to gRPC status.
func MapProviderHTTPError(statusCode int, payload map[string]any) error {
	message := strings.ToLower(strings.TrimSpace(ProviderErrorMessage(payload)))
	if IsContentFilterMessage(message) {
		return status.Error(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED.String())
	}
	switch statusCode {
	case http.StatusBadRequest:
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	case http.StatusUnauthorized, http.StatusForbidden:
		return status.Error(codes.PermissionDenied, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	case http.StatusNotFound:
		return status.Error(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND.String())
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
	case http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable:
		return status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	default:
		return status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
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
