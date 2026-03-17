package ai

import (
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

const (
	adapterOpenAICompat        = "openai_compat_adapter"
	adapterLlamaNative         = "llama_native_adapter"
	adapterMediaNative         = "media_native_adapter"
	adapterMediaDiffusers      = "media_diffusers_adapter"
	adapterBytedanceOpenSpeech = "bytedance_openspeech_adapter"
	adapterBytedanceARKTask    = "bytedance_ark_task_adapter"
	adapterAlibabaNative       = "alibaba_native_adapter"
	adapterGeminiOperation     = "gemini_operation_adapter"
	adapterGeminiChatSTT       = "gemini_chat_transcribe_adapter"
	adapterDashScopeChatSTT    = "dashscope_chat_transcribe_adapter"
	adapterMiniMaxTask         = "minimax_task_adapter"
	adapterGLMTask             = "glm_task_adapter"
	adapterGLMNative           = "glm_native_adapter"
	adapterKimiChatMultimodal  = "kimi_chat_multimodal_adapter"
	adapterElevenLabsNative    = "elevenlabs_native_adapter"
	adapterFishAudioNative     = "fish_audio_native_adapter"
	adapterAWSPollyNative      = "aws_polly_native_adapter"
	adapterAzureSpeechNative   = "azure_speech_native_adapter"
	adapterGoogleCloudTTS      = "google_cloud_tts_adapter"
	adapterFluxNative          = "flux_native_adapter"
	adapterIdeogramNative      = "ideogram_native_adapter"
	adapterStabilityNative     = "stability_native_adapter"
	adapterKlingTask           = "kling_task_adapter"
	adapterLumaTask            = "luma_task_adapter"
	adapterPikaTask            = "pika_task_adapter"
	adapterRunwayTask          = "runway_task_adapter"
	adapterGoogleVeoOperation  = "google_veo_operation_adapter"
	adapterStepFunNative       = "stepfun_native_adapter"
	adapterSunoNative          = "suno_native_adapter"
	adapterStabilityMusic      = "stability_music_adapter"
	adapterSoundverseMusic     = "soundverse_music_adapter"
	adapterMubertMusic         = "mubert_music_adapter"
	adapterLoudlyMusic         = "loudly_music_adapter"
	adapterSidecarMusic        = "sidecar_music_adapter"
)

type mediaAdapterStrategy struct {
	Image string
	Video string
	TTS   string
	STT   string
	Music string
}

func (s mediaAdapterStrategy) forModal(modal runtimev1.Modal) string {
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE:
		return strings.TrimSpace(s.Image)
	case runtimev1.Modal_MODAL_VIDEO:
		return strings.TrimSpace(s.Video)
	case runtimev1.Modal_MODAL_TTS:
		return strings.TrimSpace(s.TTS)
	case runtimev1.Modal_MODAL_STT:
		return strings.TrimSpace(s.STT)
	case runtimev1.Modal_MODAL_MUSIC:
		return strings.TrimSpace(s.Music)
	default:
		return ""
	}
}

var mediaAdapterStrategiesByProvider = map[string]mediaAdapterStrategy{
	"llama": {
		STT: adapterLlamaNative,
	},
	"media": {
		Image: adapterMediaNative,
		Video: adapterMediaNative,
	},
	"media.diffusers": {
		Image: adapterMediaDiffusers,
		Video: adapterMediaDiffusers,
	},
	"sidecar": {
		Music: adapterSidecarMusic,
	},
	"volcengine_openspeech": {
		TTS: adapterBytedanceOpenSpeech,
		STT: adapterBytedanceOpenSpeech,
	},
	"volcengine": {
		Image: adapterBytedanceARKTask,
		Video: adapterBytedanceARKTask,
	},
	"dashscope": {
		Image: adapterAlibabaNative,
		Video: adapterAlibabaNative,
		TTS:   adapterAlibabaNative,
		STT:   adapterDashScopeChatSTT,
	},
	"gemini": {
		Image: adapterGeminiOperation,
		Video: adapterGeminiOperation,
		TTS:   adapterGeminiOperation,
		STT:   adapterGeminiChatSTT,
	},
	"minimax": {
		Image: adapterMiniMaxTask,
		Video: adapterMiniMaxTask,
		TTS:   adapterMiniMaxTask,
		STT:   adapterMiniMaxTask,
	},
	"glm": {
		Image: adapterGLMNative,
		Video: adapterGLMTask,
		TTS:   adapterGLMNative,
		STT:   adapterGLMNative,
	},
	"kimi": {
		Image: adapterKimiChatMultimodal,
	},
	"elevenlabs": {
		TTS: adapterElevenLabsNative,
	},
	"fish_audio": {
		TTS: adapterFishAudioNative,
	},
	"aws_polly": {
		TTS: adapterAWSPollyNative,
	},
	"azure_speech": {
		TTS: adapterAzureSpeechNative,
	},
	"google_cloud_tts": {
		TTS: adapterGoogleCloudTTS,
	},
	"flux": {
		Image: adapterFluxNative,
	},
	"ideogram": {
		Image: adapterIdeogramNative,
	},
	"stability": {
		Image: adapterStabilityNative,
		Music: adapterStabilityMusic,
	},
	"kling": {
		Image: adapterKlingTask,
		Video: adapterKlingTask,
	},
	"luma": {
		Video: adapterLumaTask,
	},
	"pika": {
		Video: adapterPikaTask,
	},
	"runway": {
		Video: adapterRunwayTask,
	},
	"google_veo": {
		Video: adapterGoogleVeoOperation,
	},
	"stepfun": {
		Image: adapterStepFunNative,
		TTS:   adapterStepFunNative,
	},
	"suno": {
		Music: adapterSunoNative,
	},
	"soundverse": {
		Music: adapterSoundverseMusic,
	},
	"mubert": {
		Music: adapterMubertMusic,
	},
	"loudly": {
		Music: adapterLoudlyMusic,
	},
}

func scenarioModalFromType(scenarioType runtimev1.ScenarioType) runtimev1.Modal {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return runtimev1.Modal_MODAL_IMAGE
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return runtimev1.Modal_MODAL_VIDEO
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return runtimev1.Modal_MODAL_TTS
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return runtimev1.Modal_MODAL_STT
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return runtimev1.Modal_MODAL_MUSIC
	default:
		return runtimev1.Modal_MODAL_UNSPECIFIED
	}
}

func findProbeModelID(models []nimillm.ProbeModel, targetModelID string) (string, bool) {
	targetComparable := normalizeComparableModelID(targetModelID)
	targetBase := modelIDBase(targetModelID)
	for _, model := range models {
		id := strings.TrimSpace(model.ModelID)
		if id == "" {
			continue
		}
		if normalizeComparableModelID(id) == targetComparable {
			return id, true
		}
		if modelIDBase(id) == targetBase {
			return id, true
		}
	}
	return "", false
}

func resolveConnectorTTSModelID(
	models []nimillm.ProbeModel,
	targetModelID string,
	providerType string,
	voiceCatalog *catalog.Resolver,
) (string, bool) {
	if resolved, ok := findProbeModelID(models, targetModelID); ok {
		return resolved, true
	}
	target := strings.TrimSpace(targetModelID)
	if target == "" || voiceCatalog == nil {
		return "", false
	}
	if _, _, _, err := resolveSpeechVoicesForModelWithProviderType(target, strings.TrimSpace(providerType), voiceCatalog); err == nil {
		return target, true
	}
	return "", false
}

func normalizeComparableModelID(value string) string {
	comparable := strings.ToLower(strings.TrimSpace(value))
	comparable = strings.TrimPrefix(comparable, "models/")
	comparable = strings.TrimPrefix(comparable, "model/")
	return comparable
}

func modelIDBase(value string) string {
	trimmed := strings.TrimSpace(value)
	if idx := strings.Index(trimmed, "@"); idx > 0 {
		return strings.ToLower(strings.TrimSpace(trimmed[:idx]))
	}
	return strings.ToLower(trimmed)
}

func supportsTTSCapability(capabilities []string) bool {
	for _, capability := range capabilities {
		if aicapabilities.NormalizeCatalogCapability(capability) == aicapabilities.AudioSynthesize {
			return true
		}
	}
	return false
}

func resolveMediaAdapterName(modelID string, modelResolved string, modal runtimev1.Modal, providerType string) string {
	resolvedLower := strings.ToLower(strings.TrimSpace(modelResolved))
	providerLower := strings.ToLower(strings.TrimSpace(providerType))
	lowerModel := strings.ToLower(strings.TrimSpace(modelID))
	if providerLower == "" {
		if idx := strings.Index(resolvedLower, "/"); idx > 0 {
			candidate := strings.TrimSpace(resolvedLower[:idx])
			if providerregistry.Contains(candidate) {
				providerLower = candidate
			}
		}
	}

	switch {
	case strings.HasPrefix(lowerModel, "llama/"):
		if adapter := mediaAdapterStrategiesByProvider["llama"].forModal(modal); adapter != "" {
			return adapter
		}
		return ""
	case strings.HasPrefix(lowerModel, "media.diffusers/"):
		if adapter := mediaAdapterStrategiesByProvider["media.diffusers"].forModal(modal); adapter != "" {
			return adapter
		}
		return ""
	case strings.HasPrefix(lowerModel, "media/"):
		if adapter := mediaAdapterStrategiesByProvider["media"].forModal(modal); adapter != "" {
			return adapter
		}
		return ""
	}

	if strategy, ok := mediaAdapterStrategiesByProvider[providerLower]; ok {
		if adapter := strategy.forModal(modal); adapter != "" {
			return adapter
		}
	}
	if localrouting.IsKnownProvider(providerLower) {
		return ""
	}
	if strings.HasPrefix(lowerModel, "gemini-") || strings.HasPrefix(resolvedLower, "gemini-") {
		if strategy, ok := mediaAdapterStrategiesByProvider["gemini"]; ok {
			if adapter := strategy.forModal(modal); adapter != "" {
				return adapter
			}
		}
	}
	if providerLower != "" {
		if record, ok := providerregistry.Lookup(providerLower); ok {
			if mediaScenarioSupportedByProviderRecord(record, modal) {
				return adapterOpenAICompat
			}
		}
	}

	if modal == runtimev1.Modal_MODAL_VIDEO && strings.Contains(resolvedLower, "glm") {
		return adapterGLMTask
	}
	if modal == runtimev1.Modal_MODAL_IMAGE && strings.Contains(resolvedLower, "kimi") {
		return adapterKimiChatMultimodal
	}
	return adapterOpenAICompat
}

func mediaScenarioSupportedByProviderRecord(record providerregistry.ProviderRecord, modal runtimev1.Modal) bool {
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE:
		return record.SupportsImage
	case runtimev1.Modal_MODAL_VIDEO:
		return record.SupportsVideo
	case runtimev1.Modal_MODAL_TTS:
		return record.SupportsTTS
	case runtimev1.Modal_MODAL_STT:
		return record.SupportsSTT
	case runtimev1.Modal_MODAL_MUSIC:
		return record.SupportsMusic
	default:
		return false
	}
}

func inferMediaProviderTypeFromSelectedBackend(selectedProvider provider, modelResolved string, modal runtimev1.Modal) string {
	if cloud, ok := selectedProvider.(*nimillm.CloudProvider); ok && cloud != nil {
		if backend, _, _, _ := cloud.PickBackend(modelResolved); backend != nil {
			return inferMediaProviderTypeFromBackendName(backend)
		}
	}
	if modalProvider, ok := selectedProvider.(localModalMediaProvider); ok && modalProvider != nil {
		if _, _, providerType := modalProvider.resolveMediaBackendForModal(modelResolved, modal); providerType != "" {
			return providerType
		}
	}
	if backendProvider, ok := selectedProvider.(nimillm.MediaBackendProvider); ok && backendProvider != nil {
		if backend, _ := backendProvider.ResolveMediaBackend(modelResolved); backend != nil {
			return inferMediaProviderTypeFromBackendName(backend)
		}
	}
	return ""
}

func inferMediaProviderTypeFromBackendName(backend *nimillm.Backend) string {
	if backend == nil {
		return ""
	}
	name := strings.ToLower(strings.TrimSpace(backend.Name))
	switch {
	case strings.HasPrefix(name, "local-"):
		return strings.TrimSpace(strings.TrimPrefix(name, "local-"))
	case strings.HasPrefix(name, "cloud-"):
		return strings.TrimSpace(strings.TrimPrefix(name, "cloud-"))
	default:
		return ""
	}
}

func stringSliceToAny(values []string) []any {
	if len(values) == 0 {
		return nil
	}
	output := make([]any, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		output = append(output, trimmed)
	}
	if len(output) == 0 {
		return nil
	}
	return output
}

// resolveNativeAdapterConfig returns adapter credentials from remoteTarget when
// available (connector path), falling back to the config-based cloud provider entry.
func (s *Service) resolveNativeAdapterConfig(configKey string, remoteTarget *nimillm.RemoteTarget) nimillm.MediaAdapterConfig {
	if remoteTarget != nil && remoteTarget.APIKey != "" {
		return nimillm.MediaAdapterConfig{BaseURL: remoteTarget.Endpoint, APIKey: remoteTarget.APIKey}
	}
	creds := s.config.CloudProviders[configKey]
	return nimillm.MediaAdapterConfig{BaseURL: creds.BaseURL, APIKey: creds.APIKey, Headers: creds.Headers}
}

func reasonCodeFromMediaError(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	if reasonCode, ok := grpcerr.ExtractReasonCode(err); ok {
		return reasonCode
	}
	st, ok := status.FromError(err)
	if !ok {
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	if value, exists := runtimev1.ReasonCode_value[strings.TrimSpace(st.Message())]; exists {
		return runtimev1.ReasonCode(value)
	}
	switch st.Code() {
	case codes.Canceled:
		return runtimev1.ReasonCode_ACTION_EXECUTED
	case codes.DeadlineExceeded:
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case codes.ResourceExhausted:
		return runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED
	case codes.NotFound:
		return runtimev1.ReasonCode_AI_MODEL_NOT_FOUND
	case codes.FailedPrecondition:
		return runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED
	case codes.InvalidArgument:
		return runtimev1.ReasonCode_AI_INPUT_INVALID
	default:
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
}

func resolveScenarioVoiceRef(spec *runtimev1.SpeechSynthesizeScenarioSpec) string {
	if spec == nil || spec.GetVoiceRef() == nil {
		return ""
	}
	ref := spec.GetVoiceRef()
	switch ref.GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		return strings.TrimSpace(ref.GetProviderVoiceRef())
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		return strings.TrimSpace(ref.GetPresetVoiceId())
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		return strings.TrimSpace(ref.GetVoiceAssetId())
	default:
		return ""
	}
}

func (s *Service) UpdatePollState(
	jobID string,
	providerJobID string,
	retryCount int32,
	nextPollAt *timestamppb.Timestamp,
	lastError string,
) {
	if _, ok := s.scenarioJobs.transition(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED,
		func(job *runtimev1.ScenarioJob) {
			job.ProviderJobId = strings.TrimSpace(providerJobID)
			job.RetryCount = retryCount
			job.NextPollAt = nextPollAt
			job.ReasonDetail = strings.TrimSpace(lastError)
		},
	); !ok {
		s.logger.Warn("scenario job poll state update failed", "job_id", jobID)
	}
}
