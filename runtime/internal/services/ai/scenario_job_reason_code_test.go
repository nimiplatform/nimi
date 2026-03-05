package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestScenarioJobReasonCodeClassification(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	t.Run("GetScenarioJob_NotFound_ReasonCode", func(t *testing.T) {
		_, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: "nonexistent"})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("CancelScenarioJob_NotFound_ReasonCode", func(t *testing.T) {
		_, err := svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: "nonexistent"})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubscribeScenarioJobEvents_NotFound_ReasonCode", func(t *testing.T) {
		stream := &scenarioJobEventCollector{ctx: ctx}
		err := svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{JobId: "nonexistent"}, stream)
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("CancelScenarioJob_NotCancellable_ReasonCode", func(t *testing.T) {
		jobID := "scenario-job-completed-for-cancel"
		created := svc.scenarioJobs.create(&runtimev1.ScenarioJob{
			JobId: jobID,
			Head: &runtimev1.ScenarioRequestHead{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/sd3",
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			},
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
			RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			ModelResolved: "local/sd3",
			TraceId:       "trace-completed",
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		}, func() {})
		if created == nil {
			t.Fatal("create scenario job record")
		}
		_, _ = svc.scenarioJobs.transition(
			jobID,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
			nil,
		)

		_, err := svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: jobID})
		if err == nil {
			t.Fatal("expected error canceling completed scenario job")
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_CANCELLABLE, got %v (ok=%v)", reason, ok)
		}
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FailedPrecondition, got %v", status.Code(err))
		}
	})

	t.Run("SubmitScenarioJob_OptionUnsupported_ImageN", func(t *testing.T) {
		_, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
			Head: &runtimev1.ScenarioRequestHead{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/sd3",
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			},
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_ImageGenerate{
					ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
						Prompt: "test",
						N:      17,
					},
				},
			},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
		}
	})
}
