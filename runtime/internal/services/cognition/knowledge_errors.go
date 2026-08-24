package cognition

import (
	"errors"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r004
// cognitionBridgeError is the single Runtime projection seam for errors
// returned after a RuntimeBridge call. Cross-cutting authorization and
// pagination failures retain their owner category before operation-specific
// fallback mapping is applied.
func cognitionBridgeError(cause error, fallbackCode codes.Code, fallbackReason runtimev1.ReasonCode, options grpcerr.ReasonOptions) error {
	if cause == nil {
		return nil
	}
	if cognitionpkg.IsRuntimeAuthorizationDenied(cause) {
		return grpcerr.WrapWithReasonCode(
			codes.PermissionDenied,
			runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			cause,
			grpcerr.ReasonOptions{Message: "cognition authorization expired or no longer matches the operation owner"},
		)
	}
	if errors.Is(cause, cognitionpkg.ErrScopePaginationInvalid) {
		return grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PAGE_TOKEN_INVALID,
			cause,
			grpcerr.ReasonOptions{Message: "cognition pagination state is invalid"},
		)
	}
	return grpcerr.WrapWithReasonCode(fallbackCode, fallbackReason, cause, options)
}

func cognitionStorageError(cause error, message string) error {
	return cognitionBridgeError(
		cause,
		codes.Internal,
		runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
		grpcerr.ReasonOptions{
			ActionHint: "retry_after_cognition_storage_recovery",
			Message:    message,
		},
	)
}
