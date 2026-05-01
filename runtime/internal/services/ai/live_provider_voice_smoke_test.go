package ai

import (
	"context"
	"errors"
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

func TestQualifyLocalSpeechLiveModelID(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{in: "", want: ""},
		{in: "qwen3tts", want: "speech/qwen3tts"},
		{in: "speech/qwen3tts", want: "speech/qwen3tts"},
		{in: "local/qwen3-tts", want: "local/qwen3-tts"},
	}
	for _, tc := range cases {
		if got := qualifyLocalSpeechLiveModelID(tc.in); got != tc.want {
			t.Fatalf("qualifyLocalSpeechLiveModelID(%q)=%q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestLiveSmokeLocalQwen3Synthesize(t *testing.T) {
	baseURL := liveEnvFirst("NIMI_LIVE_LOCAL_SPEECH_BASE_URL", "NIMI_LIVE_LOCAL_BASE_URL")
	if baseURL == "" {
		t.Skip("set NIMI_LIVE_LOCAL_SPEECH_BASE_URL or NIMI_LIVE_LOCAL_BASE_URL to run local qwen3 synth live smoke")
	}
	modelID := qualifyLocalSpeechLiveModelID(liveEnvFirst("NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID", "NIMI_LIVE_LOCAL_TTS_MODEL_ID"))
	if modelID == "" {
		t.Skip("set NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID or NIMI_LIVE_LOCAL_TTS_MODEL_ID to run local qwen3 synth live smoke")
	}
	if !isAdmittedLocalQwen3WorkflowModelID(modelID) {
		t.Skip("local qwen3 synth smoke only accepts admitted qwen3 family model ids")
	}
	apiKey := firstNonEmptyString(
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SPEECH_API_KEY")),
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY")),
	)
	runLocalSpeechHostPreflight(t, baseURL, apiKey, modelID)

	record, ok := providerregistry.Lookup("local")
	if !ok || !record.SupportsTTS {
		t.Skip("local provider does not advertise speech synthesis support")
	}
	t.Setenv("NIMI_LIVE_LOCAL_TTS_MODEL_ID", modelID)
	runLiveSmokeMediaForProvider(t, "local", record, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE)
}

func TestLiveSmokeLocalQwen3Transcribe(t *testing.T) {
	baseURL := liveEnvFirst("NIMI_LIVE_LOCAL_SPEECH_BASE_URL", "NIMI_LIVE_LOCAL_BASE_URL")
	if baseURL == "" {
		t.Skip("set NIMI_LIVE_LOCAL_SPEECH_BASE_URL or NIMI_LIVE_LOCAL_BASE_URL to run local qwen3 transcribe live smoke")
	}
	modelID := qualifyLocalSpeechLiveModelID(liveEnvFirst(
		"NIMI_LIVE_LOCAL_STT_MODEL_ID",
		"NIMI_LIVE_LOCAL_QWEN3_ASR_MODEL_ID",
		"NIMI_LIVE_LOCAL_MODEL_ID",
	))
	if modelID == "" {
		t.Skip("set NIMI_LIVE_LOCAL_STT_MODEL_ID or NIMI_LIVE_LOCAL_QWEN3_ASR_MODEL_ID to run local qwen3 transcribe live smoke")
	}
	if !isAdmittedLocalQwen3STTModelID(modelID) {
		t.Skip("local qwen3 transcribe smoke only accepts admitted qwen3 asr model ids")
	}
	if liveEnvFirst("NIMI_LIVE_STT_AUDIO_PATH", "NIMI_LIVE_STT_AUDIO_URI") == "" {
		t.Skip("set NIMI_LIVE_STT_AUDIO_PATH or NIMI_LIVE_STT_AUDIO_URI to run local qwen3 transcribe live smoke")
	}
	apiKey := firstNonEmptyString(
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SPEECH_API_KEY")),
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY")),
	)
	runLocalSpeechHostPreflight(t, baseURL, apiKey, modelID)

	record, ok := providerregistry.Lookup("local")
	if !ok || !record.SupportsSTT {
		t.Skip("local provider does not advertise speech transcription support")
	}
	t.Setenv("NIMI_LIVE_LOCAL_BASE_URL", baseURL)
	t.Setenv("NIMI_LIVE_LOCAL_STT_MODEL_ID", modelID)
	runLiveSmokeMediaForProvider(t, "local", record, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE)
}

func TestLiveSmokeLocalQwen3VoiceDesign(t *testing.T) {
	baseURL := liveEnvFirst("NIMI_LIVE_LOCAL_SPEECH_BASE_URL", "NIMI_LIVE_LOCAL_BASE_URL")
	if baseURL == "" {
		t.Skip("set NIMI_LIVE_LOCAL_SPEECH_BASE_URL or NIMI_LIVE_LOCAL_BASE_URL to run local qwen3 voice design live smoke")
	}
	modelID := qualifyLocalSpeechLiveModelID(liveEnvFirst(
		"NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID",
		"NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID",
		"NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID",
		"NIMI_LIVE_LOCAL_TTS_MODEL_ID",
	))
	if modelID == "" {
		t.Skip("set NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID or NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID to run local qwen3 voice design live smoke")
	}
	if !isAdmittedLocalQwen3WorkflowModelID(modelID) {
		t.Skip("local qwen3 voice design smoke only accepts admitted qwen3 family model ids")
	}
	apiKey := firstNonEmptyString(
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SPEECH_API_KEY")),
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY")),
	)
	runLocalSpeechHostPreflight(t, baseURL, apiKey, modelID)

	record, ok := providerregistry.Lookup("local")
	if !ok || !record.SupportsVoiceDesign {
		t.Skip("local provider does not advertise the admitted qwen3 voice design slice")
	}
	t.Setenv("NIMI_LIVE_LOCAL_BASE_URL", baseURL)
	t.Setenv("NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID", modelID)
	t.Setenv("NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID", modelID)
	runLiveSmokeVoiceWorkflowForProvider(t, "local", record, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN)
}

func TestLiveSmokeLocalQwen3VoiceClone(t *testing.T) {
	baseURL := liveEnvFirst("NIMI_LIVE_LOCAL_SPEECH_BASE_URL", "NIMI_LIVE_LOCAL_BASE_URL")
	if baseURL == "" {
		t.Skip("set NIMI_LIVE_LOCAL_SPEECH_BASE_URL or NIMI_LIVE_LOCAL_BASE_URL to run local qwen3 voice clone live smoke")
	}
	modelID := qualifyLocalSpeechLiveModelID(liveEnvFirst(
		"NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID",
		"NIMI_LIVE_LOCAL_QWEN3_TTS_BASE_MODEL_ID",
		"NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID",
		"NIMI_LIVE_LOCAL_TTS_MODEL_ID",
	))
	if modelID == "" {
		t.Skip("set NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID or NIMI_LIVE_LOCAL_QWEN3_TTS_BASE_MODEL_ID to run local qwen3 voice clone live smoke")
	}
	if !isAdmittedLocalQwen3WorkflowModelID(modelID) {
		t.Skip("local qwen3 voice clone smoke only accepts admitted qwen3 family model ids")
	}
	apiKey := firstNonEmptyString(
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SPEECH_API_KEY")),
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY")),
	)
	runLocalSpeechHostPreflight(t, baseURL, apiKey, modelID)

	record, ok := providerregistry.Lookup("local")
	if !ok || !record.SupportsVoiceClone {
		t.Skip("local provider does not advertise the admitted qwen3 voice clone slice")
	}
	if liveEnvFirst("NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH", "NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI") == "" {
		t.Skip("set NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH or NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI to run local qwen3 voice clone live smoke")
	}
	t.Setenv("NIMI_LIVE_LOCAL_BASE_URL", baseURL)
	t.Setenv("NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID", modelID)
	t.Setenv("NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID", modelID)
	runLiveSmokeVoiceWorkflowForProvider(t, "local", record, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE)
}

func TestLiveSmokeLocalQwen3VoiceAssetLifecycle(t *testing.T) {
	baseURL := liveEnvFirst("NIMI_LIVE_LOCAL_SPEECH_BASE_URL", "NIMI_LIVE_LOCAL_BASE_URL")
	if baseURL == "" {
		t.Skip("set NIMI_LIVE_LOCAL_SPEECH_BASE_URL or NIMI_LIVE_LOCAL_BASE_URL to run local qwen3 voice asset lifecycle live smoke")
	}
	modelID := qualifyLocalSpeechLiveModelID(liveEnvFirst(
		"NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID",
		"NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID",
		"NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID",
		"NIMI_LIVE_LOCAL_TTS_MODEL_ID",
	))
	if modelID == "" {
		t.Skip("set NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID or NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID to run local qwen3 voice asset lifecycle live smoke")
	}
	if !isAdmittedLocalQwen3WorkflowModelID(modelID) {
		t.Skip("local qwen3 voice asset lifecycle smoke only accepts admitted qwen3 family model ids")
	}
	apiKey := firstNonEmptyString(
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_SPEECH_API_KEY")),
		strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY")),
	)
	runLocalSpeechHostPreflight(t, baseURL, apiKey, modelID)

	record, ok := providerregistry.Lookup("local")
	if !ok || !record.SupportsVoiceDesign || !record.SupportsTTS {
		t.Skip("local provider does not advertise required qwen3 speech workflow capabilities")
	}

	t.Setenv("NIMI_LIVE_LOCAL_BASE_URL", baseURL)
	svc := newLiveSmokeServiceForProvider(t, "local", record)
	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         liveSmokeMatrixAppID,
			SubjectUserId: liveSmokeMatrixUserID,
			ModelId:       modelID,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceDesign{VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
				TargetModelId: modelID,
				Input:         &runtimev1.VoiceT2VInput{InstructionText: liveSmokeVoiceDesignInstruction},
			}},
		},
	})
	if err != nil {
		t.Fatalf("submit local qwen3 voice design for asset lifecycle failed: %v", err)
	}
	if submitResp.GetAsset() == nil || strings.TrimSpace(submitResp.GetAsset().GetVoiceAssetId()) == "" {
		t.Fatalf("voice design must return voice asset")
	}

	job := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("voice design asset lifecycle seed job status not completed: %s reason=%s detail=%s", job.GetStatus().String(), job.GetReasonCode().String(), job.GetReasonDetail())
	}

	voiceAssetID := strings.TrimSpace(submitResp.GetAsset().GetVoiceAssetId())
	assetResp, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: voiceAssetID})
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
	if got := strings.TrimSpace(asset.GetProviderVoiceRef()); got == "" {
		t.Fatalf("voice asset %s missing provider_voice_ref", voiceAssetID)
	}
	if got := strings.TrimSpace(asset.GetMetadata().GetFields()["workflow_family"].GetStringValue()); got != "qwen3_tts" {
		t.Fatalf("workflow_family=%q, want qwen3_tts", got)
	}
	if got := strings.TrimSpace(asset.GetMetadata().GetFields()["voice_handle_policy_delete_semantics"].GetStringValue()); got != "runtime_authoritative_delete" {
		t.Fatalf("voice_handle_policy_delete_semantics=%q, want runtime_authoritative_delete", got)
	}

	listResp, err := svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{
		AppId:         liveSmokeMatrixAppID,
		SubjectUserId: liveSmokeMatrixUserID,
		PageSize:      20,
	})
	if err != nil {
		t.Fatalf("ListVoiceAssets: %v", err)
	}
	found := false
	for _, candidate := range listResp.GetAssets() {
		if strings.TrimSpace(candidate.GetVoiceAssetId()) == voiceAssetID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("ListVoiceAssets missing created voice asset %s", voiceAssetID)
	}

	synthResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         liveSmokeMatrixAppID,
			SubjectUserId: liveSmokeMatrixUserID,
			ModelId:       modelID,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "Hello from Nimi live voice asset lifecycle smoke.",
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
		t.Fatalf("submit local qwen3 synth via voice asset failed: %v", err)
	}
	synthJob := waitLiveSmokeScenarioJob(t, svc, synthResp.GetJob().GetJobId())
	if synthJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
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

	deleteResp, err := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: voiceAssetID})
	if err != nil {
		t.Fatalf("DeleteVoiceAsset(%s): %v", voiceAssetID, err)
	}
	if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
		t.Fatalf("DeleteVoiceAsset(%s) ack must be ok", voiceAssetID)
	}

	deletedResp, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: voiceAssetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(after delete %s): %v", voiceAssetID, err)
	}
	if deletedResp.GetAsset() == nil || deletedResp.GetAsset().GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		t.Fatalf("voice asset status after delete=%v, want DELETED", deletedResp.GetAsset().GetStatus())
	}

	failedSynthResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         liveSmokeMatrixAppID,
			SubjectUserId: liveSmokeMatrixUserID,
			ModelId:       modelID,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "This synth must fail after delete.",
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
		t.Fatalf("submit local qwen3 synth after delete failed: %v", err)
	}
	failedJob := waitLiveSmokeScenarioJob(t, svc, failedSynthResp.GetJob().GetJobId())
	if failedJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("expected failed synth job after delete, got status=%s", failedJob.GetStatus().String())
	}
	if failedJob.GetReasonCode() != runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND {
		t.Fatalf("expected AI_VOICE_ASSET_NOT_FOUND after delete, got %s", failedJob.GetReasonCode().String())
	}
}

func runLiveSmokeVoiceWorkflowForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord, scenarioType runtimev1.ScenarioType) {
	t.Helper()
	svc := newLiveSmokeServiceForProvider(t, providerID, record)
	token := liveProviderEnvToken(providerID)

	var modelKey string
	var fallbackModelKey string
	if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE {
		modelKey = "VOICE_CLONE_MODEL_ID"
		fallbackModelKey = "TTS_MODEL_ID"
	} else {
		modelKey = "VOICE_DESIGN_MODEL_ID"
		fallbackModelKey = "TTS_MODEL_ID"
	}
	modelID := qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, modelKey, fallbackModelKey))
	targetModelID := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + token + "_" + modelKey + "_TARGET_MODEL_ID"))
	if targetModelID == "" {
		targetModelID = modelID
	}

	spec := &runtimev1.ScenarioSpec{}
	if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE {
		spec.Spec = &runtimev1.ScenarioSpec_VoiceClone{VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
			TargetModelId: targetModelID,
			Input:         resolveLiveVoiceCloneInput(t, token),
		}}
	} else {
		spec.Spec = &runtimev1.ScenarioSpec_VoiceDesign{VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
			TargetModelId: targetModelID,
			Input:         &runtimev1.VoiceT2VInput{InstructionText: liveSmokeVoiceDesignInstruction},
		}}
	}
	maybeSkipFishAudioBalancePreflight(t, svc, providerID, modelID)

	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         liveSmokeMatrixAppID,
			SubjectUserId: liveSmokeMatrixUserID,
			ModelId:       modelID,
			RoutePolicy:   routePolicyForProvider(providerID),
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
		},
		ScenarioType:  scenarioType,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec:          spec,
	})
	if err != nil {
		maybeSkipFishAudioBalanceBlocked(t, providerID, err, "")
		maybeSkipStepFunQuotaBlocked(t, providerID, err, "")
		t.Fatalf("submit voice workflow failed: %v", err)
	}
	if submitResp.GetAsset() == nil || strings.TrimSpace(submitResp.GetAsset().GetVoiceAssetId()) == "" {
		t.Fatalf("voice workflow must return voice asset")
	}
	voiceAssetID := strings.TrimSpace(submitResp.GetAsset().GetVoiceAssetId())
	defer func() {
		deleteResp, deleteErr := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: voiceAssetID})
		if deleteErr != nil {
			t.Errorf("DeleteVoiceAsset(%s): %v", voiceAssetID, deleteErr)
			return
		}
		if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
			t.Errorf("DeleteVoiceAsset(%s) ack must be ok", voiceAssetID)
		}
	}()
	job := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		maybeSkipFishAudioBalanceBlocked(t, providerID, errors.New(job.GetReasonDetail()), job.GetReasonDetail())
		maybeSkipStepFunQuotaBlocked(t, providerID, errors.New(job.GetReasonDetail()), job.GetReasonDetail())
		t.Fatalf("voice workflow job status not completed: %s reason=%s detail=%s", job.GetStatus().String(), job.GetReasonCode().String(), job.GetReasonDetail())
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
