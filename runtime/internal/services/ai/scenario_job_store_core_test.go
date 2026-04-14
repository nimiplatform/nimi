package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
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
	ctx := scenarioJobContext("app")

	jobID := "scenario-cancelable-job"
	snapshot := svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
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

func TestScenarioJobStoreCancelPreservesCanceledStateForDetachedVideoJob(t *testing.T) {
	var deleteCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/contents/generations/tasks":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-1"})
		case r.Method == http.MethodGet && r.URL.Path == "/contents/generations/tasks/task-1":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-1", "status": "queued"})
		case r.Method == http.MethodDelete && r.URL.Path == "/contents/generations/tasks/task-1":
			atomic.AddInt32(&deleteCount, 1)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})
	ctx := scenarioJobContext("nimi.desktop")

	submitResp, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "volcengine/doubao-seedance-2-0-260128",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VideoGenerate{
				VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
					Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
					Content: []*runtimev1.VideoContentItem{
						{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A short product shot."},
					},
					Options: &runtimev1.VideoGenerationOptions{DurationSec: 4, Ratio: "16:9"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit detached video scenario job: %v", err)
	}
	jobID := submitResp.GetJob().GetJobId()
	if strings.TrimSpace(jobID) == "" {
		t.Fatal("expected job id")
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		job, ok := svc.scenarioJobs.get(jobID)
		if ok && strings.TrimSpace(job.GetProviderJobId()) != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("expected provider job id to be recorded before cancel")
		}
		time.Sleep(20 * time.Millisecond)
	}

	cancelResp, err := svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: jobID, Reason: "user-stop"})
	if err != nil {
		t.Fatalf("cancel detached video scenario job: %v", err)
	}
	if cancelResp.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("expected canceled status, got=%v", cancelResp.GetJob().GetStatus())
	}
	if cancelResp.GetJob().GetReasonDetail() != "user-stop" {
		t.Fatalf("expected cancel reason detail to be preserved, got=%q", cancelResp.GetJob().GetReasonDetail())
	}

	deadline = time.Now().Add(2 * time.Second)
	for {
		job, ok := svc.scenarioJobs.get(jobID)
		if ok && atomic.LoadInt32(&deleteCount) == 1 && job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			if job.GetReasonDetail() != "user-stop" {
				t.Fatalf("expected canceled job detail to remain user-stop, got=%q", job.GetReasonDetail())
			}
			return
		}
		if time.Now().After(deadline) {
			job, _ := svc.scenarioJobs.get(jobID)
			t.Fatalf("expected canceled terminal state with provider delete, delete_count=%d job=%#v", atomic.LoadInt32(&deleteCount), job)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestScenarioJobStoreDetachedVideoJobPublishesPollingMetadataAndRemainsQueryable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/contents/generations/tasks":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-1"})
		case r.Method == http.MethodGet && r.URL.Path == "/contents/generations/tasks/task-1":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-1", "status": "queued"})
		case r.Method == http.MethodDelete && r.URL.Path == "/contents/generations/tasks/task-1":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})
	ctx := scenarioJobContext("nimi.desktop")

	submitResp, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "volcengine/doubao-seedance-2-0-260128",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VideoGenerate{
				VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
					Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
					Content: []*runtimev1.VideoContentItem{
						{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A short product shot."},
					},
					Options: &runtimev1.VideoGenerationOptions{DurationSec: 4, Ratio: "16:9"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit detached video scenario job: %v", err)
	}
	jobID := submitResp.GetJob().GetJobId()

	var accepted *runtimev1.ScenarioJob
	deadline := time.Now().Add(2 * time.Second)
	for {
		getResp, getErr := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if getErr != nil {
			t.Fatalf("GetScenarioJob before cancel: %v", getErr)
		}
		job := getResp.GetJob()
		if job != nil && strings.TrimSpace(job.GetProviderJobId()) != "" && job.GetNextPollAt() != nil {
			accepted = job
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected polling metadata before cancel, last_job=%#v", job)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if accepted.GetRetryCount() < 0 {
		t.Fatalf("unexpected retry count: %d", accepted.GetRetryCount())
	}

	_, err = svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: jobID, Reason: "user-stop"})
	if err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}

	deadline = time.Now().Add(2 * time.Second)
	for {
		getResp, getErr := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if getErr != nil {
			t.Fatalf("GetScenarioJob after cancel: %v", getErr)
		}
		job := getResp.GetJob()
		if job != nil && job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			if job.GetReasonDetail() != "user-stop" {
				t.Fatalf("expected cancel reason detail to be preserved, got=%q", job.GetReasonDetail())
			}
			if got := strings.TrimSpace(job.GetProviderJobId()); got != strings.TrimSpace(accepted.GetProviderJobId()) {
				t.Fatalf("expected provider job id to remain stable, got=%q want=%q", got, accepted.GetProviderJobId())
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected canceled job to remain queryable, last_job=%#v", job)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestScenarioJobStoreDetachedVideoJobStillTimesOut(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/contents/generations/tasks":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-timeout-1"})
		case r.Method == http.MethodGet && r.URL.Path == "/contents/generations/tasks/task-timeout-1":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-timeout-1", "status": "queued"})
		case r.Method == http.MethodDelete && r.URL.Path == "/contents/generations/tasks/task-timeout-1":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})
	ctx := scenarioJobContext("nimi.desktop")

	submitResp, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "volcengine/doubao-seedance-2-0-260128",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     100,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VideoGenerate{
				VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
					Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
					Content: []*runtimev1.VideoContentItem{
						{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A short product shot."},
					},
					Options: &runtimev1.VideoGenerationOptions{DurationSec: 4, Ratio: "16:9"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit detached video scenario job: %v", err)
	}
	jobID := submitResp.GetJob().GetJobId()
	if strings.TrimSpace(jobID) == "" {
		t.Fatal("expected job id")
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		job, ok := svc.scenarioJobs.get(jobID)
		if ok && job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT {
			if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
				t.Fatalf("expected timeout reason code, got=%s", job.GetReasonCode().String())
			}
			return
		}
		if time.Now().After(deadline) {
			job, _ := svc.scenarioJobs.get(jobID)
			t.Fatalf("expected detached video scenario job to time out, last_job=%#v", job)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestScenarioJobStoreVoiceFallbackPaths(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: "http://example.com", APIKey: "test-key"},
		},
	})
	ctx := scenarioJobContext("nimi.desktop")

	submitResp, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "dashscope/qwen3-tts-vd",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
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

func TestScenarioJobStoreVoiceCancelAndMissingArtifactsPaths(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := scenarioJobContext("nimi.desktop")

	_, err := svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("expected envelope invalid for empty cancel job id, got=%v", reason)
	}

	_, err = svc.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: "missing-job"})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
		t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND for missing artifacts job, got=%v", reason)
	}

	voiceJob, _ := svc.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen3-tts",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceDesign{
				VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
					TargetModelId: "local/qwen3-tts",
					Input: &runtimev1.VoiceT2VInput{
						InstructionText: "steady narration voice",
					},
				},
			},
		},
		TraceID:       "voice-trace-cancel",
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved: "local/qwen3-tts",
		Provider:      "local",
	})
	if voiceJob == nil {
		t.Fatalf("submit voice design scenario job")
	}

	jobID := voiceJob.GetJobId()
	cancelResp, err := svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{
		JobId:  jobID,
		Reason: "user-cancelled-voice",
	})
	if err != nil {
		t.Fatalf("cancel voice scenario job: %v", err)
	}
	if cancelResp.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("expected canceled voice job, got=%v", cancelResp.GetJob().GetStatus())
	}
	if cancelResp.GetJob().GetReasonDetail() != "user-cancelled-voice" {
		t.Fatalf("expected cancel reason detail to be preserved, got=%q", cancelResp.GetJob().GetReasonDetail())
	}

	artResp, err := svc.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("get voice scenario artifacts after cancel: %v", err)
	}
	if artResp.GetTraceId() == "" {
		t.Fatalf("voice artifact response should keep trace id after cancel")
	}
	if artResp.GetArtifacts() == nil || len(artResp.GetArtifacts()) != 0 {
		t.Fatalf("voice artifacts should remain an empty slice, got=%#v", artResp.GetArtifacts())
	}

	completedJob, _ := svc.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen3-tts",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceDesign{
				VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
					TargetModelId: "local/qwen3-tts",
					Input: &runtimev1.VoiceT2VInput{
						InstructionText: "already completed voice",
					},
				},
			},
		},
		TraceID:       "voice-trace-complete",
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved: "local/qwen3-tts",
		Provider:      "local",
	})
	if completedJob == nil {
		t.Fatalf("submit second voice design scenario job")
	}
	completedJobID := completedJob.GetJobId()
	if ok := svc.voiceAssets.completeJob(completedJobID, "provider-job", "voice-ref", nil, nil); !ok {
		t.Fatalf("expected voice completion path to succeed")
	}

	_, err = svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{
		JobId:  completedJobID,
		Reason: "late-cancel",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for completed voice cancel, got %v", err)
	}
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE {
		t.Fatalf("expected AI_MEDIA_JOB_NOT_CANCELLABLE for completed voice cancel, got=%v", reason)
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
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
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
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
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
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
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
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
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
		&scenarioJobFailingCollector{ctx: scenarioJobContext("app"), sendErr: sendErr},
	)
	if !errors.Is(err, sendErr) {
		t.Fatalf("expected send error branch, got %v", err)
	}

	ctx, cancel := context.WithCancel(scenarioJobContext("app"))
	cancel()
	runningJobID := "scenario-subscribe-cancel-context"
	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        runningJobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
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

func TestScenarioJobStoreRejectsUnauthorizedSubscriptionAndVoiceCancel(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	jobID := "scenario-auth-job"
	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app-a", SubjectUserId: "user-a", ModelId: "local/qwen", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-auth-job",
	}, func() {})

	unauthorizedStream := &scenarioJobEventCollector{
		ctx: authn.WithIdentity(metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app-b")), &authn.Identity{SubjectUserID: "user-b"}),
	}
	err := svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{JobId: jobID}, unauthorizedStream)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected permission denied for scenario subscribe, got %v", err)
	}

	now := time.Now().UTC()
	voiceJobID := "voice-auth-job"
	svc.voiceAssets.mu.Lock()
	svc.voiceAssets.jobs[voiceJobID] = &voiceScenarioJobRecord{
		job: &runtimev1.ScenarioJob{
			JobId:      voiceJobID,
			Head:       &runtimev1.ScenarioRequestHead{AppId: "app-a", SubjectUserId: "user-a", ModelId: "local/qwen3-tts", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
			Status:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			TraceId:    "trace-voice-auth",
			CreatedAt:  timestamppb.New(now),
			UpdatedAt:  timestamppb.New(now),
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		subscribers: make(map[uint64]chan *runtimev1.ScenarioJobEvent),
	}
	svc.voiceAssets.mu.Unlock()

	_, err = svc.CancelScenarioJob(
		authn.WithIdentity(metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app-b")), &authn.Identity{SubjectUserID: "user-b"}),
		&runtimev1.CancelScenarioJobRequest{JobId: voiceJobID, Reason: "nope"},
	)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected permission denied for voice cancel, got %v", err)
	}
	job, ok := svc.voiceAssets.getJob(voiceJobID)
	if !ok {
		t.Fatalf("voice job should still exist")
	}
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED {
		t.Fatalf("unauthorized cancel must not mutate job, got %v", job.GetStatus())
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
			Head:       &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen3-tts", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
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

	collector := &scenarioJobEventCollector{ctx: scenarioJobContext("app")}
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
			Head:       &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen3-tts", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
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

	collector := &scenarioJobEventCollector{ctx: scenarioJobContext("app")}
	if err := svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{JobId: jobID}, collector); err != nil {
		t.Fatalf("subscribe voice terminal backlog branch returned error: %v", err)
	}
	if len(collector.events) != 1 || collector.events[0].GetEventType() != runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED {
		t.Fatalf("expected completed backlog event, got %#v", collector.events)
	}
}
