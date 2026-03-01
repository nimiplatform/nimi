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
	message := strings.ToLower(strings.TrimSpace(ProviderErrorMessage(payload)))
	if IsContentFilterMessage(message) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}
	switch statusCode {
	case http.StatusBadRequest:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	case http.StatusUnauthorized, http.StatusForbidden:
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	case http.StatusNotFound:
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	case http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable:
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
