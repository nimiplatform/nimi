package ai

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestUpscaleLocalAppSubmissionPreservesOwnedSpecAndRejectsInvalidScale(t *testing.T) {
	source := &runtimev1.MediaUpscaleScenarioSpec{SourceArtifactId: "owned-source", Scale: 2, Seed: proto.Int64(0)}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageUpscale{ImageUpscale: source}}
	owner, scenario, err := validateLocalAppScenarioJobRequest(request)
	if err != nil || scenario != runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_UPSCALE || !proto.Equal(owner.GetImageUpscale(), source) {
		t.Fatal(owner, scenario, err)
	}
	source.SourceArtifactId = "changed"
	if owner.GetImageUpscale().SourceArtifactId != "owned-source" {
		t.Fatal("captured spec aliases the caller")
	}
	source.Scale = 3
	if _, _, err := validateLocalAppScenarioJobRequest(request); err == nil {
		t.Fatal("unsupported scale crossed the protected ingress")
	}
	source.Scale = 4
	request.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_VideoUpscale{VideoUpscale: source}
	_, scenario, err = validateLocalAppScenarioJobRequest(request)
	if err != nil || scenario != runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_UPSCALE {
		t.Fatal(scenario, err)
	}
}

func TestUpscaleLocalAppResponseAndEventProjectionPreserveJobIdentity(t *testing.T) {
	for _, scenario := range []runtimev1.ScenarioType{runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_UPSCALE, runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_UPSCALE} {
		for _, status := range []runtimev1.ScenarioJobStatus{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED} {
			job := &runtimev1.ScenarioJob{JobId: "owned-upscale-job", ScenarioType: scenario, Status: status, TraceId: "upscale-trace"}
			if status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				mime := "image/png"
				if scenario == runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_UPSCALE {
					mime = "video/mp4"
				}
				job.Artifacts = []*runtimev1.ScenarioArtifact{{ArtifactId: "owned-result", MimeType: mime, SizeBytes: 100, Sha256: strings.Repeat("a", 64), Width: 64, Height: 64}}
			}
			projected, err := projectLocalAppScenarioJob(job)
			if err != nil || projected.GetJobId() != job.JobId || projected.GetScenarioType() != scenario || projected.GetTraceId() != job.TraceId || len(projected.GetArtifacts()) != len(job.Artifacts) {
				t.Fatalf("super-resolution response projection lost accepted work: scenario=%v status=%v projected=%v error=%v", scenario, status, projected, err)
			}
			event, err := projectLocalAppScenarioJobEvent(&runtimev1.ScenarioJobEvent{Job: job, EventType: runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED})
			if err != nil || event.GetJob().GetJobId() != job.JobId {
				t.Fatalf("super-resolution event projection lost job identity: %v", err)
			}
		}
	}
}
