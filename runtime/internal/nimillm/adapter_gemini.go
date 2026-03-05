package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterGeminiOperation = "gemini_operation_adapter"

// ExecuteGeminiOperation executes a Gemini operation adapter request across
// all supported modalities (image, video, TTS, STT). It submits a job to
// the Gemini /operations endpoint, then polls until completion.
//
// extractScenarioExtensions is passed as a function parameter because it is
// defined in services/ai and extracts provider options from different spec
// types.
func ExecuteGeminiOperation(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
	extractScenarioExtensions func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	submitPayload := map[string]any{
		"model": modelResolved,
		"modal": strings.ToLower(scenarioModal(req).String()),
	}
	scenarioExtensions := StructToMap(extractScenarioExtensions(req))
	prompt := ""
	defaultMIME := ""
	computeMs := int64(180)
	transcriptionAudioBytes := []byte(nil)
	transcriptionAudioURI := ""
	transcriptionMIME := ""
	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := scenarioImageSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		prompt = spec.GetPrompt()
		defaultMIME = "image/png"
		computeMs = 180
		submitPayload["prompt"] = spec.GetPrompt()
		submitPayload["negative_prompt"] = spec.GetNegativePrompt()
		submitPayload["size"] = spec.GetSize()
		submitPayload["aspect_ratio"] = spec.GetAspectRatio()
		submitPayload["quality"] = spec.GetQuality()
		submitPayload["style"] = spec.GetStyle()
		submitPayload["response_format"] = spec.GetResponseFormat()
		submitPayload["reference_images"] = append([]string(nil), spec.GetReferenceImages()...)
		submitPayload["mask"] = spec.GetMask()
	case runtimev1.Modal_MODAL_VIDEO:
		spec := scenarioVideoSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		prompt = VideoPrompt(spec)
		defaultMIME = "video/mp4"
		computeMs = 420
		submitPayload["prompt"] = VideoPrompt(spec)
		submitPayload["negative_prompt"] = VideoNegativePrompt(spec)
		submitPayload["mode"] = strings.ToLower(strings.TrimPrefix(spec.GetMode().String(), "VIDEO_MODE_"))
		submitPayload["content"] = VideoContentPayload(spec)
		submitPayload["duration_sec"] = VideoDurationSec(spec)
		submitPayload["frames"] = VideoFrames(spec)
		submitPayload["fps"] = VideoFPS(spec)
		submitPayload["resolution"] = VideoResolution(spec)
		submitPayload["aspect_ratio"] = VideoRatio(spec)
		submitPayload["seed"] = VideoSeed(spec)
		submitPayload["first_frame_uri"] = VideoFirstFrameURI(spec)
		submitPayload["last_frame_uri"] = VideoLastFrameURI(spec)
		submitPayload["reference_images"] = VideoReferenceImageURIs(spec)
		submitPayload["camera_fixed"] = VideoCameraFixed(spec)
		submitPayload["watermark"] = VideoWatermark(spec)
		submitPayload["generate_audio"] = VideoGenerateAudio(spec)
		submitPayload["draft"] = VideoDraft(spec)
		submitPayload["service_tier"] = VideoServiceTier(spec)
		submitPayload["execution_expires_after_sec"] = VideoExecutionExpiresAfterSec(spec)
		submitPayload["return_last_frame"] = VideoReturnLastFrame(spec)
	case runtimev1.Modal_MODAL_TTS:
		spec := scenarioSpeechSynthesizeSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		prompt = spec.GetText()
		defaultMIME = ResolveSpeechArtifactMIME(spec, nil)
		computeMs = 120
		submitPayload["input"] = spec.GetText()
		submitPayload["text"] = spec.GetText()
		submitPayload["voice"] = scenarioVoiceRef(spec)
		submitPayload["language"] = spec.GetLanguage()
		submitPayload["emotion"] = spec.GetEmotion()
		submitPayload["speed"] = spec.GetSpeed()
		submitPayload["pitch"] = spec.GetPitch()
		submitPayload["volume"] = spec.GetVolume()
		submitPayload["sample_rate_hz"] = spec.GetSampleRateHz()
		if format := strings.TrimSpace(spec.GetAudioFormat()); format != "" {
			submitPayload["audio_format"] = format
			submitPayload["response_format"] = format
		}
	case runtimev1.Modal_MODAL_STT:
		spec := scenarioSpeechTranscribeSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		audioBytes, mimeType, audioURI, err := ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		prompt = spec.GetPrompt()
		defaultMIME = ResolveTranscriptionArtifactMIME(spec)
		computeMs = MaxInt64(10, int64(len(audioBytes)/64))
		transcriptionAudioBytes = audioBytes
		transcriptionAudioURI = audioURI
		transcriptionMIME = mimeType
		submitPayload["audio_base64"] = base64.StdEncoding.EncodeToString(audioBytes)
		submitPayload["mime_type"] = mimeType
		submitPayload["language"] = spec.GetLanguage()
		submitPayload["timestamps"] = spec.GetTimestamps()
		submitPayload["diarization"] = spec.GetDiarization()
		submitPayload["speaker_count"] = spec.GetSpeakerCount()
		submitPayload["prompt"] = spec.GetPrompt()
		submitPayload["response_format"] = spec.GetResponseFormat()
		if strings.TrimSpace(audioURI) != "" {
			submitPayload["audio_uri"] = audioURI
		}
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if len(scenarioExtensions) > 0 {
		submitPayload["extensions"] = scenarioExtensions
	}

	submitResp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, "/operations"), apiKey, submitPayload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := FirstNonEmpty(
		ValueAsString(submitResp["name"]),
		ValueAsString(submitResp["operation"]),
		ValueAsString(MapField(submitResp["operation"], "name")),
		ValueAsString(submitResp["id"]),
	)
	if providerJobID == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	updater.UpdatePollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
	retryCount := int32(0)

	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, MapProviderRequestError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollPath := JoinURL(baseURL, path.Join("/operations", url.PathEscape(providerJobID)))
		if err := DoJSONRequest(ctx, http.MethodGet, pollPath, apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		done := ValueAsBool(pollResp["done"])
		if !done {
			updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
			time.Sleep(500 * time.Millisecond)
			continue
		}
		statusText := strings.ToLower(strings.TrimSpace(FirstNonEmpty(
			ValueAsString(pollResp["status"]),
			ValueAsString(MapField(pollResp["result"], "status")),
		)))
		if statusText == "failed" || statusText == "error" || statusText == "canceled" || statusText == "cancelled" {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		artifactBytes, mimeType, artifactURI := ExtractArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = defaultMIME
		}
		artifactMeta := map[string]any{
			"adapter":  AdapterGeminiOperation,
			"response": pollResp,
		}
		if artifactURI != "" {
			artifactMeta["uri"] = artifactURI
		}
		if scenarioModal(req) == runtimev1.Modal_MODAL_STT {
			artifactMeta["audio_uri"] = transcriptionAudioURI
			artifactMeta["mime_type"] = transcriptionMIME
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
		var usage *runtimev1.UsageStats
		if scenarioImageSpec(req) != nil {
			ApplyImageSpecMetadata(artifact, scenarioImageSpec(req))
		}
		if scenarioVideoSpec(req) != nil {
			ApplyVideoSpecMetadata(artifact, scenarioVideoSpec(req))
		}
		if scenarioSpeechSynthesizeSpec(req) != nil {
			spec := scenarioSpeechSynthesizeSpec(req)
			artifactMeta["voice"] = strings.TrimSpace(scenarioVoiceRef(spec))
			artifactMeta["language"] = strings.TrimSpace(spec.GetLanguage())
			artifactMeta["audio_format"] = strings.TrimSpace(spec.GetAudioFormat())
			artifactMeta["emotion"] = strings.TrimSpace(spec.GetEmotion())
			artifactMeta["extensions"] = scenarioExtensions
			ApplySpeechSpecMetadata(artifact, spec)
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(artifact.GetMimeType())), "audio/") {
				artifact.MimeType = ResolveSpeechArtifactMIME(spec, artifactBytes)
			}
			usage = ArtifactUsage(spec.GetText(), artifactBytes, computeMs)
		}
		if scenarioSpeechTranscribeSpec(req) != nil {
			spec := scenarioSpeechTranscribeSpec(req)
			text := strings.TrimSpace(FirstNonEmpty(
				ValueAsString(pollResp["artifact_text"]),
				ValueAsString(pollResp["text"]),
				ValueAsString(MapField(pollResp["result"], "text")),
				string(artifactBytes),
			))
			artifactMeta["text"] = text
			artifactMeta["language"] = strings.TrimSpace(spec.GetLanguage())
			artifactMeta["timestamps"] = spec.GetTimestamps()
			artifactMeta["diarization"] = spec.GetDiarization()
			artifactMeta["speaker_count"] = spec.GetSpeakerCount()
			artifactMeta["response_format"] = strings.TrimSpace(spec.GetResponseFormat())
			artifactMeta["extensions"] = scenarioExtensions
			ApplyTranscriptionSpecMetadata(artifact, spec, transcriptionAudioURI)
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(artifact.GetMimeType())), "text/") &&
				!strings.EqualFold(strings.TrimSpace(artifact.GetMimeType()), "application/json") {
				artifact.MimeType = ResolveTranscriptionArtifactMIME(spec)
			}
			usage = &runtimev1.UsageStats{
				InputTokens:  MaxInt64(1, int64(len(transcriptionAudioBytes)/256)),
				OutputTokens: EstimateTokens(text),
				ComputeMs:    computeMs,
			}
		}
		if usage == nil {
			usage = ArtifactUsage(prompt, artifactBytes, computeMs)
		}
		updater.UpdatePollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.ScenarioArtifact{artifact}, usage, providerJobID, nil
	}
}
