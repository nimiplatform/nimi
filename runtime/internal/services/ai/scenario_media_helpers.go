package ai

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"github.com/nimiplatform/nimi/runtime/internal/services/ai/catalog"
)

const (
	adapterOpenAICompat        = "openai_compat_adapter"
	adapterLocalAINative       = "localai_native_adapter"
	adapterNexaNative          = "nexa_native_adapter"
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
	adapterPlayHTNative        = "playht_native_adapter"
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
)

type mediaAdapterStrategy struct {
	Image string
	Video string
	TTS   string
	STT   string
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
	default:
		return ""
	}
}

var mediaAdapterStrategiesByProvider = map[string]mediaAdapterStrategy{
	// --- Existing native adapters ---
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
	// --- TTS-only native adapters ---
	"elevenlabs": {
		TTS: adapterElevenLabsNative,
	},
	"fish_audio": {
		TTS: adapterFishAudioNative,
	},
	"playht": {
		TTS: adapterPlayHTNative,
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
	// --- Image-only native adapters ---
	"flux": {
		Image: adapterFluxNative,
	},
	"ideogram": {
		Image: adapterIdeogramNative,
	},
	"stability": {
		Image: adapterStabilityNative,
	},
	// --- Video native adapters ---
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
	// --- Mixed native adapters ---
	"stepfun": {
		Image: adapterStepFunNative,
		TTS:   adapterStepFunNative,
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
	default:
		return runtimev1.Modal_MODAL_UNSPECIFIED
	}
}

func validateSubmitScenarioAsyncJobRequest(req *runtimev1.SubmitScenarioJobRequest) error {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateBaseRequest(req.GetHead().GetAppId(), req.GetHead().GetSubjectUserId(), req.GetHead().GetModelId(), req.GetHead().GetRoutePolicy()); err != nil {
		return err
	}
	if len(req.GetIdempotencyKey()) > 256 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	for key := range req.GetLabels() {
		if strings.TrimSpace(key) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
	}

	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		spec := req.GetSpec().GetImageGenerate()
		if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if spec.GetN() < 0 || spec.GetN() > 16 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		spec := req.GetSpec().GetVideoGenerate()
		if spec == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if err := validateVideoGenerateScenarioSpec(spec); err != nil {
			return err
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		spec := req.GetSpec().GetSpeechSynthesize()
		if spec == nil || strings.TrimSpace(spec.GetText()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if spec.GetSampleRateHz() < 0 || spec.GetSampleRateHz() > 192000 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if spec.GetSpeed() < 0 || spec.GetSpeed() > 4 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if spec.GetPitch() < -24 || spec.GetPitch() > 24 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if spec.GetVolume() < 0 || spec.GetVolume() > 4 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		spec := req.GetSpec().GetSpeechTranscribe()
		if spec == nil || !hasTranscriptionAudioSource(spec) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if spec.GetSpeakerCount() < 0 || spec.GetSpeakerCount() > 32 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	default:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	return nil
}

func validateVideoGenerateScenarioSpec(spec *runtimev1.VideoGenerateScenarioSpec) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	mode := spec.GetMode()
	if mode == runtimev1.VideoMode_VIDEO_MODE_UNSPECIFIED {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	content := spec.GetContent()
	if len(content) == 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}

	textCount := 0
	firstFrameCount := 0
	lastFrameCount := 0
	referenceImageCount := 0
	for _, item := range content {
		if item == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
			if strings.TrimSpace(item.GetText()) == "" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
			}
			textCount++
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			if strings.TrimSpace(item.GetImageUrl().GetUrl()) == "" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
			}
			switch item.GetRole() {
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
				firstFrameCount++
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
				lastFrameCount++
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE:
				referenceImageCount++
			default:
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
			}
		default:
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
	}

	switch mode {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if textCount == 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if firstFrameCount > 0 || lastFrameCount > 0 || referenceImageCount > 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if firstFrameCount != 1 || lastFrameCount != 0 || referenceImageCount != 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		if firstFrameCount != 1 || lastFrameCount != 1 || referenceImageCount != 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
		if referenceImageCount < 1 || referenceImageCount > 4 || firstFrameCount != 0 || lastFrameCount != 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}

	options := spec.GetOptions()
	if options == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if options.GetDurationSec() < 0 || options.GetDurationSec() > 600 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if options.GetFrames() < 0 || options.GetFrames() > 1200 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if options.GetDurationSec() > 0 && options.GetFrames() > 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if options.GetFps() < 0 || options.GetFps() > 120 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if options.GetSeed() < -1 || options.GetSeed() > 4294967295 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	ratio := strings.TrimSpace(options.GetRatio())
	if ratio != "" {
		switch ratio {
		case "16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive":
		default:
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE && options.GetCameraFixed() {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}

func hasTranscriptionAudioSource(spec *runtimev1.SpeechTranscribeScenarioSpec) bool {
	if spec == nil {
		return false
	}
	if source := spec.GetAudioSource(); source != nil {
		switch typed := source.GetSource().(type) {
		case *runtimev1.SpeechTranscriptionAudioSource_AudioBytes:
			return len(typed.AudioBytes) > 0
		case *runtimev1.SpeechTranscriptionAudioSource_AudioUri:
			return strings.TrimSpace(typed.AudioUri) != ""
		case *runtimev1.SpeechTranscriptionAudioSource_AudioChunks:
			if typed.AudioChunks == nil {
				return false
			}
			for _, chunk := range typed.AudioChunks.GetChunks() {
				if len(chunk) > 0 {
					return true
				}
			}
		}
	}
	return false
}

func buildScenarioJobIdempotencyScope(req *runtimev1.SubmitScenarioJobRequest) (string, error) {
	if req == nil {
		return "", nil
	}
	idempotencyKey := strings.TrimSpace(req.GetIdempotencyKey())
	if idempotencyKey == "" {
		return "", nil
	}
	specHash, err := hashSubmitScenarioSpec(req)
	if err != nil {
		return "", err
	}
	return strings.Join([]string{
		strings.TrimSpace(req.GetHead().GetAppId()),
		strings.TrimSpace(req.GetHead().GetSubjectUserId()),
		strings.TrimSpace(req.GetHead().GetModelId()),
		strconv.FormatInt(int64(req.GetScenarioType()), 10),
		idempotencyKey,
		specHash,
	}, "::"), nil
}

func hashSubmitScenarioSpec(req *runtimev1.SubmitScenarioJobRequest) (string, error) {
	if req == nil || req.GetSpec() == nil {
		return "", nil
	}
	raw, err := proto.Marshal(req.GetSpec())
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("%x", sum), nil
}

func defaultScenarioJobTimeout(scenarioType runtimev1.ScenarioType) time.Duration {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return defaultGenerateImageTimeout
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return defaultGenerateVideoTimeout
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return defaultSynthesizeTimeout
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return defaultTranscribeTimeout
	default:
		return defaultGenerateTimeout
	}
}

func cloneScenarioArtifacts(input []*runtimev1.ScenarioArtifact) []*runtimev1.ScenarioArtifact {
	if len(input) == 0 {
		return nil
	}
	out := make([]*runtimev1.ScenarioArtifact, 0, len(input))
	for _, item := range input {
		if item == nil {
			continue
		}
		cloned := proto.Clone(item)
		copied, ok := cloned.(*runtimev1.ScenarioArtifact)
		if !ok {
			continue
		}
		out = append(out, copied)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func cloneSubmitScenarioJobRequest(input *runtimev1.SubmitScenarioJobRequest) *runtimev1.SubmitScenarioJobRequest {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*runtimev1.SubmitScenarioJobRequest)
	if !ok {
		return nil
	}
	return copied
}

func extractScenarioExtensions(req *runtimev1.SubmitScenarioJobRequest) *structpb.Struct {
	if req == nil {
		return nil
	}
	namespace := mediaScenarioExtensionNamespace(req.GetScenarioType())
	if namespace == "" {
		return nil
	}
	for _, ext := range req.GetExtensions() {
		if strings.TrimSpace(ext.GetNamespace()) != namespace {
			continue
		}
		if ext.GetPayload() == nil || len(ext.GetPayload().GetFields()) == 0 {
			return nil
		}
		return ext.GetPayload()
	}
	return nil
}

func mediaScenarioExtensionNamespace(scenarioType runtimev1.ScenarioType) string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return "nimi.scenario.image.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return "nimi.scenario.video.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return "nimi.scenario.speech_synthesize.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return "nimi.scenario.speech_transcribe.request"
	default:
		return ""
	}
}

// executeBackendSyncMedia routes sync media operations through the underlying
// Backend (via MediaBackendProvider) rather than the Provider interface.
func executeBackendSyncMedia(
	ctx context.Context,
	logger *slog.Logger,
	req *runtimev1.SubmitScenarioJobRequest,
	selectedProvider provider,
	modelResolved string,
	adapterName string,
	remoteTarget *nimillm.RemoteTarget,
	cloudProvider *nimillm.CloudProvider,
	voiceCatalog *catalog.Resolver,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	var backend *nimillm.Backend
	var backendModelID string
	if remoteTarget != nil && cloudProvider != nil {
		backend, backendModelID = cloudProvider.ResolveMediaBackendWithTarget(modelResolved, remoteTarget)
	} else {
		mbp, ok := selectedProvider.(nimillm.MediaBackendProvider)
		if !ok || mbp == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		backend, backendModelID = mbp.ResolveMediaBackend(modelResolved)
	}
	if backend == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if backendModelID == "" {
		backendModelID = modelResolved
	}
	scenarioExtensions := nimillm.ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())

	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		spec := req.GetSpec().GetImageGenerate()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		var (
			payload []byte
			usage   *runtimev1.UsageStats
			err     error
			compat  *nimillm.LocalAIImageCompat
		)
		if adapterName == adapterLocalAINative {
			payload, usage, compat, err = backend.GenerateImageLocalAI(ctx, backendModelID, spec, scenarioExtensions)
		} else {
			payload, usage, err = backend.GenerateImage(ctx, backendModelID, spec, scenarioExtensions)
		}
		if err != nil {
			return nil, nil, "", err
		}
		artifactMeta := map[string]any{
			"adapter":          adapterName,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"size":             strings.TrimSpace(spec.GetSize()),
			"aspect_ratio":     strings.TrimSpace(spec.GetAspectRatio()),
			"quality":          strings.TrimSpace(spec.GetQuality()),
			"style":            strings.TrimSpace(spec.GetStyle()),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"reference_images": stringSliceToAny(spec.GetReferenceImages()),
			"mask":             strings.TrimSpace(spec.GetMask()),
		}
		if len(scenarioExtensions) > 0 {
			artifactMeta["extensions"] = scenarioExtensions
		}
		if compat != nil {
			artifactMeta["localai_prompt"] = compat.LocalAIPrompt
			artifactMeta["source_image"] = compat.SourceImage
			artifactMeta["ref_images_count"] = compat.RefImagesCount
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveImageArtifactMIME(spec, payload), payload, artifactMeta)
		nimillm.ApplyImageSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		spec := req.GetSpec().GetVideoGenerate()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		payload, usage, err := backend.GenerateVideo(ctx, backendModelID, spec, scenarioExtensions)
		if err != nil {
			return nil, nil, "", err
		}
		artifactMeta := map[string]any{
			"adapter":                     adapterName,
			"prompt":                      nimillm.VideoPrompt(spec),
			"negative_prompt":             nimillm.VideoNegativePrompt(spec),
			"mode":                        spec.GetMode().String(),
			"content":                     nimillm.VideoContentPayload(spec),
			"duration_sec":                nimillm.VideoDurationSec(spec),
			"frames":                      nimillm.VideoFrames(spec),
			"fps":                         nimillm.VideoFPS(spec),
			"resolution":                  nimillm.VideoResolution(spec),
			"aspect_ratio":                nimillm.VideoRatio(spec),
			"seed":                        nimillm.VideoSeed(spec),
			"camera_fixed":                nimillm.VideoCameraFixed(spec),
			"watermark":                   nimillm.VideoWatermark(spec),
			"generate_audio":              nimillm.VideoGenerateAudio(spec),
			"draft":                       nimillm.VideoDraft(spec),
			"service_tier":                nimillm.VideoServiceTier(spec),
			"execution_expires_after_sec": nimillm.VideoExecutionExpiresAfterSec(spec),
			"return_last_frame":           nimillm.VideoReturnLastFrame(spec),
		}
		if len(scenarioExtensions) > 0 {
			artifactMeta["extensions"] = scenarioExtensions
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveVideoArtifactMIME(spec, payload), payload, artifactMeta)
		nimillm.ApplyVideoSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		spec := req.GetSpec().GetSpeechSynthesize()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if err := validateConnectorTTSModelSupport(ctx, logger, req, backendModelID, remoteTarget, cloudProvider, voiceCatalog); err != nil {
			return nil, nil, "", err
		}
		payload, usage, err := backend.SynthesizeSpeech(ctx, backendModelID, spec, scenarioExtensions)
		if err != nil {
			return nil, nil, "", err
		}
		artifactMeta := map[string]any{
			"adapter":      adapterName,
			"voice_ref":    resolveScenarioVoiceRef(spec),
			"language":     strings.TrimSpace(spec.GetLanguage()),
			"audio_format": strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":      strings.TrimSpace(spec.GetEmotion()),
		}
		if len(scenarioExtensions) > 0 {
			artifactMeta["extensions"] = scenarioExtensions
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveSpeechArtifactMIME(spec, payload), payload, artifactMeta)
		nimillm.ApplySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		spec := req.GetSpec().GetSpeechTranscribe()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		audioBytes, mimeType, audioURI, err := nimillm.ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, usage, err := backend.Transcribe(ctx, backendModelID, spec, audioBytes, mimeType, scenarioExtensions)
		if err != nil {
			return nil, nil, "", err
		}
		artifactMeta := map[string]any{
			"text":            text,
			"adapter":         adapterName,
			"language":        strings.TrimSpace(spec.GetLanguage()),
			"timestamps":      spec.GetTimestamps(),
			"diarization":     spec.GetDiarization(),
			"speaker_count":   spec.GetSpeakerCount(),
			"response_format": strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":       mimeType,
			"audio_uri":       audioURI,
		}
		if len(scenarioExtensions) > 0 {
			artifactMeta["extensions"] = scenarioExtensions
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveTranscriptionArtifactMIME(spec), []byte(text), artifactMeta)
		nimillm.ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func validateConnectorTTSModelSupport(
	ctx context.Context,
	logger *slog.Logger,
	req *runtimev1.SubmitScenarioJobRequest,
	resolvedModelID string,
	remoteTarget *nimillm.RemoteTarget,
	cloudProvider *nimillm.CloudProvider,
	voiceCatalog *catalog.Resolver,
) error {
	if req == nil || req.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		return nil
	}
	if strings.TrimSpace(req.GetHead().GetConnectorId()) == "" {
		return nil
	}
	if remoteTarget == nil {
		return nil
	}

	requestedVoice := resolveScenarioVoiceRef(req.GetSpec().GetSpeechSynthesize())
	if cloudProvider == nil {
		return nil
	}

	probeBackend, _, err := cloudProvider.ResolveProbeBackend(remoteTarget.ProviderType, remoteTarget.Endpoint, remoteTarget.APIKey)
	if err != nil {
		return err
	}
	models, err := probeBackend.ListModels(ctx)
	if err != nil {
		return err
	}

	matchedModelID, ok := findProbeModelID(models, resolvedModelID)
	if !ok {
		providerMessage := fmt.Sprintf("connector model %q not listed by provider", strings.TrimSpace(resolvedModelID))
		return grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, grpcerr.ReasonOptions{
			ActionHint: "switch_tts_model_or_refresh_connector_models",
			Message:    providerMessage,
			Metadata: map[string]string{
				"provider_message": providerMessage,
			},
		})
	}

	capabilities := modelregistry.InferCapabilities(matchedModelID)
	if !supportsTTSCapability(capabilities) {
		providerMessage := fmt.Sprintf("model %q does not advertise tts capability", strings.TrimSpace(matchedModelID))
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED, grpcerr.ReasonOptions{
			ActionHint: "select_model_with_audio_synthesize_capability",
			Message:    providerMessage,
			Metadata: map[string]string{
				"provider_message": providerMessage,
			},
		})
	}

	voices, source, catalogVersion, err := resolveSpeechVoicesForModelWithProviderType(
		strings.TrimSpace(matchedModelID),
		strings.TrimSpace(remoteTarget.ProviderType),
		voiceCatalog,
	)
	if err != nil {
		return err
	}
	if catalogVersion == "" {
		catalogVersion = "n/a"
	}
	if logger != nil {
		logger.Debug(
			"voice-list-resolved",
			"source", string(source),
			"catalog_version", catalogVersion,
			"model_resolved", strings.TrimSpace(matchedModelID),
			"provider_type", strings.TrimSpace(remoteTarget.ProviderType),
			"connector_id", strings.TrimSpace(req.GetHead().GetConnectorId()),
		)
	}

	if !isSpeechVoiceSupported(requestedVoice, voices) {
		providerMessage := fmt.Sprintf("voice %q is not supported by model %q", requestedVoice, strings.TrimSpace(matchedModelID))
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			ActionHint: "adjust_tts_voice_or_audio_options",
			Message:    providerMessage,
			Metadata: map[string]string{
				"provider_message":     providerMessage,
				"voice_catalog_source": string(source),
				"catalog_version":      catalogVersion,
				"requested_voice":      requestedVoice,
			},
		})
	}

	return nil
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
	case strings.HasPrefix(lowerModel, "localai/"):
		return adapterLocalAINative
	case strings.HasPrefix(lowerModel, "nexa/"):
		return adapterNexaNative
	}

	if strategy, ok := mediaAdapterStrategiesByProvider[providerLower]; ok {
		if adapter := strategy.forModal(modal); adapter != "" {
			return adapter
		}
	}
	// Model-name heuristic: "gemini-*" models require the native Gemini adapter
	// even when the connector's providerType is not explicitly set to "gemini".
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
				// Default to OpenAI-compatible adapter for providers without
				// provider-specific native strategy overrides.
				return adapterOpenAICompat
			}
		}
	}

	// Last-resort compatibility heuristics for custom model prefixes.
	if modal == runtimev1.Modal_MODAL_VIDEO && strings.Contains(resolvedLower, "glm") {
		return adapterGLMTask
	}
	if modal == runtimev1.Modal_MODAL_IMAGE && strings.Contains(resolvedLower, "kimi") {
		return adapterKimiChatMultimodal
	}
	// Default remote adapter path: OpenAI-compatible JSON/binary media routes.
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
	default:
		return false
	}
}

func inferMediaProviderTypeFromSelectedBackend(selectedProvider provider, modelResolved string) string {
	if cloud, ok := selectedProvider.(*nimillm.CloudProvider); ok && cloud != nil {
		if backend, _, _, _ := cloud.PickBackend(modelResolved); backend != nil {
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
	return nimillm.MediaAdapterConfig{BaseURL: creds.BaseURL, APIKey: creds.APIKey}
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
