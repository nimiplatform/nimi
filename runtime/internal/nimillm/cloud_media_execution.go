package nimillm

import (
	"context"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

// MediaExecutionResult is the credential-free output of one exact media
// dialect invocation. Credential lifetime remains owned by the caller.
type MediaExecutionResult struct {
	Artifacts      []*runtimev1.ScenarioArtifact
	ArtifactBodies map[string]*MediaArtifactBody
	Usage          *runtimev1.UsageStats
	ProviderJobID  string
}

type MediaArtifactBody struct {
	Bytes  []byte
	Stream io.ReadCloser
}

// ExecuteMediaAdapter invokes one Driver-selected existing provider dialect.
// It performs no provider, model, route, or fallback selection.
func (p *CloudProvider) ExecuteMediaAdapter(
	ctx context.Context,
	adapter string,
	privateJobID string,
	request *runtimev1.SubmitScenarioJobRequest,
	modelID string,
	target *RemoteTarget,
	updater JobStateUpdater,
) (MediaExecutionResult, error) {
	if request == nil || request.GetSpec() == nil || target == nil || updater == nil {
		return MediaExecutionResult{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	cfg := MediaAdapterConfig{
		BaseURL:               target.Endpoint,
		APIKey:                target.APIKey,
		Headers:               cloneMediaHeaders(target.Headers),
		AllowLoopbackEndpoint: target.AllowLoopback,
	}
	var (
		artifacts     []*runtimev1.ScenarioArtifact
		usage         *runtimev1.UsageStats
		providerJobID string
		err           error
	)
	switch strings.TrimSpace(adapter) {
	case "bytedance_openspeech_adapter":
		artifacts, usage, providerJobID, err = ExecuteBytedanceOpenSpeech(ctx, cfg, request, modelID)
	case "bytedance_ark_task_adapter":
		artifacts, usage, providerJobID, err = ExecuteBytedanceARKTask(ctx, cfg, updater, privateJobID, request, modelID)
	case "alibaba_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteAlibabaNative(ctx, cfg, updater, privateJobID, request, modelID)
	case "gemini_operation_adapter":
		artifacts, usage, providerJobID, err = ExecuteGeminiOperation(ctx, cfg, updater, privateJobID, request, modelID, mediaExecutionExtensions)
	case "dashscope_chat_transcribe_adapter":
		artifacts, usage, providerJobID, err = ExecuteDashScopeTranscribe(ctx, cfg, request, modelID)
	case "gemini_chat_transcribe_adapter":
		artifacts, usage, providerJobID, err = ExecuteGeminiTranscribe(ctx, cfg, request, modelID)
	case "minimax_task_adapter":
		artifacts, usage, providerJobID, err = ExecuteMiniMaxTask(ctx, cfg, updater, privateJobID, request, modelID, mediaExecutionExtensions)
	case "glm_task_adapter":
		artifacts, usage, providerJobID, err = ExecuteGLMTask(ctx, cfg, updater, privateJobID, request, modelID, mediaExecutionExtensions)
	case "glm_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteGLMNative(ctx, cfg, request, modelID)
	case "kimi_chat_multimodal_adapter":
		artifacts, usage, providerJobID, err = ExecuteKimiImageChatMultimodal(ctx, cfg, request, modelID)
	case "elevenlabs_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteElevenLabsTTS(ctx, cfg, request, modelID)
	case "fish_audio_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteFishAudioTTS(ctx, cfg, request, modelID)
	case "aws_polly_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteAWSPollyTTS(ctx, cfg, request, modelID)
	case "azure_speech_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteAzureSpeechTTS(ctx, cfg, request, modelID)
	case "google_cloud_tts_adapter":
		artifacts, usage, providerJobID, err = ExecuteGoogleCloudTTS(ctx, cfg, request, modelID)
	case "flux_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteFluxImage(ctx, cfg, updater, privateJobID, request, modelID)
	case "ideogram_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteIdeogramImage(ctx, cfg, request, modelID)
	case "stability_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteStabilityImage(ctx, cfg, request, modelID)
	case "stability_music_adapter":
		artifacts, usage, providerJobID, err = ExecuteStabilityMusic(ctx, cfg, request, modelID)
	case "kling_task_adapter":
		artifacts, usage, providerJobID, err = ExecuteKlingTask(ctx, cfg, updater, privateJobID, request, modelID)
	case "luma_task_adapter":
		artifacts, usage, providerJobID, err = ExecuteLumaTask(ctx, cfg, updater, privateJobID, request, modelID)
	case "pika_task_adapter":
		artifacts, usage, providerJobID, err = ExecutePikaTask(ctx, cfg, updater, privateJobID, request, modelID)
	case "runway_task_adapter":
		artifacts, usage, providerJobID, err = ExecuteRunwayTask(ctx, cfg, updater, privateJobID, request, modelID)
	case "google_veo_operation_adapter":
		artifacts, usage, providerJobID, err = ExecuteGoogleVeoOperation(ctx, cfg, updater, privateJobID, request, modelID)
	case "stepfun_native_adapter":
		artifacts, usage, providerJobID, err = ExecuteStepFunMedia(ctx, cfg, request, modelID)
	case "soundverse_music_adapter":
		artifacts, usage, providerJobID, err = ExecuteSoundverseMusic(ctx, cfg, request, modelID)
	case "mubert_music_adapter":
		artifacts, usage, providerJobID, err = ExecuteMubertMusic(ctx, cfg, updater, privateJobID, request, modelID)
	case "loudly_music_adapter":
		artifacts, usage, providerJobID, err = ExecuteLoudlyMusic(ctx, cfg, request, modelID)
	case "worldlabs_world_adapter":
		artifacts, usage, providerJobID, err = ExecuteWorldLabsWorld(ctx, cfg, updater, privateJobID, request, modelID)
	case "openai_compat_adapter", "mimo_chat_synthesize_adapter", "mimo_chat_transcribe_adapter":
		artifacts, usage, providerJobID, err = p.executeGenericMediaWithTarget(ctx, request, modelID, target, adapter)
	default:
		err = grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	var bodies map[string]*MediaArtifactBody
	if err == nil {
		bodies, err = detachMediaArtifactBodies(ctx, artifacts)
	}
	return MediaExecutionResult{
		Artifacts:      artifacts,
		ArtifactBodies: bodies,
		Usage:          usage,
		ProviderJobID:  strings.TrimSpace(providerJobID),
	}, err
}

func cloneMediaHeaders(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]string, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func mediaExecutionExtensions(request *runtimev1.SubmitScenarioJobRequest) *structpb.Struct {
	if request == nil {
		return nil
	}
	namespace := ""
	switch request.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		namespace = "nimi.scenario.image.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		namespace = "nimi.scenario.video.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		namespace = "nimi.scenario.speech_synthesize.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		namespace = "nimi.scenario.speech_transcribe.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		namespace = "nimi.scenario.music_generate.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		namespace = "nimi.scenario.world_generate.request"
	}
	for _, extension := range request.GetExtensions() {
		if strings.TrimSpace(extension.GetNamespace()) == namespace && extension.GetPayload() != nil {
			return extension.GetPayload()
		}
	}
	return nil
}

// ResolveSpeechBackendForAdapter resolves transport only after the exact
// Driver-selected speech adapter has been checked against the captured target.
func (p *CloudProvider) ResolveSpeechBackendForAdapter(adapter string, modelID string, target *RemoteTarget) (*Backend, string) {
	if p == nil || target == nil || !speechAdapterMatchesProvider(adapter, target.ProviderType) {
		return nil, ""
	}
	return p.ResolveMediaBackendWithTarget(modelID, target)
}

func speechAdapterMatchesProvider(adapter string, provider string) bool {
	adapter = strings.TrimSpace(adapter)
	provider = strings.ToLower(strings.TrimSpace(provider))
	switch adapter {
	case "openai_compat_adapter":
		return provider != ""
	case "bytedance_openspeech_adapter":
		return provider == "volcengine_openspeech"
	case "alibaba_native_adapter":
		return provider == "dashscope"
	case "gemini_operation_adapter":
		return provider == "gemini"
	case "mimo_chat_synthesize_adapter":
		return provider == "mimo"
	case "minimax_task_adapter":
		return provider == "minimax"
	case "glm_native_adapter":
		return provider == "glm"
	case "elevenlabs_native_adapter":
		return provider == "elevenlabs"
	case "fish_audio_native_adapter":
		return provider == "fish_audio"
	case "aws_polly_native_adapter":
		return provider == "aws_polly"
	case "azure_speech_native_adapter":
		return provider == "azure_speech"
	case "google_cloud_tts_adapter":
		return provider == "google_cloud_tts"
	case "stepfun_native_adapter":
		return provider == "stepfun"
	default:
		return false
	}
}

func (p *CloudProvider) executeGenericMediaWithTarget(
	ctx context.Context,
	request *runtimev1.SubmitScenarioJobRequest,
	modelID string,
	target *RemoteTarget,
	adapter string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if p == nil || target == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	backend, backendModelID := p.ResolveMediaBackendWithTarget(modelID, target)
	if backend == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if strings.TrimSpace(backendModelID) == "" {
		backendModelID = modelID
	}
	extensions := ScenarioExtensionPayloadForType(request.GetScenarioType(), request.GetExtensions())
	switch request.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		spec := request.GetSpec().GetImageGenerate()
		payload, usage, err := backend.GenerateImage(ctx, backendModelID, spec, extensions)
		if err != nil {
			return nil, nil, "", err
		}
		metadata := map[string]any{
			"adapter":          adapter,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"size":             strings.TrimSpace(spec.GetSize()),
			"aspect_ratio":     strings.TrimSpace(spec.GetAspectRatio()),
			"quality":          strings.TrimSpace(spec.GetQuality()),
			"style":            strings.TrimSpace(spec.GetStyle()),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"reference_images": mediaStringSlice(spec.GetReferenceImages()),
			"mask":             strings.TrimSpace(spec.GetMask()),
		}
		if len(extensions) > 0 {
			metadata["extensions"] = extensions
		}
		artifact := BinaryArtifact(ResolveImageArtifactMIME(spec, payload), payload, metadata)
		ApplyImageSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		spec := request.GetSpec().GetVideoGenerate()
		payload, usage, err := backend.GenerateVideo(ctx, backendModelID, spec, extensions)
		if err != nil {
			return nil, nil, "", err
		}
		metadata := map[string]any{
			"adapter":                     adapter,
			"prompt":                      VideoPrompt(spec),
			"negative_prompt":             VideoNegativePrompt(spec),
			"mode":                        spec.GetMode().String(),
			"content":                     VideoContentPayload(spec),
			"duration_sec":                VideoDurationSec(spec),
			"frames":                      VideoFrames(spec),
			"fps":                         VideoFPS(spec),
			"resolution":                  VideoResolution(spec),
			"aspect_ratio":                VideoRatio(spec),
			"seed":                        VideoSeed(spec),
			"camera_fixed":                VideoCameraFixed(spec),
			"watermark":                   VideoWatermark(spec),
			"generate_audio":              VideoGenerateAudio(spec),
			"draft":                       VideoDraft(spec),
			"service_tier":                VideoServiceTier(spec),
			"execution_expires_after_sec": VideoExecutionExpiresAfterSec(spec),
			"return_last_frame":           VideoReturnLastFrame(spec),
		}
		if len(extensions) > 0 {
			metadata["extensions"] = extensions
		}
		artifact := BinaryArtifact(ResolveVideoArtifactMIME(spec, payload), payload, metadata)
		ApplyVideoSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		spec := request.GetSpec().GetSpeechSynthesize()
		payload, usage, err := backend.SynthesizeSpeech(ctx, backendModelID, spec, extensions)
		if err != nil {
			return nil, nil, "", err
		}
		metadata := map[string]any{
			"adapter":      adapter,
			"voice_ref":    mediaScenarioVoiceRef(spec),
			"language":     strings.TrimSpace(spec.GetLanguage()),
			"audio_format": strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":      strings.TrimSpace(spec.GetEmotion()),
		}
		if len(extensions) > 0 {
			metadata["extensions"] = extensions
		}
		artifact := BinaryArtifact(ResolveSpeechArtifactMIME(spec, payload), payload, metadata)
		ApplySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		spec := request.GetSpec().GetSpeechTranscribe()
		audioBytes, mimeType, audioURI, err := ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, usage, err := backend.Transcribe(ctx, backendModelID, spec, audioBytes, mimeType, extensions)
		if err != nil {
			return nil, nil, "", err
		}
		metadata := map[string]any{
			"text":            text,
			"adapter":         adapter,
			"language":        strings.TrimSpace(spec.GetLanguage()),
			"timestamps":      spec.GetTimestamps(),
			"diarization":     spec.GetDiarization(),
			"speaker_count":   spec.GetSpeakerCount(),
			"response_format": strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":       mimeType,
			"audio_uri":       audioURI,
		}
		if len(extensions) > 0 {
			metadata["extensions"] = extensions
		}
		artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), metadata)
		ApplyTranscriptionSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		spec := request.GetSpec().GetMusicGenerate()
		payload, usage, err := backend.GenerateMusic(ctx, backendModelID, spec, extensions)
		if err != nil {
			return nil, nil, "", err
		}
		metadata := map[string]any{
			"adapter":          adapter,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"lyrics":           strings.TrimSpace(spec.GetLyrics()),
			"style":            strings.TrimSpace(spec.GetStyle()),
			"title":            strings.TrimSpace(spec.GetTitle()),
			"duration_seconds": spec.GetDurationSeconds(),
			"instrumental":     spec.GetInstrumental(),
		}
		if len(extensions) > 0 {
			metadata["extensions"] = extensions
		}
		artifact := BinaryArtifact("audio/mpeg", payload, metadata)
		ApplyMusicSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func mediaStringSlice(values []string) []any {
	if len(values) == 0 {
		return nil
	}
	out := make([]any, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func mediaScenarioVoiceRef(spec *runtimev1.SpeechSynthesizeScenarioSpec) string {
	if spec == nil || spec.GetVoiceRef() == nil {
		return ""
	}
	switch spec.GetVoiceRef().GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		return strings.TrimSpace(spec.GetVoiceRef().GetPresetVoiceId())
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		return strings.TrimSpace(spec.GetVoiceRef().GetVoiceAssetId())
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		return strings.TrimSpace(spec.GetVoiceRef().GetProviderVoiceRef())
	default:
		return ""
	}
}
