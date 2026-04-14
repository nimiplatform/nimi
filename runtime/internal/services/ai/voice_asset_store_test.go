package ai

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestVoiceAssetStoreCompleteAndTimeoutJob(t *testing.T) {
	store := newVoiceAssetStore()

	job, asset := store.submit(&voiceWorkflowSubmitInput{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
			ModelId:       "dashscope/qwen3-tts-vc",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
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
			ModelId:       "stepfun/step-tts-vc",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
				TargetModelId: "stepfun/step-tts-vc",
				Input: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				},
			}},
		},
		Provider: "stepfun",
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

func TestVoiceAssetStorePrunesExpiredTerminalJobsAndAssets(t *testing.T) {
	store := newVoiceAssetStore()
	job, asset := store.submit(&voiceWorkflowSubmitInput{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
			ModelId:       "dashscope/qwen3-tts-vc",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
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
		Provider: "dashscope",
	})
	if job == nil || asset == nil {
		t.Fatalf("expected submitted voice workflow")
	}
	if !store.completeJob(job.GetJobId(), "provider-job", "voice-ref", nil, nil) {
		t.Fatalf("expected completed voice workflow")
	}

	store.mu.Lock()
	store.jobs[job.GetJobId()].terminalAt = time.Now().UTC().Add(-voiceAssetStoreRetentionWindow - time.Minute)
	store.mu.Unlock()

	if nextJob, nextAsset := store.submit(&voiceWorkflowSubmitInput{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
			ModelId:       "dashscope/qwen3-tts-vc",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
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
		Provider: "dashscope",
	}); nextJob == nil || nextAsset == nil {
		t.Fatalf("expected fresh submitted voice workflow")
	}

	if _, ok := store.getJob(job.GetJobId()); ok {
		t.Fatalf("expected expired terminal voice job to be pruned")
	}
	if _, ok := store.getAsset(asset.GetVoiceAssetId()); ok {
		t.Fatalf("expected expired terminal voice asset to be pruned")
	}
}

func TestVoiceAssetStoreSubmitPersistsWorkflowFamilyMetadata(t *testing.T) {
	store := newVoiceAssetStore()
	cases := []struct {
		name            string
		modelID         string
		targetModelID   string
		workflowModelID string
		wantFamily      string
	}{
		{
			name:            "voxcpm2",
			modelID:         "openbmb/VoxCPM2",
			targetModelID:   "openbmb/VoxCPM2",
			workflowModelID: "local/voxcpm-voice-design",
			wantFamily:      "voxcpm",
		},
		{
			name:            "omnivoice",
			modelID:         "k2-fsa/OmniVoice",
			targetModelID:   "k2-fsa/OmniVoice",
			workflowModelID: "local/omnivoice-voice-clone",
			wantFamily:      "omnivoice",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, asset := store.submit(&voiceWorkflowSubmitInput{
				Head: &runtimev1.ScenarioRequestHead{
					AppId:         "app-1",
					SubjectUserId: "user-1",
					ModelId:       tc.modelID,
					RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				},
				ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
				Spec: &runtimev1.ScenarioSpec{
					Spec: &runtimev1.ScenarioSpec_VoiceDesign{VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
						TargetModelId: tc.targetModelID,
						Input: &runtimev1.VoiceT2VInput{
							InstructionText: "warm cinematic narrator",
						},
					}},
				},
				ModelResolved:   tc.modelID,
				WorkflowModelID: tc.workflowModelID,
				Provider:        "local",
			})
			if asset == nil {
				t.Fatalf("submit should create voice asset")
			}
			if got := asset.GetMetadata().GetFields()["workflow_family"].GetStringValue(); got != tc.wantFamily {
				t.Fatalf("workflow_family=%q, want=%q", got, tc.wantFamily)
			}
		})
	}
}
