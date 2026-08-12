package ai

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestVoiceAssetStoreCompleteAndTimeoutJob(t *testing.T) {
	store := newVoiceAssetStore()

	job, asset := store.submit(&voiceWorkflowSubmitInput{
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: runtimeAgentVoiceAssetTestTarget("connector-test"),
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				}},
			}},
		},
		Provider:          "dashscope",
		OutputPersistence: "provider_persistent",
	})
	if job == nil || asset == nil {
		t.Fatalf("submit should create voice job and asset")
	}

	if !store.completeJob(job.GetJobId(), "voice-ref-1", map[string]any{"quality": "high"}, &runtimev1.UsageStats{InputTokens: 1}) {
		t.Fatalf("completeJob should succeed")
	}

	completedJob, ok := store.getJob(job.GetJobId())
	if !ok || completedJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("expected completed job, got ok=%v job=%#v", ok, completedJob)
	}
	if completedJob.GetProviderJobId() != "" {
		t.Fatalf("provider-private job id escaped, got %q", completedJob.GetProviderJobId())
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
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: runtimeAgentVoiceAssetTestTarget("connector-test"),
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				}},
			}},
		},
		Provider: "stepfun",
	})
	if timeoutJob == nil || timeoutAsset == nil {
		t.Fatalf("submit should create timeout job and asset")
	}

	timeoutMetadata := structFromMap(map[string]any{"failure_stage": "voice_workflow_execution"})
	if !store.timeoutJob(timeoutJob.GetJobId(), runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "timed out", timeoutMetadata) {
		t.Fatalf("timeoutJob should succeed")
	}

	timedOutJob, ok := store.getJob(timeoutJob.GetJobId())
	if !ok || timedOutJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT {
		t.Fatalf("expected timeout job status, got ok=%v job=%#v", ok, timedOutJob)
	}
	if timedOutJob.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("expected provider timeout reason code, got %v", timedOutJob.GetReasonCode())
	}
	if got := timedOutJob.GetReasonMetadata().GetFields()["failure_stage"].GetStringValue(); got != "voice_workflow_execution" {
		t.Fatalf("expected typed timeout failure metadata, got %q", got)
	}

	timedOutAsset, ok := store.getAsset(timeoutAsset.GetVoiceAssetId())
	if !ok || timedOutAsset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_FAILED {
		t.Fatalf("expected failed asset after timeout, got ok=%v asset=%#v", ok, timedOutAsset)
	}
}

func TestVoiceAssetStorePrunesExpiredTerminalJobsAndAssets(t *testing.T) {
	store := newVoiceAssetStore()
	job, asset := store.submit(&voiceWorkflowSubmitInput{
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: runtimeAgentVoiceAssetTestTarget("connector-test"),
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				}},
			}},
		},
		Provider: "dashscope",
	})
	if job == nil || asset == nil {
		t.Fatalf("expected submitted voice workflow")
	}
	if !store.completeJob(job.GetJobId(), "voice-ref", nil, nil) {
		t.Fatalf("expected completed voice workflow")
	}

	store.mu.Lock()
	store.jobs[job.GetJobId()].terminalAt = time.Now().UTC().Add(-voiceAssetStoreRetentionWindow - time.Minute)
	store.mu.Unlock()

	if nextJob, nextAsset := store.submit(&voiceWorkflowSubmitInput{
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: runtimeAgentVoiceAssetTestTarget("connector-test"),
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				}},
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

func TestVoiceAssetStoreKeepsProviderPersistentAssetsAfterTerminalJobPrune(t *testing.T) {
	store := newVoiceAssetStore()
	job, asset := store.submit(&voiceWorkflowSubmitInput{
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: runtimeAgentVoiceAssetTestTarget("connector-test"),
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				}},
			}},
		},
		Provider:          "dashscope",
		OutputPersistence: "provider_persistent",
	})
	if job == nil || asset == nil {
		t.Fatalf("expected submitted provider-persistent voice workflow")
	}
	if !store.completeJob(job.GetJobId(), "dashscope-provider-voice-ref", nil, nil) {
		t.Fatalf("expected completed voice workflow")
	}

	store.mu.Lock()
	store.jobs[job.GetJobId()].terminalAt = time.Now().UTC().Add(-voiceAssetStoreRetentionWindow - time.Minute)
	store.mu.Unlock()

	if nextJob, nextAsset := store.submit(&voiceWorkflowSubmitInput{
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: runtimeAgentVoiceAssetTestTarget("connector-test"),
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{
					InstructionText: "warm cinematic narrator",
				}},
			}},
		},
		Provider: "dashscope",
	}); nextJob == nil || nextAsset == nil {
		t.Fatalf("expected fresh submitted voice workflow")
	}

	if _, ok := store.getJob(job.GetJobId()); ok {
		t.Fatalf("expected expired terminal voice job to be pruned")
	}
	stored, ok := store.getAsset(asset.GetVoiceAssetId())
	if !ok {
		t.Fatalf("provider-persistent voice asset must outlive terminal job retention")
	}
	if stored.GetProviderVoiceRef() != "dashscope-provider-voice-ref" {
		t.Fatalf("provider-persistent voice asset lost provider handle: %#v", stored)
	}
	if stored.GetPersistence() != runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT {
		t.Fatalf("unexpected persistence after prune: %v", stored.GetPersistence())
	}
}

func TestVoiceAssetStoreSubmitKeepsTargetRuntimePrivate(t *testing.T) {
	store := newVoiceAssetStore()
	targetRef := cloudScenarioTargetRef("connector-dashscope", "remote-catalog-dashscope-vc", "qwen3-tts-vc", "dashscope")
	_, asset := store.submit(&voiceWorkflowSubmitInput{
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: targetRef,
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				}},
			}},
		},
		Provider:          "dashscope",
		OutputPersistence: "provider_persistent",
	})
	if asset == nil {
		t.Fatalf("submit should create voice asset")
	}
	_, storedTarget, ok := store.getAssetBinding(asset.GetVoiceAssetId())
	if !ok || !runtimeidentity.Equal(storedTarget, targetRef) {
		t.Fatalf("private target mismatch: got=%#v want=%#v", storedTarget, targetRef)
	}
}

func TestVoiceAssetStoreProviderPersistentAssetsSurviveStoreReopen(t *testing.T) {
	localStatePath := t.TempDir() + "/local-state.json"
	store, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatalf("newVoiceAssetStoreForLocalStatePath: %v", err)
	}
	targetRef := cloudScenarioTargetRef("connector-dashscope", "remote-catalog-dashscope-vc", "qwen3-tts-vc", "dashscope")
	targetRef.Cloud.ConnectorGrantID = "grant-dashscope"
	providerTarget, _ := structpb.NewStruct(map[string]any{
		"provider": "dashscope", "providerModelId": "qwen3-tts-vc", "remoteModelCatalogId": "remote-catalog-dashscope-vc",
	})
	job, asset := store.submit(&voiceWorkflowSubmitInput{
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: targetRef,
		CloudBinding: &voiceAssetCloudBinding{
			CapabilityContract: "voice.create",
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.voice.dashscope", DriverId: "driver.dashscope", DriverDialect: "dashscope/voice/v1",
			},
			ProviderModelTarget: providerTarget, ConnectorGrantID: targetRef.Cloud.ConnectorGrantID,
		},
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				}},
			}},
		},
		Provider:          "dashscope",
		OutputPersistence: "provider_persistent",
	})
	if job == nil || asset == nil {
		t.Fatalf("submit should create voice workflow and asset")
	}
	if !store.completeJob(job.GetJobId(), "dashscope-provider-voice-ref", nil, nil) {
		t.Fatalf("completeJob should succeed")
	}

	reopened, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatalf("reopen voice asset store: %v", err)
	}
	stored, storedTarget, ok := reopened.getAssetBinding(asset.GetVoiceAssetId())
	if !ok {
		t.Fatalf("provider-persistent voice asset must survive store reopen")
	}
	if stored.GetProviderVoiceRef() != "dashscope-provider-voice-ref" {
		t.Fatalf("provider voice ref after reopen=%q", stored.GetProviderVoiceRef())
	}
	if !runtimeidentity.Equal(storedTarget, targetRef) {
		t.Fatalf("private target after reopen mismatch: got=%#v want=%#v", storedTarget, targetRef)
	}
	_, _, storedBinding, ok := reopened.getAssetCloudBinding(asset.GetVoiceAssetId())
	if !ok || !storedBinding.Valid() || storedBinding.ConnectorGrantID != targetRef.Cloud.ConnectorGrantID || storedBinding.Implementation.GetDriverDialect() != "dashscope/voice/v1" {
		t.Fatalf("private AIConfig binding after reopen=%+v", storedBinding)
	}
}

func TestVoiceAssetStoreCompleteFailsClosedWhenProviderPersistentSnapshotCannotPersist(t *testing.T) {
	store := newVoiceAssetStore()
	store.durablePath = t.TempDir()
	job, asset := store.submit(&voiceWorkflowSubmitInput{
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: runtimeAgentVoiceAssetTestTarget("connector-test"),
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
				}},
			}},
		},
		Provider:          "dashscope",
		OutputPersistence: "provider_persistent",
	})
	if job == nil || asset == nil {
		t.Fatalf("submit should create provider-persistent voice workflow")
	}

	if store.completeJob(job.GetJobId(), "dashscope-provider-voice-ref", nil, nil) {
		t.Fatalf("provider-persistent completion must fail closed when durable snapshot cannot persist")
	}
	completedAsset, ok := store.getAsset(asset.GetVoiceAssetId())
	if !ok {
		t.Fatalf("asset should remain visible with failed status for diagnosis")
	}
	if completedAsset.GetProviderVoiceRef() != "" {
		t.Fatalf("failed durable completion must not leave a usable provider voice ref, got %q", completedAsset.GetProviderVoiceRef())
	}
	if completedAsset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_FAILED {
		t.Fatalf("failed durable completion status=%v, want FAILED", completedAsset.GetStatus())
	}
	completedJob, ok := store.getJob(job.GetJobId())
	if !ok {
		t.Fatalf("job should remain visible with failed status for diagnosis")
	}
	if completedJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("job status after failed durable completion=%v, want FAILED", completedJob.GetStatus())
	}
}

func TestVoiceAssetStoreSubmitPersistsExplicitWorkflowFamilyMetadata(t *testing.T) {
	store := newVoiceAssetStore()
	cases := []struct {
		name            string
		modelID         string
		targetModelID   string
		workflowModelID string
		wantFamily      string
	}{
		{
			name:            "qwen3tts",
			modelID:         "speech/qwen3tts",
			targetModelID:   "speech/qwen3tts",
			workflowModelID: "qwen3-local-voice-design",
			wantFamily:      "qwen3_tts",
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
				RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ExecutionTarget: runtimeAgentVoiceAssetTestTarget("connector-test"),
				Head: &runtimev1.ScenarioRequestHead{
					AppId:         "app-1",
					SubjectUserId: "user-1",
				},
				ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
				Spec: &runtimev1.ScenarioSpec{
					Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
						Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{
							InstructionText: "warm cinematic narrator",
						}},
					}},
				},
				ModelResolved:   tc.modelID,
				WorkflowModelID: tc.workflowModelID,
				WorkflowFamily:  tc.wantFamily,
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
