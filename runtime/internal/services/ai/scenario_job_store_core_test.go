package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestScenarioJobStoreCoreValidationAndLookup(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	_, err := svc.SubmitScenarioJob(ctx, nil)
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("expected envelope invalid for nil submit request, got=%v", reason)
	}

	_, err = svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("expected envelope invalid for empty job id, got=%v", reason)
	}

	_, err = svc.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("expected envelope invalid for empty artifact job id, got=%v", reason)
	}

	err = svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{}, &scenarioJobEventCollector{ctx: ctx})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("expected envelope invalid for empty subscription job id, got=%v", reason)
	}
}

func TestVoiceScenarioJobCancelPublishesOnlyAfterExecutionStops(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := scenarioJobUserContext("app", "user")
	executionCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	now := timestamppb.Now()
	job := &runtimev1.ScenarioJob{
		JobId: "voice-cancel-job", Head: &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now, TraceId: "voice-cancel-trace",
	}
	if created, err := svc.scenarioJobs.createOwnedChecked(job, cancel, nil); err != nil || created == nil {
		t.Fatalf("submit voice job: %#v, %v", created, err)
	}
	if !svc.scenarioJobs.startExecution(job.GetJobId()) {
		t.Fatal("start voice execution")
	}
	if _, ok, err := svc.scenarioJobs.transition(job.GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil || !ok {
		t.Fatalf("run voice job: ok=%v err=%v", ok, err)
	}
	response, err := svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: job.GetJobId(), Reason: "stop voice"})
	if err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}
	select {
	case <-executionCtx.Done():
	default:
		t.Fatal("voice cancellation was not forwarded")
	}
	if response.GetJob().GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("voice canceled before execution stop: %+v", response.GetJob())
	}
	if err := svc.scenarioJobs.finishExecution(job.GetJobId()); err != nil {
		t.Fatalf("finish voice execution: %v", err)
	}
	terminal, _ := svc.scenarioJobs.get(job.GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || terminal.GetReasonDetail() != "stop voice" {
		t.Fatalf("voice cancel terminal = %+v", terminal)
	}
}

func TestScenarioJobStateEnumerationMatchesSpec(t *testing.T) {
	// K-JOB-002: canonical 7-state machine enumeration.
	// All 7 states MUST exist and terminal classification MUST match spec.
	type stateSpec struct {
		status   runtimev1.ScenarioJobStatus
		terminal bool
	}
	expected := []stateSpec{
		{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, false},
		{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, false},
		{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, false},
		{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, true},
		{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, true},
		{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, true},
		{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT, true},
	}

	for _, spec := range expected {
		name := spec.status.String()
		if name == "" || name == "SCENARIO_JOB_STATUS_UNSPECIFIED" {
			t.Fatalf("state %d has no valid enum name", spec.status)
		}
		got := isTerminalScenarioJobStatus(spec.status)
		if got != spec.terminal {
			t.Errorf("isTerminalScenarioJobStatus(%s) = %v, want %v", name, got, spec.terminal)
		}
	}

	// Verify UNSPECIFIED is not terminal
	if isTerminalScenarioJobStatus(runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED) {
		t.Error("UNSPECIFIED should not be terminal")
	}
}

func TestScenarioJobStoreCancelAndArtifactsPaths(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := scenarioJobUserContext("app", "user")

	jobID := "scenario-cancelable-job"
	snapshot := svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-1",
		Artifacts:    []*runtimev1.ScenarioArtifact{{Uri: "file:///tmp/a.png", MimeType: "image/png"}},
	}, func() {})
	if snapshot == nil {
		t.Fatalf("expected snapshot creation")
	}

	cancelResp, err := svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: jobID, Reason: "user-cancel"})
	if err != nil {
		t.Fatalf("cancel scenario job: %v", err)
	}
	if cancelResp.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("expected canceled status, got=%v", cancelResp.GetJob().GetStatus())
	}

	artResp, err := svc.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("get scenario artifacts: %v", err)
	}
	if len(artResp.GetArtifacts()) != 1 || artResp.GetTraceId() != "trace-1" {
		t.Fatalf("unexpected artifacts response: %#v", artResp)
	}
}
