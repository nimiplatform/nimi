package grpcerr

import (
	"encoding/json"
	"fmt"
	"strconv"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const domain = "nimi.runtime.v1"

type ReasonOptions struct {
	ActionHint string
	TraceID    string
	Retryable  *bool
	Message    string
	Metadata   map[string]string
}

// WithReasonCode builds a gRPC Status error carrying a google.rpc.ErrorInfo
// detail with the given ReasonCode as Reason and Domain "nimi.runtime.v1".
// This satisfies K-ERR-003: ReasonCode MUST be transported in ErrorInfo details,
// not in the status message string.
func WithReasonCode(code codes.Code, reason runtimev1.ReasonCode) error {
	return WithReasonCodeOptions(code, reason, ReasonOptions{})
}

// WithReasonCodeOptions builds a gRPC status error with ErrorInfo details.
// Extra transport-safe fields (action_hint/retryable/trace_id) are encoded in
// ErrorInfo.Metadata and available to bridge/SDK layers.
func WithReasonCodeOptions(code codes.Code, reason runtimev1.ReasonCode, options ReasonOptions) error {
	message := options.Message
	if message == "" {
		message = reason.String()
	}

	metadata := make(map[string]string)
	for key, value := range options.Metadata {
		if key == "" || value == "" {
			continue
		}
		metadata[key] = value
	}
	if options.ActionHint != "" {
		metadata["action_hint"] = options.ActionHint
	}
	if options.TraceID != "" {
		metadata["trace_id"] = options.TraceID
	}
	if options.Retryable != nil {
		metadata["retryable"] = strconv.FormatBool(*options.Retryable)
	}

	if options.ActionHint != "" || options.TraceID != "" || options.Retryable != nil {
		payload := map[string]any{
			"reasonCode": reason.String(),
		}
		if options.ActionHint != "" {
			payload["actionHint"] = options.ActionHint
		}
		if options.TraceID != "" {
			payload["traceId"] = options.TraceID
		}
		if options.Retryable != nil {
			payload["retryable"] = *options.Retryable
		}
		if options.Message != "" {
			payload["message"] = options.Message
		}
		if encoded, err := json.Marshal(payload); err == nil {
			message = string(encoded)
		}
	}

	st := status.New(code, message)
	detailed, err := st.WithDetails(&errdetails.ErrorInfo{
		Reason:   reason.String(),
		Domain:   domain,
		Metadata: metadata,
	})
	if err != nil {
		// WithDetails can only fail if the proto serialization fails,
		// which should never happen for ErrorInfo. Surface the serialization
		// failure explicitly instead of discarding the original cause.
		return fmt.Errorf("grpcerr.WithReasonCodeOptions: attach ErrorInfo: %w", err)
	}
	return detailed.Err()
}

// ExtractReasonCode extracts the ReasonCode from a gRPC error's ErrorInfo
// detail. Returns the reason code and true if found, or (REASON_CODE_UNSPECIFIED, false)
// if the error has no ErrorInfo or is not a gRPC status error.
func ExtractReasonCode(err error) (runtimev1.ReasonCode, bool) {
	if err == nil {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
	}
	st, ok := status.FromError(err)
	if !ok {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
	}
	for _, detail := range st.Details() {
		if info, ok := detail.(*errdetails.ErrorInfo); ok && info.GetDomain() == domain {
			if val, exists := runtimev1.ReasonCode_value[info.GetReason()]; exists {
				return runtimev1.ReasonCode(val), true
			}
		}
	}
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
}
