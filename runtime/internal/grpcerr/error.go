package grpcerr

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const domain = "nimi.runtime.v1"

// WithReasonCode builds a gRPC Status error carrying a google.rpc.ErrorInfo
// detail with the given ReasonCode as Reason and Domain "nimi.runtime.v1".
// This satisfies K-ERR-003: ReasonCode MUST be transported in ErrorInfo details,
// not in the status message string.
func WithReasonCode(code codes.Code, reason runtimev1.ReasonCode) error {
	st := status.New(code, reason.String())
	detailed, err := st.WithDetails(&errdetails.ErrorInfo{
		Reason: reason.String(),
		Domain: domain,
	})
	if err != nil {
		// WithDetails can only fail if the proto serialization fails,
		// which should never happen for ErrorInfo. Fall back to plain status.
		return st.Err()
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
