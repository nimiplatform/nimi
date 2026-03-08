package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/metadata"
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

func TestScenarioJobStoreCancelAndArtifactsPaths(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	jobID := "scenario-cancelable-job"
	snapshot := svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME},
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

func TestScenarioJobStoreVoiceFallbackPaths(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: "http://example.com", APIKey: "test-key"},
		},
	})
	ctx := context.Background()

	submitResp, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "dashscope/qwen3-tts-vd",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceDesign{
				VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
					TargetModelId: "dashscope/qwen3-tts-vd",
					Input: &runtimev1.VoiceT2VInput{
						InstructionText: "calm female voice",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit voice design scenario job: %v", err)
	}
	if submitResp.GetAsset() == nil {
		t.Fatalf("voice scenario should return asset")
	}
	jobID := submitResp.GetJob().GetJobId()

	getResp, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("get scenario job for voice path: %v", err)
	}
	if getResp.GetJob().GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN {
		t.Fatalf("unexpected voice job scenario type: %v", getResp.GetJob().GetScenarioType())
	}

	artResp, err := svc.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("get voice scenario artifacts: %v", err)
	}
	if artResp.GetTraceId() == "" {
		t.Fatalf("voice artifact response should carry trace id")
	}
	if artResp.Artifacts == nil {
		t.Fatalf("voice artifact response should return an empty slice, got nil")
	}

	collector := &scenarioJobEventCollector{ctx: ctx}
	if err := svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{JobId: jobID}, collector); err != nil {
		t.Fatalf("subscribe voice scenario events: %v", err)
	}
	if len(collector.events) == 0 {
		t.Fatalf("expected voice scenario events backlog")
	}
}

func TestScenarioJobStoreSubmitModeAndUnsupportedType(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	_, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
			ModelId:       "local/qwen",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "x"}},
		},
	})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("expected route unsupported for non-async media submit, got=%v", reason)
	}

	_, err = svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
			ModelId:       "local/qwen",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{}},
		},
	})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("expected route unsupported for submit unsupported scenario, got=%v", reason)
	}
}

func TestScenarioJobStoreSubmitUnsupportedExtension(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
			ModelId:       "local/qwen",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "x"}},
		},
		Extensions: []*runtimev1.ScenarioExtension{
			{Namespace: "nimi.scenario.unknown"},
		},
	})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected media option unsupported for unknown extension, got=%v", reason)
	}
}

func TestScenarioJobStoreSubscribeBranches(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	terminalJobID := "scenario-subscribe-terminal"
	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        terminalJobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-terminal",
	}, func() {})
	_, _ = svc.scenarioJobs.transition(
		terminalJobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		nil,
	)

	sendErr := errors.New("stream-send-failed")
	err := svc.SubscribeScenarioJobEvents(
		&runtimev1.SubscribeScenarioJobEventsRequest{JobId: terminalJobID},
		&scenarioJobFailingCollector{ctx: context.Background(), sendErr: sendErr},
	)
	if !errors.Is(err, sendErr) {
		t.Fatalf("expected send error branch, got %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runningJobID := "scenario-subscribe-cancel-context"
	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        runningJobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-running",
	}, func() {})
	if err := svc.SubscribeScenarioJobEvents(
		&runtimev1.SubscribeScenarioJobEventsRequest{JobId: runningJobID},
		&scenarioJobFailingCollector{ctx: ctx},
	); err != nil {
		t.Fatalf("context-done branch should return nil, got %v", err)
	}
}

type scenarioJobFailingCollector struct {
	ctx     context.Context
	sendErr error
	events  []*runtimev1.ScenarioJobEvent
}

func (s *scenarioJobFailingCollector) Send(event *runtimev1.ScenarioJobEvent) error {
	if s.sendErr != nil {
		return s.sendErr
	}
	s.events = append(s.events, event)
	return nil
}

func (s *scenarioJobFailingCollector) SetHeader(_ metadata.MD) error  { return nil }
func (s *scenarioJobFailingCollector) SendHeader(_ metadata.MD) error { return nil }
func (s *scenarioJobFailingCollector) SetTrailer(_ metadata.MD)       {}
func (s *scenarioJobFailingCollector) Context() context.Context       { return s.ctx }
func (s *scenarioJobFailingCollector) SendMsg(any) error              { return nil }
func (s *scenarioJobFailingCollector) RecvMsg(any) error              { return nil }

func TestScenarioJobStoreSubscribeVoiceStreamingBranch(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	jobID := "voice-subscribe-streaming"
	now := time.Now().UTC()

	svc.voiceAssets.mu.Lock()
	svc.voiceAssets.jobs[jobID] = &voiceScenarioJobRecord{
		job: &runtimev1.ScenarioJob{
			JobId:      jobID,
			Head:       &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen3-tts", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME},
			Status:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			TraceId:    "trace-voice-stream",
			CreatedAt:  timestamppb.New(now),
			UpdatedAt:  timestamppb.New(now),
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		events:      []*runtimev1.ScenarioJobEvent{},
		subscribers: make(map[uint64]chan *runtimev1.ScenarioJobEvent),
	}
	svc.voiceAssets.mu.Unlock()

	collector := &scenarioJobEventCollector{ctx: context.Background()}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{JobId: jobID}, collector)
	}()

	time.Sleep(20 * time.Millisecond)
	if _, ok := svc.voiceAssets.cancelJob(jobID, "stop"); !ok {
		t.Fatalf("voice cancel should publish terminal event")
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("subscribe voice streaming branch returned error: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("subscribe voice streaming branch did not return")
	}

	if len(collector.events) == 0 {
		t.Fatalf("expected at least one event from voice stream branch")
	}
}

func TestScenarioJobStoreSubscribeVoiceTerminalBacklogBranch(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	jobID := "voice-subscribe-terminal"
	now := time.Now().UTC()

	svc.voiceAssets.mu.Lock()
	svc.voiceAssets.jobs[jobID] = &voiceScenarioJobRecord{
		job: &runtimev1.ScenarioJob{
			JobId:      jobID,
			Head:       &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen3-tts", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME},
			Status:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			TraceId:    "trace-voice-terminal",
			CreatedAt:  timestamppb.New(now),
			UpdatedAt:  timestamppb.New(now),
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		events: []*runtimev1.ScenarioJobEvent{
			{
				EventType: runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
				Timestamp: timestamppb.New(now),
				Job: &runtimev1.ScenarioJob{
					JobId:  jobID,
					Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
				},
			},
		},
		subscribers: make(map[uint64]chan *runtimev1.ScenarioJobEvent),
	}
	svc.voiceAssets.mu.Unlock()

	collector := &scenarioJobEventCollector{ctx: context.Background()}
	if err := svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{JobId: jobID}, collector); err != nil {
		t.Fatalf("subscribe voice terminal backlog branch returned error: %v", err)
	}
	if len(collector.events) != 1 || collector.events[0].GetEventType() != runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED {
		t.Fatalf("expected completed backlog event, got %#v", collector.events)
	}
}
