package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const AdapterGeminiOperation = "gemini_operation_adapter"

// ExecuteGeminiOperation executes a Gemini operation adapter request across
// all supported modalities (image, video, TTS, STT). It submits a job to
// the Gemini /operations endpoint, then polls until completion.
//
// extractProviderOptions is passed as a function parameter because it is
// defined in services/ai and extracts provider options from different spec
// types.
func ExecuteGeminiOperation(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
	extractProviderOptions func(*runtimev1.SubmitMediaJobRequest) *structpb.Struct,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	submitPayload := map[string]any{
		"model": modelResolved,
		"modal": strings.ToLower(req.GetModal().String()),
	}
	providerOptions := StructToMap(extractProviderOptions(req))
	prompt := ""
	defaultMIME := ""
	computeMs := int64(180)
	transcriptionAudioBytes := []byte(nil)
	transcriptionAudioURI := ""
	transcriptionMIME := ""
	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
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
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		prompt = spec.GetPrompt()
		defaultMIME = "video/mp4"
		computeMs = 420
		submitPayload["prompt"] = spec.GetPrompt()
		submitPayload["negative_prompt"] = spec.GetNegativePrompt()
		submitPayload["duration_sec"] = spec.GetDurationSec()
		submitPayload["fps"] = spec.GetFps()
		submitPayload["resolution"] = spec.GetResolution()
		submitPayload["aspect_ratio"] = spec.GetAspectRatio()
		submitPayload["first_frame_uri"] = spec.GetFirstFrameUri()
		submitPayload["last_frame_uri"] = spec.GetLastFrameUri()
		submitPayload["camera_motion"] = spec.GetCameraMotion()
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		prompt = spec.GetText()
		defaultMIME = ResolveSpeechArtifactMIME(spec, nil)
		computeMs = 120
		submitPayload["input"] = spec.GetText()
		submitPayload["text"] = spec.GetText()
		submitPayload["voice"] = spec.GetVoice()
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
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
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
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	if len(providerOptions) > 0 {
		submitPayload["provider_options"] = providerOptions
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
		return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
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
			return nil, nil, providerJobID, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		artifactBytes, mimeType, artifactURI := ExtractArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if mimeType == "" {
			mimeType = defaultMIME
		}
		providerRaw := map[string]any{
			"adapter":  AdapterGeminiOperation,
			"response": pollResp,
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		if req.GetModal() == runtimev1.Modal_MODAL_STT {
			providerRaw["audio_uri"] = transcriptionAudioURI
			providerRaw["mime_type"] = transcriptionMIME
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, providerRaw)
		var usage *runtimev1.UsageStats
		if req.GetImageSpec() != nil {
			ApplyImageSpecMetadata(artifact, req.GetImageSpec())
		}
		if req.GetVideoSpec() != nil {
			ApplyVideoSpecMetadata(artifact, req.GetVideoSpec())
		}
		if req.GetSpeechSpec() != nil {
			spec := req.GetSpeechSpec()
			providerRaw["voice"] = strings.TrimSpace(spec.GetVoice())
			providerRaw["language"] = strings.TrimSpace(spec.GetLanguage())
			providerRaw["audio_format"] = strings.TrimSpace(spec.GetAudioFormat())
			providerRaw["emotion"] = strings.TrimSpace(spec.GetEmotion())
			providerRaw["provider_options"] = providerOptions
			ApplySpeechSpecMetadata(artifact, spec)
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(artifact.GetMimeType())), "audio/") {
				artifact.MimeType = ResolveSpeechArtifactMIME(spec, artifactBytes)
			}
			usage = ArtifactUsage(spec.GetText(), artifactBytes, computeMs)
		}
		if req.GetTranscriptionSpec() != nil {
			spec := req.GetTranscriptionSpec()
			text := strings.TrimSpace(FirstNonEmpty(
				ValueAsString(pollResp["artifact_text"]),
				ValueAsString(pollResp["text"]),
				ValueAsString(MapField(pollResp["result"], "text")),
				string(artifactBytes),
			))
			providerRaw["text"] = text
			providerRaw["language"] = strings.TrimSpace(spec.GetLanguage())
			providerRaw["timestamps"] = spec.GetTimestamps()
			providerRaw["diarization"] = spec.GetDiarization()
			providerRaw["speaker_count"] = spec.GetSpeakerCount()
			providerRaw["response_format"] = strings.TrimSpace(spec.GetResponseFormat())
			providerRaw["provider_options"] = providerOptions
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
		artifact.ProviderRaw = ToStruct(providerRaw)
		if usage == nil {
			usage = ArtifactUsage(prompt, artifactBytes, computeMs)
		}
		updater.UpdatePollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.MediaArtifact{artifact}, usage, providerJobID, nil
	}
}
