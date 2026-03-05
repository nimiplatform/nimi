package ai

import (
	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func mediaJobStatusToError(job *runtimev1.ScenarioJob) error {
	if job == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	reasonCode := job.GetReasonCode()
	if reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		reasonCode = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	switch reasonCode {
	case runtimev1.ReasonCode_AI_INPUT_INVALID:
		return grpcerr.WithReasonCode(codes.InvalidArgument, reasonCode)
	case runtimev1.ReasonCode_AI_MODEL_NOT_FOUND:
		return grpcerr.WithReasonCode(codes.NotFound, reasonCode)
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		return grpcerr.WithReasonCode(codes.DeadlineExceeded, reasonCode)
	case runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED, runtimev1.ReasonCode_AI_MODEL_NOT_READY:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, reasonCode)
	case runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED:
		return grpcerr.WithReasonCode(codes.PermissionDenied, reasonCode)
	default:
		return grpcerr.WithReasonCode(codes.Unavailable, reasonCode)
	}
}
