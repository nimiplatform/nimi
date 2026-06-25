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
		return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, reason, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "inspect_local_runtime_model_health",
			Metadata: map[string]string{
				"provider_message": detail,
			},
		})
	default:
		return err
	}
}
