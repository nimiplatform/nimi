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
			},
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
			ModelResolved: "local/sd3",
			TraceId:       "trace-completed",
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		}, func() {})
		if created == nil {
			t.Fatal("create scenario job record")
		}
		_, _, _ = svc.transitionScenarioJob(
			jobID,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
			nil,
		)

		_, err := svc.CancelScenarioJob(scenarioJobUserContext("nimi.desktop", "user-001"), &runtimev1.CancelScenarioJobRequest{JobId: jobID})
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
		localCtx := withLocalScenarioTestIntent(ctx, "image.generate")
		_, err := svc.SubmitScenarioJob(localCtx, &runtimev1.SubmitScenarioJobRequest{
			Head: &runtimev1.ScenarioRequestHead{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
			},
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_ImageGenerate{
					ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
						Prompt: "test",
						N:      testInt32(17),
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

func TestStreamCancellationTerminalReasonMatchesCanceledStatus(t *testing.T) {
	tests := []struct {
		name        string
		wrongReason runtimev1.ReasonCode
		wantReason  runtimev1.ReasonCode
		finish      func(*Service, context.Context, string, error)
	}{
		{
			name:        "local speech",
			wrongReason: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED,
			wantReason:  runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED,
			finish: func(svc *Service, ctx context.Context, jobID string, err error) {
				svc.finishLocalSpeechJobFailure(ctx, jobID, err)
			},
		},
		{
			name:        "cloud",
			wrongReason: runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			wantReason:  runtimev1.ReasonCode_ACTION_EXECUTED,
			finish: func(svc *Service, ctx context.Context, jobID string, err error) {
				svc.finishCloudScenarioJobFailure(ctx, jobID, err)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
			jobID := "stream-canceled-" + test.name
			created := svc.scenarioJobs.create(&runtimev1.ScenarioJob{
				JobId: jobID,
				Head: &runtimev1.ScenarioRequestHead{
					AppId:         "nimi.desktop",
					SubjectUserId: "user-001",
				},
				ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
				ModelResolved: "stream-model",
				TraceId:       "trace-" + test.name,
				Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
				ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
			}, func() {})
			if created == nil {
				t.Fatal("create stream ScenarioJob")
			}
			cancelErr := grpcerr.WithReasonCodeOptions(codes.Canceled, test.wrongReason, grpcerr.ReasonOptions{
				Metadata: map[string]string{"provider_message": "must-not-survive-cancellation"},
			})
			test.finish(svc, context.Background(), jobID, cancelErr)
			terminal, ok := svc.scenarioJobs.get(jobID)
			if !ok {
				t.Fatal("get canceled stream ScenarioJob")
			}
			if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || terminal.GetReasonCode() != test.wantReason {
				t.Fatalf("canceled stream terminal = status=%s reason=%s", terminal.GetStatus(), terminal.GetReasonCode())
			}
			if terminal.GetReasonMetadata() != nil {
				t.Fatalf("canceled stream metadata = %v, want nil", terminal.GetReasonMetadata())
			}
		})
	}
}

func TestCloudStreamDeliveryFailureOutranksAmbientContextCancellation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	jobID := "cloud-stream-delivery-failure"
	created := svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId: jobID,
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		ModelResolved: "cloud-stream-model",
		TraceId:       "trace-cloud-stream-delivery",
		Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
	}, func() {})
	if created == nil {
		t.Fatal("create cloud stream ScenarioJob")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	svc.finishCloudScenarioJobFailure(
		ctx,
		jobID,
		scenarioStreamDeliveryError(status.Error(codes.Unavailable, "client stream closed")),
	)
	terminal, ok := svc.scenarioJobs.get(jobID)
	if !ok {
		t.Fatal("get cloud stream ScenarioJob")
	}
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
		terminal.GetReasonCode() != runtimev1.ReasonCode_AI_STREAM_BROKEN {
		t.Fatalf("cloud stream terminal = status=%s reason=%s", terminal.GetStatus(), terminal.GetReasonCode())
	}
}
