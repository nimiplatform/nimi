package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

const liveSmokeMatrixAppID = "nimi.live-smoke.matrix"
const liveSmokeMatrixUserID = "smoke-user"
const liveSmokeVoiceDesignInstruction = "Warm, calm, natural narrator voice with steady pacing, clear diction, low background noise, gentle emotional range, and a polished studio delivery for long-form spoken content."
const liveSmokeVoiceCloneText = "Hello from Nimi live voice clone."

func TestLiveSmokeProviderCapabilityMatrix(t *testing.T) {
	for _, providerID := range providerregistry.SourceProviders {
		providerID := providerID
		record, ok := providerregistry.Lookup(providerID)
		if !ok {
			continue
		}
		t.Run(providerID, func(t *testing.T) {
			if record.SupportsText {
				t.Run("generate", func(t *testing.T) { runLiveSmokeGenerateForProvider(t, providerID, record) })
			}
			if record.SupportsEmbed {
				t.Run("embed", func(t *testing.T) { runLiveSmokeEmbedForProvider(t, providerID, record) })
			}
			if record.SupportsImage {
				t.Run("image", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE)
				})
			}
			if record.SupportsVideo {
				t.Run("video", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE)
				})
			}
			if record.SupportsTTS {
				t.Run("tts", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE)
				})
			}
			if record.SupportsSTT {
				t.Run("stt", func(t *testing.T) {
					runLiveSmokeMediaForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE)
				})
			}
			if record.SupportsTTSV2V {
				t.Run("voice_clone", func(t *testing.T) {
					runLiveSmokeVoiceWorkflowForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE)
				})
			}
			if record.SupportsTTST2V {
				t.Run("voice_design", func(t *testing.T) {
					runLiveSmokeVoiceWorkflowForProvider(t, providerID, record, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN)
				})
			}
		})
	}
}

func liveProviderEnvToken(providerID string) string {
	token := strings.TrimSpace(strings.ToUpper(providerID))
	token = strings.ReplaceAll(token, "-", "_")
	token = strings.ReplaceAll(token, ".", "_")
	token = strings.ReplaceAll(token, " ", "_")
	for strings.Contains(token, "__") {
		token = strings.ReplaceAll(token, "__", "_")
	}
	return strings.Trim(token, "_")
}

func newLiveSmokeServiceForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) *Service {
	t.Helper()
	if providerID == "local" {
		baseURL := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_BASE_URL")
		apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY"))
		return newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
			LocalProviders: map[string]nimillm.ProviderCredentials{
				"localai": {BaseURL: baseURL, APIKey: apiKey},
				"nexa":    {BaseURL: baseURL, APIKey: apiKey},
			},
		})
	}

	envToken := liveProviderEnvToken(providerID)
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_"+envToken+"_BASE_URL", record.DefaultEndpoint)
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_"+envToken+"_API_KEY")
	return newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			providerID: {BaseURL: baseURL, APIKey: apiKey},
		},
	})
}

func routePolicyForProvider(providerID string) runtimev1.RoutePolicy {
	if providerID == "local" {
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	}
	return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
}

func qualifyLiveModelIDForRoute(providerID string, modelID string) string {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" || providerID == "local" {
		return modelID
	}
	lower := strings.ToLower(modelID)
	if strings.HasPrefix(lower, "cloud/") || strings.HasPrefix(lower, "token/") || strings.Contains(modelID, "/") {
		return modelID
	}
	return "cloud/" + modelID
}

func resolveLiveTTSVoiceRef(t *testing.T, svc *Service, providerID string, modelID string) string {
	t.Helper()
	if svc == nil || svc.speechCatalog == nil {
		return ""
	}
	voices, _, _, err := resolveSpeechVoicesForModelWithProviderType(modelID, providerID, svc.speechCatalog)
	if err != nil || len(voices) == 0 {
		return ""
	}
	if strings.EqualFold(strings.TrimSpace(providerID), "dashscope") {
		return strings.TrimSpace(voices[0].GetName())
	}
	return strings.TrimSpace(voices[0].GetVoiceId())
}

func envModelIDForProvider(t *testing.T, providerID string, capabilitySuffix string, fallbackSuffix string) string {
	t.Helper()
	token := liveProviderEnvToken(providerID)
	primaryKey := "NIMI_LIVE_" + token + "_" + capabilitySuffix
	primary := strings.TrimSpace(os.Getenv(primaryKey))
	if primary != "" {
		return primary
	}
	if fallbackSuffix == "" {
		return requiredLiveEnv(t, primaryKey)
	}
	fallbackKey := "NIMI_LIVE_" + token + "_" + fallbackSuffix
	fallback := strings.TrimSpace(os.Getenv(fallbackKey))
	if fallback != "" {
		return fallback
	}
	return requiredLiveEnv(t, primaryKey)
}

func liveEnvFirst(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func resolveLiveAudioMIME(resource string) string {
	lower := strings.ToLower(strings.TrimSpace(resource))
	switch {
	case strings.HasSuffix(lower, ".mp3"):
		return "audio/mpeg"
	case strings.HasSuffix(lower, ".m4a"):
		return "audio/mp4"
	case strings.HasSuffix(lower, ".ogg"):
		return "audio/ogg"
	default:
		return "audio/wav"
	}
}

func resolveLiveTranscriptionAudioSource(t *testing.T) (*runtimev1.SpeechTranscriptionAudioSource, string) {
	t.Helper()
	if audioPath := liveEnvFirst("NIMI_LIVE_STT_AUDIO_PATH"); audioPath != "" {
		audioBytes, err := os.ReadFile(audioPath)
		if err != nil {
			t.Fatalf("read stt live audio path %s: %v", audioPath, err)
		}
		if len(audioBytes) == 0 {
			t.Fatalf("stt live audio path %s is empty", audioPath)
		}
		return &runtimev1.SpeechTranscriptionAudioSource{
			Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: audioBytes},
		}, resolveLiveAudioMIME(audioPath)
	}

	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	return &runtimev1.SpeechTranscriptionAudioSource{
		Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
	}, resolveLiveAudioMIME(audioURI)
}

func resolveLiveVoiceCloneInput(t *testing.T, providerToken string) *runtimev1.VoiceV2VInput {
	t.Helper()
	liveText := resolveLiveVoiceCloneText(providerToken)
	audioPath := liveEnvFirst(
		"NIMI_LIVE_"+providerToken+"_VOICE_REFERENCE_AUDIO_PATH",
		"NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH",
	)
	if audioPath != "" {
		audioBytes, err := os.ReadFile(audioPath)
		if err != nil {
			t.Fatalf("read voice clone live audio path %s: %v", audioPath, err)
		}
		if len(audioBytes) == 0 {
			t.Fatalf("voice clone live audio path %s is empty", audioPath)
		}
		return &runtimev1.VoiceV2VInput{
			ReferenceAudioBytes: audioBytes,
			ReferenceAudioMime:  resolveLiveAudioMIME(audioPath),
			Text:                liveText,
		}
	}

	audioURI := liveEnvFirst(
		"NIMI_LIVE_"+providerToken+"_VOICE_REFERENCE_AUDIO_URI",
		"NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI",
	)
	if audioURI == "" {
		audioURI = requiredLiveEnv(t, "NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI")
	}
	return &runtimev1.VoiceV2VInput{
		ReferenceAudioUri:  audioURI,
		ReferenceAudioMime: resolveLiveAudioMIME(audioURI),
		Text:               liveText,
	}
}

func resolveLiveVoiceCloneText(providerToken string) string {
	text := liveEnvFirst(
		"NIMI_LIVE_"+providerToken+"_VOICE_CLONE_TEXT",
		"NIMI_LIVE_VOICE_CLONE_TEXT",
	)
	if text != "" {
		return text
	}
	if strings.EqualFold(strings.TrimSpace(providerToken), "STEPFUN") {
		return liveSmokeVoiceCloneText
	}
	return ""
}

func maybeSkipFishAudioBalanceBlocked(t *testing.T, providerID string, err error, detail string) {
	t.Helper()
	if !strings.EqualFold(strings.TrimSpace(providerID), "fish_audio") {
		return
	}
	message := strings.ToLower(strings.TrimSpace(detail))
	if err != nil {
		message = strings.TrimSpace(message + " " + strings.ToLower(err.Error()))
	}
	if strings.Contains(message, "insufficient balance") || strings.Contains(message, "insufficient credits") {
		if err != nil {
			t.Skipf("fish_audio live smoke skipped due to provider balance block: %v", err)
		}
		t.Skipf("fish_audio live smoke skipped due to provider balance block: %s", strings.TrimSpace(detail))
	}
}

func maybeSkipStepFunQuotaBlocked(t *testing.T, providerID string, err error, detail string) {
	t.Helper()
	if !strings.EqualFold(strings.TrimSpace(providerID), "stepfun") {
		return
	}
	message := strings.ToLower(strings.TrimSpace(detail))
	if err != nil {
		message = strings.TrimSpace(message + " " + strings.ToLower(err.Error()))
	}
	// 'stepfun' live smoke treats quota and rate-limit responses as skip-worthy provider blocks.
	if strings.Contains(message, "quota_exceeded") ||
		strings.Contains(message, "exceeded your current quota") ||
		strings.Contains(message, "billing details") ||
		strings.Contains(message, "insufficient balance") ||
		strings.Contains(message, "available balance") ||
		strings.Contains(message, "resourceexhausted") ||
		strings.Contains(message, "resource exhausted") ||
		strings.Contains(message, "ai_provider_rate_limited") ||
		strings.Contains(message, "replenish_provider_balance_or_skip_live_test") {
		if err != nil {
			t.Skipf("stepfun live smoke skipped due to provider quota block: %v", err)
		}
		t.Skipf("stepfun live smoke skipped due to provider quota block: %s", strings.TrimSpace(detail))
	}
}

func maybeSkipFishAudioBalancePreflight(t *testing.T, svc *Service, providerID string, modelID string) {
	t.Helper()
	if !strings.EqualFold(strings.TrimSpace(providerID), "fish_audio") || svc == nil {
		return
	}

	cfg := svc.resolveNativeAdapterConfig("fish_audio", nil)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.fish.audio"
	}
	voiceRef := resolveLiveTTSVoiceRef(t, svc, providerID, modelID)
	if voiceRef == "" {
		return
	}

	payload := map[string]any{
		"text":         "Nimi Fish Audio balance preflight.",
		"reference_id": voiceRef,
	}
	requestBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal fish_audio preflight payload: %v", err)
	}
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, baseURL+"/v1/tts", bytes.NewReader(requestBody))
	if err != nil {
		t.Fatalf("build fish_audio preflight request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("model", strings.TrimSpace(strings.TrimPrefix(modelID, "cloud/")))
	if strings.TrimSpace(cfg.APIKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusPaymentRequired {
		return
	}
	var responsePayload map[string]any
	_ = json.NewDecoder(response.Body).Decode(&responsePayload)
	message := strings.ToLower(strings.TrimSpace(nimillm.ProviderErrorMessage(responsePayload)))
	if strings.Contains(message, "insufficient balance") || strings.Contains(message, "insufficient credits") {
		t.Skipf("fish_audio live smoke skipped due to provider balance block: %s", strings.TrimSpace(nimillm.ProviderErrorMessage(responsePayload)))
	}
}

func runLiveSmokeGenerateForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) {
	t.Helper()
	svc := newLiveSmokeServiceForProvider(t, providerID, record)
	modelID := qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "MODEL_ID", ""))
	text, err := executeLiveSmokeScenarioGenerateText(svc, modelID, routePolicyForProvider(providerID))
	if err != nil {
		maybeSkipStepFunQuotaBlocked(t, providerID, err, "")
		t.Fatalf("live generate failed: %v", err)
	}
	if strings.TrimSpace(text) == "" {
		t.Fatalf("live generate returned empty output")
	}
}

func runLiveSmokeEmbedForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) {
	t.Helper()
	svc := newLiveSmokeServiceForProvider(t, providerID, record)
	modelID := qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "EMBED_MODEL_ID", "MODEL_ID"))

	resp, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         liveSmokeMatrixAppID,
			SubjectUserId: liveSmokeMatrixUserID,
			ModelId:       modelID,
			RoutePolicy:   routePolicyForProvider(providerID),
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     45_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextEmbed{
				TextEmbed: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"Nimi live smoke embed probe."}},
			},
		},
	})
	if err != nil {
		t.Fatalf("live embed failed: %v", err)
	}
	vectors := resp.GetOutput().GetFields()["vectors"].GetListValue().GetValues()
	if len(vectors) == 0 {
		t.Fatalf("live embed returned empty vectors")
	}
}

func runLiveSmokeMediaForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord, scenarioType runtimev1.ScenarioType) {
	t.Helper()
	svc := newLiveSmokeServiceForProvider(t, providerID, record)

	modelID := ""
	spec := &runtimev1.ScenarioSpec{}
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		modelID = qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "IMAGE_MODEL_ID", "MODEL_ID"))
		spec.Spec = &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A tiny planet above the sea."}}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		modelID = qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "VIDEO_MODEL_ID", "MODEL_ID"))
		spec.Spec = &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
			Mode:    runtimev1.VideoMode_VIDEO_MODE_T2V,
			Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A short cinematic scene of sunrise."}},
			Options: &runtimev1.VideoGenerationOptions{DurationSec: 1},
		}}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		modelID = qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "TTS_MODEL_ID", "MODEL_ID"))
		speechSpec := &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello from Nimi live smoke."}
		if voiceRef := resolveLiveTTSVoiceRef(t, svc, providerID, modelID); voiceRef != "" {
			speechSpec.VoiceRef = &runtimev1.VoiceReference{
				Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET,
				Reference: &runtimev1.VoiceReference_PresetVoiceId{
					PresetVoiceId: voiceRef,
				},
			}
		}
		spec.Spec = &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: speechSpec}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		modelID = qualifyLiveModelIDForRoute(providerID, envModelIDForProvider(t, providerID, "STT_MODEL_ID", "MODEL_ID"))
		audioSource, mimeType := resolveLiveTranscriptionAudioSource(t)
		spec.Spec = &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			MimeType:    mimeType,
			AudioSource: audioSource,
		}}
	default:
		t.Fatalf("unsupported media scenario type: %v", scenarioType)
	}
	if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		maybeSkipFishAudioBalancePreflight(t, svc, providerID, modelID)
	}

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
		t.Fatalf("submit scenario job failed: %v", err)
	}
	job := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		maybeSkipFishAudioBalanceBlocked(t, providerID, errors.New(job.GetReasonDetail()), job.GetReasonDetail())
		maybeSkipStepFunQuotaBlocked(t, providerID, errors.New(job.GetReasonDetail()), job.GetReasonDetail())
		t.Fatalf("scenario job status not completed: %s reason=%s detail=%s", job.GetStatus().String(), job.GetReasonCode().String(), job.GetReasonDetail())
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
	deadline := time.Now().Add(3 * time.Minute)
	for {
		resp, err := svc.GetScenarioJob(context.Background(), &runtimev1.GetScenarioJobRequest{JobId: jobID})
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
