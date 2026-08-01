package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func managedImageLoadErrorWithReason(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := grpcerr.ExtractReasonCode(err); ok {
		return err
	}
	detail := strings.TrimSpace(err.Error())
	reason := projectionReasonCodeForEngine("media", managedLocalImageExecutionFailureDetail(detail))
	switch reason {
	case runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE,
		runtimev1.ReasonCode_AI_LOCAL_COMPONENT_COMPATIBILITY_UNKNOWN:
		return grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			reason,
			err,
			grpcerr.ReasonOptions{
				Message:    managedImageFailurePublicDetail(reason),
				ActionHint: "inspect_local_runtime_model_health",
			},
		)
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		return grpcerr.WrapWithReasonCode(
			codes.DeadlineExceeded,
			reason,
			err,
			grpcerr.ReasonOptions{
				Message:    managedImageFailurePublicDetail(reason),
				ActionHint: "inspect_local_runtime_model_health",
			},
		)
	default:
		return grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{
				Message:    managedImageFailurePublicDetail(runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE),
				ActionHint: "inspect_local_runtime_model_health",
			},
		)
	}
}

func managedImageFailurePublicDetail(reason runtimev1.ReasonCode) string {
	switch reason {
	case runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE:
		return "managed image model is incompatible with the local runtime"
	case runtimev1.ReasonCode_AI_LOCAL_COMPONENT_COMPATIBILITY_UNKNOWN:
		return "managed image model compatibility could not be verified"
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		return "managed image backend load timed out while waiting for resident readiness"
	default:
		return "managed local image backend validation failed"
	}
}
