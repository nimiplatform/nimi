package ai

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func testVoiceAssetCloudBinding(target *runtimeidentity.Target) *voiceAssetCloudBinding {
	providerTarget, _ := structpb.NewStruct(map[string]any{
		"provider": target.Cloud.Provider, "providerModelId": target.Cloud.ProviderModelID,
		"remoteModelCatalogId": target.Cloud.RemoteModelCatalogID,
	})
	return &voiceAssetCloudBinding{
		CapabilityContract: "voice.create",
		Implementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "cloud.voice.test", DriverId: "driver.voice.test", DriverDialect: "test/voice/v1",
		},
		ProviderModelTarget: providerTarget,
		ConnectorID:         target.Cloud.ConnectorID,
	}
}

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
		Provider: "dashscope",
	})
	if job == nil || asset == nil {
		t.Fatalf("submit should create voice job and asset")
	}
	if _, ok := store.getAsset(asset.GetVoiceAssetId()); ok {
		t.Fatalf("submitted voice job must not publish an Asset before completion")
	}
	if !store.runJob(job.GetJobId()) {
		t.Fatal("runJob should transition the Job")
	}
	if _, ok := store.getAsset(asset.GetVoiceAssetId()); ok {
		t.Fatalf("running voice job must not publish an Asset before completion")
	}
	if assets := store.listAssets(&runtimev1.ListVoiceAssetsRequest{AppId: "app-1", SubjectUserId: "user-1"}); len(assets) != 0 {
		t.Fatalf("running voice job draft appeared in list: %+v", assets)
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
	resultAsset, resultReference, ok := store.getCompletedJobResult(job.GetJobId())
	if !ok || resultAsset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE ||
		resultReference.GetVoiceAssetId() != resultAsset.GetVoiceAssetId() {
		t.Fatalf("completed Job result snapshot is invalid: asset=%+v reference=%+v found=%v", resultAsset, resultReference, ok)
	}
	store.mu.Lock()
	store.assets[asset.GetVoiceAssetId()].Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_EXPIRED
	store.assets[asset.GetVoiceAssetId()].UpdatedAt = timestamppb.Now()
	store.mu.Unlock()
	resultAfterStatusMutation, referenceAfterStatusMutation, ok := store.getCompletedJobResult(job.GetJobId())
	if !ok || resultAfterStatusMutation.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE ||
		!proto.Equal(resultAfterStatusMutation, resultAsset) || !proto.Equal(referenceAfterStatusMutation, resultReference) {
		t.Fatalf("catalog Asset status mutation changed terminal Job result: before=%+v/%+v after=%+v/%+v found=%v",
			resultAsset, resultReference, resultAfterStatusMutation, referenceAfterStatusMutation, ok)
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

	if timedOutAsset, ok := store.getAsset(timeoutAsset.GetVoiceAssetId()); ok {
		t.Fatalf("timed-out voice job must not publish an Asset, got %#v", timedOutAsset)
	}
}

func TestVoiceAssetStoreNonSuccessTerminalsNeverPublishVoiceResults(t *testing.T) {
	t.Run("failed", func(t *testing.T) {
		store := newVoiceAssetStore()
		job, draft := newVoiceAssetStoreJobForTerminalTest(t, store)
		if !store.failJob(job.GetJobId(), runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, "failed", nil) {
			t.Fatal("failJob should transition the Job")
		}
		assertVoiceAssetDraftNotPublished(t, store, draft.GetVoiceAssetId())
	})

	t.Run("timeout", func(t *testing.T) {
		store := newVoiceAssetStore()
		job, draft := newVoiceAssetStoreJobForTerminalTest(t, store)
		if !store.timeoutJob(job.GetJobId(), runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "timeout", nil) {
			t.Fatal("timeoutJob should transition the Job")
		}
		assertVoiceAssetDraftNotPublished(t, store, draft.GetVoiceAssetId())
	})

	t.Run("canceled", func(t *testing.T) {
		store := newVoiceAssetStore()
		job, draft := newVoiceAssetStoreJobForTerminalTest(t, store)
		if _, ok := store.cancelJob(job.GetJobId(), "canceled"); !ok {
			t.Fatal("cancelJob should transition the Job")
		}
		assertVoiceAssetDraftNotPublished(t, store, draft.GetVoiceAssetId())
	})

	t.Run("empty-provider-handle", func(t *testing.T) {
		store := newVoiceAssetStore()
		job, draft := newVoiceAssetStoreJobForTerminalTest(t, store)
		if store.completeJob(job.GetJobId(), "", nil, nil) {
			t.Fatal("completion without a provider handle must fail closed")
		}
		terminal, ok := store.getJob(job.GetJobId())
		if !ok || terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
			terminal.GetReasonCode() != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("empty-handle terminal Job=%+v found=%v", terminal, ok)
		}
		assertVoiceAssetDraftNotPublished(t, store, draft.GetVoiceAssetId())
	})

}

func newVoiceAssetStoreJobForTerminalTest(t *testing.T, store *voiceAssetStore) (*runtimev1.ScenarioJob, *runtimev1.VoiceAsset) {
	t.Helper()
	if store == nil {
		store = newVoiceAssetStore()
	}
	job, draft := store.submit(&voiceWorkflowSubmitInput{
		Head:            &runtimev1.ScenarioRequestHead{AppId: "app-terminal", SubjectUserId: "user-terminal"},
		ScenarioType:    runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec:            &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "calm voice"}}}}},
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		Provider:        "local",
		ExecutionTarget: &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{ReadinessRef: "local-asset://voice-terminal"}},
	})
	if job == nil || draft == nil {
		t.Fatal("submit should create a private voice result draft")
	}
	assertVoiceAssetDraftNotPublished(t, store, draft.GetVoiceAssetId())
	return job, draft
}

func assertVoiceAssetDraftNotPublished(t *testing.T, store *voiceAssetStore, assetID string) {
	t.Helper()
	if asset, ok := store.getAsset(assetID); ok {
		t.Fatalf("private voice result draft was published: %+v", asset)
	}
	if assets := store.listAssets(&runtimev1.ListVoiceAssetsRequest{AppId: "app-terminal", SubjectUserId: "user-terminal"}); len(assets) != 0 {
		t.Fatalf("private voice result draft appeared in list: %+v", assets)
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
	target := runtimeAgentVoiceAssetTestTarget("connector-test")
	job, asset := store.submit(&voiceWorkflowSubmitInput{
		RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ExecutionTarget: target,
		CloudBinding:    testVoiceAssetCloudBinding(target),
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
	job, asset := store.submit(&voiceWorkflowSubmitInput{
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
		Provider: "dashscope",
	})
	if asset == nil {
		t.Fatalf("submit should create voice asset")
	}
	if _, _, ok := store.getAssetBinding(asset.GetVoiceAssetId()); ok {
		t.Fatalf("submit must not publish the private target or VoiceAsset")
	}
	if !store.completeJob(job.GetJobId(), "provider-voice-ref", nil, nil) {
		t.Fatalf("completeJob should publish the terminal result")
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
			ProviderModelTarget: providerTarget, ConnectorID: targetRef.Cloud.ConnectorID,
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
	if _, ok := reopened.getJob(job.GetJobId()); ok {
		t.Fatal("VoiceAsset durability must not extend the process-local Scenario Job retention boundary")
	}
	_, _, storedBinding, ok := reopened.getAssetCloudBinding(asset.GetVoiceAssetId())
	if !ok || !storedBinding.Valid() || storedBinding.ConnectorID != targetRef.Cloud.ConnectorID || storedBinding.Implementation.GetDriverDialect() != "dashscope/voice/v1" {
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
	if completedAsset, ok := store.getAsset(asset.GetVoiceAssetId()); ok {
		t.Fatalf("failed durable completion must not publish a VoiceAsset, got %#v", completedAsset)
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
