package grpcerr

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const domain = "nimi.runtime.v1"
const maxPublicMessageBytes = 2 * 1024

type ReasonOptions struct {
	ActionHint string
	TraceID    string
	Retryable  *bool
	Message    string
	Metadata   map[string]string
}

type causalStatusError struct {
	status *status.Status
	cause  error
}

func (e *causalStatusError) Error() string {
	return e.status.Err().Error()
}

func (e *causalStatusError) Unwrap() error {
	return e.cause
}

func (e *causalStatusError) GRPCStatus() *status.Status {
	return e.status
}

// WithReasonCode builds a gRPC Status error carrying a google.rpc.ErrorInfo
// detail with the given ReasonCode as Reason and Domain "nimi.runtime.v1".
// This satisfies K-ERR-003: ReasonCode MUST be transported in ErrorInfo details,
// not in the status message string.
func WithReasonCode(code codes.Code, reason runtimev1.ReasonCode) error {
	return WithReasonCodeOptions(code, reason, ReasonOptions{})
}

// WrapWithReasonCode builds a structured public gRPC status while retaining
// cause for in-process errors.Is/errors.As inspection. The cause is never
// copied into the status message or ErrorInfo metadata; callers must provide
// only transport-safe text in options.Message.
func WrapWithReasonCode(
	code codes.Code,
	reason runtimev1.ReasonCode,
	cause error,
	options ReasonOptions,
) error {
	if options.ActionHint == "" {
		options.ActionHint = defaultActionHint(reason)
	}
	publicErr := WithReasonCodeOptions(code, reason, options)
	if cause == nil {
		return publicErr
	}
	st, ok := status.FromError(publicErr)
	if !ok {
		return publicErr
	}
	return &causalStatusError{
		status: st,
		cause:  cause,
	}
}

// @nimi-authority: definition.nimi.runtime.rpc-foundations.error-plane
// WithReasonCodeOptions builds a gRPC status error with ErrorInfo details.
// Extra transport-safe fields (action_hint/retryable/trace_id) are encoded in
// ErrorInfo.Metadata and available to bridge/SDK layers.
func WithReasonCodeOptions(code codes.Code, reason runtimev1.ReasonCode, options ReasonOptions) error {
	publicMessage := boundedPublicMessage(options.Message)
	message := publicMessage
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
	if metadata["action_hint"] == "" {
		metadata["action_hint"] = defaultActionHint(reason)
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
		if publicMessage != "" {
			payload["message"] = publicMessage
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

func boundedPublicMessage(input string) string {
	message := strings.TrimSpace(strings.ToValidUTF8(input, "\uFFFD"))
	if len(message) <= maxPublicMessageBytes {
		return message
	}
	message = message[:maxPublicMessageBytes]
	for !utf8.ValidString(message) {
		_, size := utf8.DecodeLastRuneInString(message)
		if size <= 0 || size > len(message) {
			return ""
		}
		message = message[:len(message)-size]
	}
	return strings.TrimSpace(message)
}

func defaultActionHint(reason runtimev1.ReasonCode) string {
	if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return "inspect_error_and_retry_with_corrected_request"
	}
	return "inspect_reason_code_and_retry_with_corrected_request"
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

// ExtractReasonMetadata extracts ErrorInfo metadata from a gRPC error carrying
// the nimi.runtime.v1 ErrorInfo detail.
func ExtractReasonMetadata(err error) (map[string]string, bool) {
	if err == nil {
		return nil, false
	}
	st, ok := status.FromError(err)
	if !ok {
		return nil, false
	}
	for _, detail := range st.Details() {
		if info, ok := detail.(*errdetails.ErrorInfo); ok && info.GetDomain() == domain {
			if len(info.GetMetadata()) == 0 {
				return map[string]string{}, true
			}
			metadata := make(map[string]string, len(info.GetMetadata()))
			for key, value := range info.GetMetadata() {
				if key == "" || value == "" {
					continue
				}
				metadata[key] = value
			}
			return metadata, true
		}
	}
	return nil, false
}

// ExtractPublicMessage returns the explicit transport-safe Message attached by
// this package. It does not return the fallback ReasonCode string or a raw
// status payload, and ignores statuses outside the nimi.runtime.v1 domain.
func ExtractPublicMessage(err error) (string, bool) {
	reason, ok := ExtractReasonCode(err)
	if !ok {
		return "", false
	}
	st, ok := status.FromError(err)
	if !ok {
		return "", false
	}
	message := strings.TrimSpace(st.Message())
	if message == "" || message == reason.String() {
		return "", false
	}

	var payload struct {
		Message string `json:"message"`
	}
	if json.Unmarshal([]byte(message), &payload) == nil {
		explicit := strings.TrimSpace(payload.Message)
		if explicit == "" {
			return "", false
		}
		return explicit, true
	}
	return message, true
}
