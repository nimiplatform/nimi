package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func routeDescribeEncodingError(err error) error {
	return grpcerr.WrapWithReasonCode(
		codes.Internal,
		runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
		err,
		grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_runtime_logs",
			Message:    "route description metadata could not be encoded",
		},
	)
}
