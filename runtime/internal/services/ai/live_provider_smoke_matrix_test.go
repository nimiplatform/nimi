package ai

import (
	"context"
	"io"
	"log/slog"
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

func runLiveSmokeGenerateForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) {
	t.Helper()
	svc := newLiveSmokeServiceForProvider(t, providerID, record)
	modelID := envModelIDForProvider(t, providerID, "MODEL_ID", "")
	runLiveSmokeScenarioGenerateText(t, svc, modelID, routePolicyForProvider(providerID))
}

func runLiveSmokeEmbedForProvider(t *testing.T, providerID string, record providerregistry.ProviderRecord) {
	t.Helper()
	svc := newLiveSmokeServiceForProvider(t, providerID, record)
	modelID := envModelIDForProvider(t, providerID, "EMBED_MODEL_ID", "MODEL_ID")

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
		modelID = envModelIDForProvider(t, providerID, "IMAGE_MODEL_ID", "MODEL_ID")
		spec.Spec = &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A tiny planet above the sea."}}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		modelID = envModelIDForProvider(t, providerID, "VIDEO_MODEL_ID", "MODEL_ID")
		spec.Spec = &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
			Mode:    runtimev1.VideoMode_VIDEO_MODE_T2V,
			Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A short cinematic scene of sunrise."}},
			Options: &runtimev1.VideoGenerationOptions{DurationSec: 1},
		}}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		modelID = envModelIDForProvider(t, providerID, "TTS_MODEL_ID", "MODEL_ID")
		spec.Spec = &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello from Nimi live smoke."}}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		modelID = envModelIDForProvider(t, providerID, "STT_MODEL_ID", "MODEL_ID")
		audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
		spec.Spec = &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			MimeType: "audio/wav",
			AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
				Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
			},
		}}
	default:
		t.Fatalf("unsupported media scenario type: %v", scenarioType)
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
		t.Fatalf("submit scenario job failed: %v", err)
	}
	job := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
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
	modelID := envModelIDForProvider(t, providerID, modelKey, fallbackModelKey)
	targetModelID := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + token + "_" + modelKey + "_TARGET_MODEL_ID"))
	if targetModelID == "" {
		targetModelID = modelID
	}

	spec := &runtimev1.ScenarioSpec{}
	if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE {
		audioURI := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + token + "_VOICE_REFERENCE_AUDIO_URI"))
		if audioURI == "" {
			audioURI = requiredLiveEnv(t, "NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI")
		}
		spec.Spec = &runtimev1.ScenarioSpec_VoiceClone{VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
			TargetModelId: targetModelID,
			Input:         &runtimev1.VoiceV2VInput{ReferenceAudioUri: audioURI},
		}}
	} else {
		spec.Spec = &runtimev1.ScenarioSpec_VoiceDesign{VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
			TargetModelId: targetModelID,
			Input:         &runtimev1.VoiceT2VInput{InstructionText: "Warm, calm and natural voice."},
		}}
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
		t.Fatalf("submit voice workflow failed: %v", err)
	}
	if submitResp.GetAsset() == nil || strings.TrimSpace(submitResp.GetAsset().GetVoiceAssetId()) == "" {
		t.Fatalf("voice workflow must return voice asset")
	}
	job := waitLiveSmokeScenarioJob(t, svc, submitResp.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
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
