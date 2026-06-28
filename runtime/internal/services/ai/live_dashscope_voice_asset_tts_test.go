package ai

import (
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

func TestLiveSmokeDashScopeVoiceAssetBackedTTS(t *testing.T) {
	if strings.TrimSpace(os.Getenv("NIMI_LIVE_DASHSCOPE_API_KEY")) == "" {
		t.Skip("set NIMI_LIVE_DASHSCOPE_API_KEY to run DashScope voice asset-backed TTS live smoke")
	}
	record, ok := providerregistry.Lookup("dashscope")
	if !ok || !record.SupportsVoiceDesign || !record.SupportsVoiceClone || !record.SupportsTTS {
		t.Skip("dashscope provider does not advertise required voice workflow and TTS capabilities")
	}

	for _, tc := range []struct {
		name         string
		scenarioType runtimev1.ScenarioType
		modelKey     string
		buildSpec    func(targetModelID string) *runtimev1.ScenarioSpec
	}{
		{
			name:         "voice_design",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
			modelKey:     "VOICE_DESIGN_MODEL_ID",
			buildSpec: func(targetModelID string) *runtimev1.ScenarioSpec {
				return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceDesign{VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
					TargetModelId: targetModelID,
					Input: &runtimev1.VoiceT2VInput{
						InstructionText: liveSmokeVoiceDesignInstruction,
						PreviewText:     "Hello from Nimi live DashScope voice design asset-backed TTS smoke.",
						PreferredName:   "nimi-live-design",
					},
				}}}
			},
		},
		{
			name:         "voice_clone",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
			modelKey:     "VOICE_CLONE_MODEL_ID",
			buildSpec: func(targetModelID string) *runtimev1.ScenarioSpec {
				return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceClone{VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					TargetModelId: targetModelID,
					Input:         resolveLiveVoiceCloneInput(t, "DASHSCOPE"),
				}}}
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runLiveSmokeDashScopeVoiceAssetBackedTTS(t, record, tc.scenarioType, tc.modelKey, tc.buildSpec)
		})
	}
}

func runLiveSmokeDashScopeVoiceAssetBackedTTS(
	t *testing.T,
	record providerregistry.ProviderRecord,
	scenarioType runtimev1.ScenarioType,
	modelKey string,
	buildSpec func(targetModelID string) *runtimev1.ScenarioSpec,
) {
	t.Helper()
	const providerID = "dashscope"
	const token = "DASHSCOPE"

	harness := newLiveSmokeProviderHarnessForProvider(t, providerID, record)
	svc := harness.service
	workflowModelID := qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, modelKey, "TTS_MODEL_ID"))
	targetModelID := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + token + "_" + modelKey + "_TARGET_MODEL_ID"))
	if targetModelID == "" {
		targetModelID = strings.TrimPrefix(workflowModelID, "cloud/")
	}

	submitResp, err := svc.SubmitScenarioJob(harness.context, &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, workflowModelID, 120_000),
		ScenarioType:  scenarioType,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec:          buildSpec(targetModelID),
	})
	if err != nil {
		t.Fatalf("submit DashScope voice workflow failed: %v", err)
	}
	voiceAssetID := strings.TrimSpace(submitResp.GetAsset().GetVoiceAssetId())
	if voiceAssetID == "" {
		t.Fatalf("DashScope voice workflow must return voice asset")
	}
	ownerCtx := scenarioJobContext(liveSmokeMatrixAppID)
	defer func() {
		deleteResp, deleteErr := svc.DeleteVoiceAsset(ownerCtx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: voiceAssetID})
		if deleteErr != nil {
			t.Errorf("DeleteVoiceAsset(%s): %v", voiceAssetID, deleteErr)
			return
		}
		if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
			t.Errorf("DeleteVoiceAsset(%s) ack must be ok", voiceAssetID)
		}
	}()

	workflowJob := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if workflowJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("DashScope voice workflow job status not completed: %s reason=%s detail=%s", workflowJob.GetStatus().String(), workflowJob.GetReasonCode().String(), workflowJob.GetReasonDetail())
	}
	assetResp, err := svc.GetVoiceAsset(ownerCtx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: voiceAssetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(%s): %v", voiceAssetID, err)
	}
	asset := assetResp.GetAsset()
	if asset == nil {
		t.Fatalf("GetVoiceAsset(%s) returned nil asset", voiceAssetID)
	}
	if asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE {
		t.Fatalf("voice asset status=%s, want ACTIVE", asset.GetStatus().String())
	}
	if strings.TrimSpace(asset.GetProviderVoiceRef()) == "" {
		t.Fatalf("voice asset %s missing provider_voice_ref", voiceAssetID)
	}

	synthResp, err := svc.SubmitScenarioJob(harness.context, &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, qualifyLiveModelIDForRoute(providerID, targetModelID), liveSmokeTimeoutMS(runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE)),
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
			Text: "Hello from Nimi live DashScope voice asset-backed TTS smoke.",
			VoiceRef: &runtimev1.VoiceReference{
				Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
				Reference: &runtimev1.VoiceReference_VoiceAssetId{
					VoiceAssetId: voiceAssetID,
				},
			},
		}}},
	})
	if err != nil {
		t.Fatalf("submit DashScope TTS via voice asset failed: %v", err)
	}
	synthJob := waitLiveSmokeScenarioJob(t, svc, synthResp.GetJob().GetJobId())
	if synthJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("DashScope voice asset TTS job status not completed: %s reason=%s detail=%s", synthJob.GetStatus().String(), synthJob.GetReasonCode().String(), synthJob.GetReasonDetail())
	}
	artifactsResp, err := svc.GetScenarioArtifacts(scenarioJobContext(liveSmokeMatrixAppID), &runtimev1.GetScenarioArtifactsRequest{JobId: synthJob.GetJobId()})
	if err != nil {
		t.Fatalf("GetScenarioArtifacts(%s): %v", synthJob.GetJobId(), err)
	}
	if len(artifactsResp.GetArtifacts()) == 0 {
		t.Fatalf("DashScope voice asset TTS returned no artifacts")
	}
	artifact := artifactsResp.GetArtifacts()[0]
	if len(artifact.GetBytes()) == 0 && strings.TrimSpace(artifact.GetUri()) == "" {
		t.Fatalf("DashScope voice asset TTS artifact must contain bytes or uri")
	}
}
