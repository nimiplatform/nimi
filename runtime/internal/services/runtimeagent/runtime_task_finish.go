package runtimeagent

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// runtimeTaskFinishError admits only a normal model stop for a Runtime-private
// task whose structured result is saved or applied as a whole (conversation
// summary, chat-track sidecar, life turn). Output that stopped at its length
// limit can still close every APML element, so parsing alone cannot show that
// the model completed the result. Ordinary public text keeps reporting LENGTH
// to its caller; this check is only for these whole-result tasks.
func runtimeTaskFinishError(task string, finish runtimev1.FinishReason) error {
	switch finish {
	case runtimev1.FinishReason_FINISH_REASON_STOP:
		return nil
	case runtimev1.FinishReason_FINISH_REASON_LENGTH:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE,
			fmt.Errorf("%s stopped at its output limit before completing", task), grpcerr.ReasonOptions{})
	case runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED,
			fmt.Errorf("%s output was stopped by a content filter", task), grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			fmt.Errorf("%s ended with finish reason %s", task, finish), grpcerr.ReasonOptions{})
	}
}
