package cognition

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func cognitionStorageError(cause error, message string) error {
	return grpcerr.WrapWithReasonCode(
		codes.Internal,
		runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
		cause,
		grpcerr.ReasonOptions{
			ActionHint: "retry_after_cognition_storage_recovery",
			Message:    message,
		},
	)
}
