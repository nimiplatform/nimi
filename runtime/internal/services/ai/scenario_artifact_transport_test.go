package ai

import (
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSanitizeScenarioArtifactsForResponseStripsVideoBytesWhenURIAvailable(t *testing.T) {
	job := &runtimev1.ScenarioJob{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE}
	artifacts := []*runtimev1.ScenarioArtifact{{
		ArtifactId: "video-art-1",
		MimeType:   "video/mp4",
		Bytes:      []byte("inline-video-preview"),
		Uri:        "https://cdn.example/video.mp4",
	}}

	sanitized := sanitizeScenarioArtifactsForResponse(job, artifacts)
	if len(sanitized) != 1 {
		t.Fatalf("expected one artifact, got=%d", len(sanitized))
	}
	if got := len(sanitized[0].GetBytes()); got != 0 {
		t.Fatalf("expected inline bytes to be stripped, got len=%d", got)
	}
	if got := sanitized[0].GetUri(); got != "https://cdn.example/video.mp4" {
		t.Fatalf("expected URI preserved, got=%q", got)
	}
	if got := string(artifacts[0].GetBytes()); got != "inline-video-preview" {
		t.Fatalf("expected original artifact bytes to remain intact, got=%q", got)
	}
}

func TestGetScenarioJobAndArtifactsCompactVideoResponsePayloads(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := scenarioJobUserContext("nimi.desktop", "user")

	jobID := "scenario-video-compact-job"
	originalBytes := make([]byte, maxInlineBinaryArtifactResponseBytes+256)
	for i := range originalBytes {
		originalBytes[i] = byte(i % 251)
	}
	snapshot := svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user", ModelId: "cloud/seedance", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		TraceId:      "trace-video-compact",
		Artifacts: []*runtimev1.ScenarioArtifact{{
			ArtifactId: "video-artifact-compact",
			MimeType:   "video/mp4",
			Bytes:      originalBytes,
			Uri:        "https://cdn.example/generated/video.mp4",
			SizeBytes:  int64(len(originalBytes)),
		}},
	}, func() {})
	if snapshot == nil {
		t.Fatalf("expected snapshot creation")
	}

	jobResp, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("GetScenarioJob: %v", err)
	}
	if len(jobResp.GetJob().GetArtifacts()) != 1 {
		t.Fatalf("expected one job artifact, got=%d", len(jobResp.GetJob().GetArtifacts()))
	}
	if got := len(jobResp.GetJob().GetArtifacts()[0].GetBytes()); got != 0 {
		t.Fatalf("expected compact job response artifact bytes to be stripped, got=%d", got)
	}
	if got := jobResp.GetJob().GetArtifacts()[0].GetUri(); got == "" {
		t.Fatal("expected compact job response to preserve artifact URI")
	}

	artifactsResp, err := svc.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("GetScenarioArtifacts: %v", err)
	}
	if len(artifactsResp.GetArtifacts()) != 1 {
		t.Fatalf("expected one artifacts response item, got=%d", len(artifactsResp.GetArtifacts()))
	}
	if got := len(artifactsResp.GetArtifacts()[0].GetBytes()); got != 0 {
		t.Fatalf("expected compact artifact response bytes to be stripped, got=%d", got)
	}
	videoOutput := artifactsResp.GetOutput().GetVideoGenerate()
	if videoOutput == nil || len(videoOutput.GetArtifacts()) != 1 {
		t.Fatalf("expected video output artifacts, got=%v", artifactsResp.GetOutput())
	}
	if got := len(videoOutput.GetArtifacts()[0].GetBytes()); got != 0 {
		t.Fatalf("expected compact output artifact bytes to be stripped, got=%d", got)
	}

	storedJob, ok := svc.scenarioJobs.get(jobID)
	if !ok {
		t.Fatalf("expected stored job lookup to succeed")
	}
	if got := len(storedJob.GetArtifacts()[0].GetBytes()); got != len(originalBytes) {
		t.Fatalf("expected stored artifact bytes to remain intact, got=%d want=%d", got, len(originalBytes))
	}
}

func TestGetScenarioJobAndArtifactsCompactLargeImageResponsePayloads(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := scenarioJobUserContext("nimi.desktop", "user")

	jobID := "scenario-image-compact-job"
	originalBytes := make([]byte, maxInlineBinaryArtifactResponseBytes+256)
	for i := range originalBytes {
		originalBytes[i] = byte(i % 251)
	}
	snapshot := svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user", ModelId: "cloud/gemini-image", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		TraceId:      "trace-image-compact",
		Artifacts: []*runtimev1.ScenarioArtifact{{
			ArtifactId: "image-artifact-compact",
			MimeType:   "image/png",
			Bytes:      originalBytes,
			SizeBytes:  int64(len(originalBytes)),
		}},
	}, func() {})
	if snapshot == nil {
		t.Fatalf("expected snapshot creation")
	}

	jobResp, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("GetScenarioJob: %v", err)
	}
	if got := len(jobResp.GetJob().GetArtifacts()[0].GetBytes()); got != 0 {
		t.Fatalf("expected compact image job response bytes to be stripped, got=%d", got)
	}
	if got := jobResp.GetJob().GetArtifacts()[0].GetArtifactId(); got != "image-artifact-compact" {
		t.Fatalf("expected compact image job response to preserve artifact_id, got=%q", got)
	}

	artifactsResp, err := svc.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("GetScenarioArtifacts: %v", err)
	}
	if got := len(artifactsResp.GetArtifacts()[0].GetBytes()); got != 0 {
		t.Fatalf("expected compact image artifact response bytes to be stripped, got=%d", got)
	}
	imageOutput := artifactsResp.GetOutput().GetImageGenerate()
	if imageOutput == nil || len(imageOutput.GetArtifacts()) != 1 {
		t.Fatalf("expected image output artifacts, got=%v", artifactsResp.GetOutput())
	}
	if got := len(imageOutput.GetArtifacts()[0].GetBytes()); got != 0 {
		t.Fatalf("expected compact image output artifact bytes to be stripped, got=%d", got)
	}

	storedJob, ok := svc.scenarioJobs.get(jobID)
	if !ok {
		t.Fatalf("expected stored job lookup to succeed")
	}
	if got := len(storedJob.GetArtifacts()[0].GetBytes()); got != len(originalBytes) {
		t.Fatalf("expected stored image artifact bytes to remain intact, got=%d want=%d", got, len(originalBytes))
	}
}

func TestGetScenarioArtifactsFailsClosedForProviderAuthFailedJob(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := scenarioJobUserContext("nimi.desktop", "user")

	jobID := "scenario-provider-auth-failed-job"
	snapshot := svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user", ModelId: "cloud/provider", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		ReasonCode:   runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		TraceId:      "trace-provider-auth-failed",
		Artifacts: []*runtimev1.ScenarioArtifact{{
			ArtifactId: "stale-auth-failed-artifact",
			MimeType:   "image/png",
			Bytes:      []byte("must-not-project"),
		}},
	}, func() {})
	if snapshot == nil {
		t.Fatalf("expected snapshot creation")
	}

	resp, err := svc.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err == nil {
		t.Fatalf("expected failed precondition, got response=%v", resp)
	}
	if got := status.Code(err); got != codes.FailedPrecondition {
		t.Fatalf("expected FAILED_PRECONDITION, got %v", got)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("expected AI_PROVIDER_AUTH_FAILED reason, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}
