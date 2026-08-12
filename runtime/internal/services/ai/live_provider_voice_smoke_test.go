//go:build live

package ai

import (
	"os"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

func TestLiveSmokeVideoGenerateSpecVolcengineUsesBuiltInFallbacks(t *testing.T) {
	t.Setenv("NIMI_LIVE_VOLCENGINE_VIDEO_PROMPT", "")
	t.Setenv("NIMI_LIVE_VOLCENGINE_SEEDANCE_PROMPT", "")
	t.Setenv("NIMI_LIVE_VOLCENGINE_VIDEO_REFERENCE_IMAGE_1_URL", "")
	t.Setenv("NIMI_LIVE_VOLCENGINE_VIDEO_REFERENCE_IMAGE_2_URL", "")
	t.Setenv("NIMI_LIVE_VOLCENGINE_VIDEO_REFERENCE_VIDEO_1_URL", "")
	t.Setenv("NIMI_LIVE_VOLCENGINE_VIDEO_REFERENCE_AUDIO_1_URL", "")

	spec := liveSmokeVideoGenerateSpec("volcengine", "volcengine/doubao-seedance-2-0-260128")
	if spec == nil {
		t.Fatal("expected volcengine live smoke video spec")
	}
	if got := strings.TrimSpace(spec.GetContent()[0].GetText()); got == "" {
		t.Fatal("expected built-in fallback prompt")
	}
	if got := strings.TrimSpace(spec.GetContent()[1].GetImageUrl().GetUrl()); got == "" {
		t.Fatal("expected built-in fallback reference image 1")
	}
	if got := strings.TrimSpace(spec.GetContent()[2].GetImageUrl().GetUrl()); got == "" {
		t.Fatal("expected built-in fallback reference image 2")
	}
	if got := strings.TrimSpace(spec.GetContent()[3].GetVideoUrl().GetUrl()); got == "" {
		t.Fatal("expected built-in fallback reference video")
	}
	if got := strings.TrimSpace(spec.GetContent()[4].GetAudioUrl().GetUrl()); got == "" {
		t.Fatal("expected built-in fallback reference audio")
	}
}

func runLiveSmokeVoiceWorkflowForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord, creationSource runtimev1.VoiceCreationSource) {
	t.Helper()
	harness := newLiveSmokeProviderHarnessForProvider(t, providerID, record)
	svc := harness.service
	token := liveProviderEnvToken(providerID)

	var modelKey string
	var fallbackModelKey string
	switch creationSource {
	case runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO:
		modelKey = "VOICE_REFERENCE_AUDIO_MODEL_ID"
		fallbackModelKey = "TTS_MODEL_ID"
	case runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_TEXT_DESCRIPTION:
		modelKey = "VOICE_TEXT_DESCRIPTION_MODEL_ID"
		fallbackModelKey = "TTS_MODEL_ID"
	default:
		t.Fatalf("unsupported voice creation source: %s", creationSource)
	}
	modelID := envModelIDForProvider(t, providerID, modelKey, fallbackModelKey)
	targetModelID := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + token + "_" + modelKey + "_TARGET_MODEL_ID"))
	if targetModelID == "" {
		targetModelID = modelID
	}

	spec := &runtimev1.ScenarioSpec{}
	switch creationSource {
	case runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO:
		spec.Spec = &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			TargetModelId: targetModelID,
			Source:        &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: resolveLiveVoiceReferenceAudioInput(t, token)},
		}}
	case runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_TEXT_DESCRIPTION:
		previewText := liveEnvFirstOrDefault("Hello from Nimi DashScope CosyVoice text-description creation.", "NIMI_LIVE_"+token+"_VOICE_TEXT_DESCRIPTION_PREVIEW_TEXT", "NIMI_LIVE_VOICE_TEXT_DESCRIPTION_PREVIEW_TEXT")
		spec.Spec = &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			TargetModelId: targetModelID,
			Source:        &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: liveSmokeVoiceTextDescriptionInstruction, PreviewText: previewText}},
		}}
	}
	maybeSkipFishAudioBalancePreflight(t, svc, providerID, modelID)

	const scenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE
	submitResp, err := svc.SubmitScenarioJob(harness.scenarioContext(t, scenarioType, modelID), &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, modelID, 120_000),
		ScenarioType:  scenarioType,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec:          spec,
	})
	if err != nil {
		maybeSkipFishAudioBalanceBlocked(t, providerID, err, nil)
		maybeSkipStepFunQuotaBlocked(t, providerID, err, nil)
		t.Fatalf("submit voice workflow failed: %v", err)
	}
	ownerCtx := scenarioJobContext(liveSmokeMatrixAppID)
	job := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		maybeSkipFishAudioBalanceBlocked(t, providerID, nil, job)
		maybeSkipStepFunQuotaBlocked(t, providerID, nil, job)
		t.Fatalf("voice workflow job status not completed: %s reason=%s detail=%s", job.GetStatus().String(), job.GetReasonCode().String(), job.GetReasonDetail())
	}
	terminal, err := svc.GetScenarioJob(ownerCtx, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
	if err != nil {
		t.Fatalf("GetScenarioJob(%s) terminal result: %v", job.GetJobId(), err)
	}
	voiceAssetID := strings.TrimSpace(terminal.GetAsset().GetVoiceAssetId())
	if voiceAssetID == "" || terminal.GetVoiceReference().GetVoiceAssetId() != voiceAssetID {
		t.Fatalf("voice workflow terminal result must contain an exact voice asset reference")
	}
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
	if strings.EqualFold(strings.TrimSpace(providerID), "mimo") {
		runLiveSmokeSpeechSynthesizeWithVoiceAsset(t, harness, providerID, targetModelID, voiceAssetID)
	}
}

func runLiveSmokeSpeechSynthesizeWithVoiceAsset(t *testing.T, harness liveSmokeProviderHarness, providerID string, modelID string, voiceAssetID string) {
	t.Helper()
	svc := harness.service
	synthResp, err := svc.SubmitScenarioJob(harness.scenarioContext(t, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, modelID), &runtimev1.SubmitScenarioJobRequest{
		Head:          harness.scenarioHead(t, liveSmokeMatrixAppID, liveSmokeMatrixUserID, modelID, 120_000),
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "Hello from Nimi live voice asset synthesis smoke.",
					VoiceRef: &runtimev1.VoiceReference{
						Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
						Reference: &runtimev1.VoiceReference_VoiceAssetId{
							VoiceAssetId: voiceAssetID,
						},
					},
				},
			},
		},
	})
	if err != nil {
		maybeSkipFishAudioBalanceBlocked(t, providerID, err, nil)
		maybeSkipStepFunQuotaBlocked(t, providerID, err, nil)
		t.Fatalf("submit speech synth via voice asset failed: %v", err)
	}
	synthJob := waitLiveSmokeScenarioJob(t, svc, synthResp.GetJob().GetJobId())
	if synthJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		maybeSkipFishAudioBalanceBlocked(t, providerID, nil, synthJob)
		maybeSkipStepFunQuotaBlocked(t, providerID, nil, synthJob)
		t.Fatalf("voice asset synth job status not completed: %s reason=%s detail=%s", synthJob.GetStatus().String(), synthJob.GetReasonCode().String(), synthJob.GetReasonDetail())
	}
	artifactsResp, err := svc.GetScenarioArtifacts(scenarioJobContext(liveSmokeMatrixAppID), &runtimev1.GetScenarioArtifactsRequest{
		JobId: synthJob.GetJobId(),
	})
	if err != nil {
		t.Fatalf("GetScenarioArtifacts(%s): %v", synthJob.GetJobId(), err)
	}
	if len(artifactsResp.GetArtifacts()) == 0 {
		t.Fatalf("voice asset synth returned no artifacts")
	}
	firstArtifact := artifactsResp.GetArtifacts()[0]
	if len(firstArtifact.GetBytes()) == 0 && strings.TrimSpace(firstArtifact.GetUri()) == "" {
		t.Fatalf("voice asset synth artifact must contain bytes or uri")
	}
}

func waitLiveSmokeScenarioJob(t *testing.T, svc *Service, jobID string) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(6 * time.Minute)
	for {
		resp, err := svc.GetScenarioJob(scenarioJobContext(liveSmokeMatrixAppID), &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if err != nil {
			t.Fatalf("GetScenarioJob(%s): %v", jobID, err)
		}
		job := resp.GetJob()
		if job == nil {
			t.Fatalf("GetScenarioJob(%s) returned nil job", jobID)
		}
		switch job.GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
			return job
		}
		if time.Now().After(deadline) {
			t.Fatalf("scenario job %s did not reach terminal state before deadline, last_status=%s", jobID, job.GetStatus().String())
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func waitLiveSmokeScenarioJobAccepted(t *testing.T, svc *Service, jobID string, maxWait time.Duration) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(maxWait)
	for {
		resp, err := svc.GetScenarioJob(scenarioJobContext(liveSmokeMatrixAppID), &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if err != nil {
			t.Fatalf("GetScenarioJob(%s): %v", jobID, err)
		}
		job := resp.GetJob()
		if job == nil {
			t.Fatalf("GetScenarioJob(%s) returned nil job", jobID)
		}
		if strings.TrimSpace(job.GetProviderJobId()) != "" || job.GetNextPollAt() != nil {
			return job
		}
		switch job.GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
			return job
		}
		if time.Now().After(deadline) {
			t.Fatalf("scenario job %s did not expose async acceptance state before deadline, last_status=%s", jobID, job.GetStatus().String())
		}
		time.Sleep(500 * time.Millisecond)
	}
}
