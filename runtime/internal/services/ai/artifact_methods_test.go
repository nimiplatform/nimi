package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestMediaJobStatusToError(t *testing.T) {
	tests := []struct {
		name       string
		job        *runtimev1.ScenarioJob
		expectCode codes.Code
		expectRC   runtimev1.ReasonCode
	}{
		{
			name:       "nil job",
			job:        nil,
			expectCode: codes.Internal,
			expectRC:   runtimev1.ReasonCode_AI_OUTPUT_INVALID,
		},
		{
			name:       "input invalid",
			job:        &runtimev1.ScenarioJob{ReasonCode: runtimev1.ReasonCode_AI_INPUT_INVALID},
			expectCode: codes.InvalidArgument,
			expectRC:   runtimev1.ReasonCode_AI_INPUT_INVALID,
		},
		{
			name:       "model not found",
			job:        &runtimev1.ScenarioJob{ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_FOUND},
			expectCode: codes.NotFound,
			expectRC:   runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
		},
		{
			name:       "provider timeout",
			job:        &runtimev1.ScenarioJob{ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT},
			expectCode: codes.DeadlineExceeded,
			expectRC:   runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
		},
		{
			name:       "route unsupported",
			job:        &runtimev1.ScenarioJob{ReasonCode: runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED},
			expectCode: codes.FailedPrecondition,
			expectRC:   runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
		},
		{
			name:       "content blocked",
			job:        &runtimev1.ScenarioJob{ReasonCode: runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED},
			expectCode: codes.PermissionDenied,
			expectRC:   runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED,
		},
		{
			name:       "unspecified fallback",
			job:        &runtimev1.ScenarioJob{ReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED},
			expectCode: codes.Unavailable,
			expectRC:   runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := mediaJobStatusToError(tt.job)
			if status.Code(err) != tt.expectCode {
				t.Fatalf("code mismatch: got=%v want=%v", status.Code(err), tt.expectCode)
			}
			rc, ok := grpcerr.ExtractReasonCode(err)
			if !ok || rc != tt.expectRC {
				t.Fatalf("reason code mismatch: got=%v ok=%v want=%v", rc, ok, tt.expectRC)
			}
		})
	}
}
