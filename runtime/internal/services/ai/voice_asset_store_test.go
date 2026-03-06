package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestVoiceAssetStoreCompleteAndTimeoutJob(t *testing.T) {
	store := newVoiceAssetStore()

	job, asset := store.submit(&voiceWorkflowSubmitInput{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
			ModelId:       "dashscope/qwen3-tts-vc",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
				TargetModelId: "dashscope/qwen3-tts-vc",
				Input: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				},
			}},
		},
		Provider:          "dashscope",
		OutputPersistence: "provider_persistent",
	})
	if job == nil || asset == nil {
		t.Fatalf("submit should create voice job and asset")
	}

	if !store.completeJob(job.GetJobId(), "provider-job-1", "voice-ref-1", map[string]any{"quality": "high"}, &runtimev1.UsageStats{InputTokens: 1}) {
		t.Fatalf("completeJob should succeed")
	}

	completedJob, ok := store.getJob(job.GetJobId())
	if !ok || completedJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("expected completed job, got ok=%v job=%#v", ok, completedJob)
	}
	if completedJob.GetProviderJobId() != "provider-job-1" {
		t.Fatalf("expected provider job id to be recorded, got %q", completedJob.GetProviderJobId())
	}
	if completedJob.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("expected ACTION_EXECUTED reason code, got %v", completedJob.GetReasonCode())
	}

	completedAsset, ok := store.getAsset(asset.GetVoiceAssetId())
	if !ok || completedAsset.GetProviderVoiceRef() != "voice-ref-1" {
		t.Fatalf("expected completed voice asset with provider ref, got ok=%v asset=%#v", ok, completedAsset)
	}
	if completedAsset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active asset after completion, got %v", completedAsset.GetStatus())
	}
	if completedAsset.GetMetadata() == nil || completedAsset.GetMetadata().Fields["quality"].GetStringValue() != "high" {
		t.Fatalf("expected metadata to be persisted, got %#v", completedAsset.GetMetadata())
	}

	timeoutJob, timeoutAsset := store.submit(&voiceWorkflowSubmitInput{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
			ModelId:       "playht/playht-voice-clone",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
				TargetModelId: "playht/playht-voice-clone",
				Input: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				},
			}},
		},
		Provider: "playht",
	})
	if timeoutJob == nil || timeoutAsset == nil {
		t.Fatalf("submit should create timeout job and asset")
	}

	if !store.timeoutJob(timeoutJob.GetJobId(), runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "timed out") {
		t.Fatalf("timeoutJob should succeed")
	}

	timedOutJob, ok := store.getJob(timeoutJob.GetJobId())
	if !ok || timedOutJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT {
		t.Fatalf("expected timeout job status, got ok=%v job=%#v", ok, timedOutJob)
	}
	if timedOutJob.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("expected provider timeout reason code, got %v", timedOutJob.GetReasonCode())
	}

	timedOutAsset, ok := store.getAsset(timeoutAsset.GetVoiceAssetId())
	if !ok || timedOutAsset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_FAILED {
		t.Fatalf("expected failed asset after timeout, got ok=%v asset=%#v", ok, timedOutAsset)
	}
}
