package nimillm

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterMiniMaxTask = "minimax_task_adapter"

// ExecuteMiniMaxTask handles MiniMax scenario job execution for TTS, STT, image,
// and video modalities.
func ExecuteMiniMaxTask(
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

	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_TTS:
		spec := scenarioSpeechSynthesizeSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		scenarioExtensions := StructToMap(extractScenarioExtensions(req))
		miniMaxPayload := map[string]any{
			"model":  modelResolved,
			"text":   strings.TrimSpace(spec.GetText()),
			"input":  strings.TrimSpace(spec.GetText()),
			"stream": false,
		}
		if len(scenarioExtensions) > 0 {
			miniMaxPayload["extensions"] = scenarioExtensions
		}
		voiceSetting := map[string]any{}
		if voice := strings.TrimSpace(scenarioVoiceRef(spec)); voice != "" {
			voiceSetting["voice"] = voice
		}
		if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
			voiceSetting["language"] = language
		}
		if emotion := strings.TrimSpace(spec.GetEmotion()); emotion != "" {
			voiceSetting["emotion"] = emotion
		}
		if speed := spec.GetSpeed(); speed > 0 {
			voiceSetting["speed"] = speed
		}
		if pitch := spec.GetPitch(); pitch != 0 {
			voiceSetting["pitch"] = pitch
		}
		if volume := spec.GetVolume(); volume > 0 {
			voiceSetting["volume"] = volume
		}
		if len(voiceSetting) > 0 {
			miniMaxPayload["voice_setting"] = voiceSetting
		}
		audioSetting := map[string]any{}
		if audioFormat := strings.TrimSpace(spec.GetAudioFormat()); audioFormat != "" {
			audioSetting["format"] = audioFormat
			miniMaxPayload["audio_format"] = audioFormat
			miniMaxPayload["response_format"] = audioFormat
		}
		if sampleRate := spec.GetSampleRateHz(); sampleRate > 0 {
			audioSetting["sample_rate"] = sampleRate
			miniMaxPayload["sample_rate_hz"] = sampleRate
		}
		if len(audioSetting) > 0 {
			miniMaxPayload["audio_setting"] = audioSetting
		}
		openAIPayload := map[string]any{
			"model":          modelResolved,
			"input":          strings.TrimSpace(spec.GetText()),
			"text":           strings.TrimSpace(spec.GetText()),
			"voice":          strings.TrimSpace(scenarioVoiceRef(spec)),
			"language":       strings.TrimSpace(spec.GetLanguage()),
			"emotion":        strings.TrimSpace(spec.GetEmotion()),
			"speed":          spec.GetSpeed(),
			"pitch":          spec.GetPitch(),
			"volume":         spec.GetVolume(),
			"sample_rate_hz": spec.GetSampleRateHz(),
		}
		if audioFormat := strings.TrimSpace(spec.GetAudioFormat()); audioFormat != "" {
			openAIPayload["audio_format"] = audioFormat
			openAIPayload["response_format"] = audioFormat
		}
		if len(scenarioExtensions) > 0 {
			openAIPayload["extensions"] = scenarioExtensions
		}
		paths := resolveMiniMaxSpeechPaths(scenarioExtensions)
		var lastErr error
		for _, endpointPath := range paths {
			payload := openAIPayload
			if isMiniMaxNativeTTSPath(endpointPath) {
				payload = miniMaxPayload
			}
			body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, endpointPath), apiKey, payload, nil)
			if err != nil {
				if status.Code(err) == codes.NotFound {
					lastErr = err
					continue
				}
				return nil, nil, "", err
			}
			artifactBytes, mimeType := ExtractSpeechArtifactFromResponseBody(body)
			if len(artifactBytes) == 0 {
				lastErr = grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
				continue
			}
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "audio/") {
				mimeType = ResolveSpeechArtifactMIME(spec, artifactBytes)
			}
			artifact := BinaryArtifact(mimeType, artifactBytes, map[string]any{
				"adapter":      AdapterMiniMaxTask,
				"endpoint":     endpointPath,
				"voice":        strings.TrimSpace(scenarioVoiceRef(spec)),
				"language":     strings.TrimSpace(spec.GetLanguage()),
				"audio_format": strings.TrimSpace(spec.GetAudioFormat()),
				"emotion":      strings.TrimSpace(spec.GetEmotion()),
				"extensions":   scenarioExtensions,
			})
			ApplySpeechSpecMetadata(artifact, spec)
			return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 120), "", nil
		}
		if lastErr != nil {
			if status.Code(lastErr) == codes.NotFound {
				return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
			}
			return nil, nil, "", lastErr
		}
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	case runtimev1.Modal_MODAL_STT:
		spec := scenarioSpeechTranscribeSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		audioBytes, mimeType, audioURI, err := ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, endpointPath, err := ExecuteMiniMaxTranscribe(ctx, baseURL, apiKey, modelResolved, spec, audioBytes, mimeType, StructToMap(extractScenarioExtensions(req)))
		if err != nil {
			return nil, nil, "", err
		}
		usage := &runtimev1.UsageStats{
			InputTokens:  MaxInt64(1, int64(len(audioBytes)/256)),
			OutputTokens: EstimateTokens(text),
			ComputeMs:    MaxInt64(10, int64(len(audioBytes)/64)),
		}
		artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":            text,
			"adapter":         AdapterMiniMaxTask,
			"endpoint":        endpointPath,
			"language":        strings.TrimSpace(spec.GetLanguage()),
			"timestamps":      spec.GetTimestamps(),
			"diarization":     spec.GetDiarization(),
			"speaker_count":   spec.GetSpeakerCount(),
			"response_format": strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":       mimeType,
			"audio_uri":       audioURI,
			"extensions":      StructToMap(extractScenarioExtensions(req)),
		})
		ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
	}

	// MODAL_IMAGE / MODAL_VIDEO: async task submission + polling
	submitPath := "/v1/image_generation"
	queryPath := "/v1/query/image_generation"
	prompt := ""
	defaultMIME := "image/png"
	if scenarioModal(req) == runtimev1.Modal_MODAL_VIDEO {
		submitPath = "/v1/video_generation"
		queryPath = "/v1/query/video_generation"
		defaultMIME = "video/mp4"
	}
	if scenarioModal(req) != runtimev1.Modal_MODAL_IMAGE && scenarioModal(req) != runtimev1.Modal_MODAL_VIDEO {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if scenarioModal(req) == runtimev1.Modal_MODAL_IMAGE {
		spec := scenarioImageSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		prompt = spec.GetPrompt()
	} else {
		spec := scenarioVideoSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		prompt = VideoPrompt(spec)
	}

	submitPayload := map[string]any{
		"model":  modelResolved,
		"prompt": prompt,
	}
	if imageSpec := scenarioImageSpec(req); imageSpec != nil {
		submitPayload["negative_prompt"] = imageSpec.GetNegativePrompt()
		submitPayload["size"] = imageSpec.GetSize()
		submitPayload["aspect_ratio"] = imageSpec.GetAspectRatio()
		submitPayload["quality"] = imageSpec.GetQuality()
		submitPayload["style"] = imageSpec.GetStyle()
		submitPayload["response_format"] = imageSpec.GetResponseFormat()
	}
	if videoSpec := scenarioVideoSpec(req); videoSpec != nil {
		submitPayload["mode"] = strings.ToLower(strings.TrimPrefix(videoSpec.GetMode().String(), "VIDEO_MODE_"))
		submitPayload["negative_prompt"] = VideoNegativePrompt(videoSpec)
		submitPayload["content"] = VideoContentPayload(videoSpec)
		submitPayload["duration_sec"] = VideoDurationSec(videoSpec)
		submitPayload["frames"] = VideoFrames(videoSpec)
		submitPayload["fps"] = VideoFPS(videoSpec)
		submitPayload["resolution"] = VideoResolution(videoSpec)
		submitPayload["aspect_ratio"] = VideoRatio(videoSpec)
		submitPayload["seed"] = VideoSeed(videoSpec)
		submitPayload["first_frame_uri"] = VideoFirstFrameURI(videoSpec)
		submitPayload["last_frame_uri"] = VideoLastFrameURI(videoSpec)
		submitPayload["reference_images"] = VideoReferenceImageURIs(videoSpec)
		submitPayload["camera_fixed"] = VideoCameraFixed(videoSpec)
		submitPayload["watermark"] = VideoWatermark(videoSpec)
		submitPayload["generate_audio"] = VideoGenerateAudio(videoSpec)
		submitPayload["draft"] = VideoDraft(videoSpec)
		submitPayload["service_tier"] = VideoServiceTier(videoSpec)
		submitPayload["execution_expires_after_sec"] = VideoExecutionExpiresAfterSec(videoSpec)
		submitPayload["return_last_frame"] = VideoReturnLastFrame(videoSpec)
	}
	if opts := StructToMap(extractScenarioExtensions(req)); len(opts) > 0 {
		submitPayload["extensions"] = opts
	}
	submitResp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(submitResp["task_id"]),
		ValueAsString(submitResp["taskId"]),
		ValueAsString(submitResp["id"]),
	))
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
		queryURL, err := url.Parse(JoinURL(baseURL, queryPath))
		if err != nil {
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		values := queryURL.Query()
		values.Set("task_id", providerJobID)
		queryURL.RawQuery = values.Encode()

		pollResp := map[string]any{}
		if err := DoJSONRequest(ctx, http.MethodGet, queryURL.String(), apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		statusText := strings.ToLower(strings.TrimSpace(FirstNonEmpty(
			ValueAsString(pollResp["status"]),
			ValueAsString(pollResp["task_status"]),
			ValueAsString(MapField(pollResp["result"], "status")),
		)))
		if isMiniMaxTaskPendingStatus(statusText) {
			updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if isMiniMaxTaskFailedStatus(statusText) {
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
			"adapter":  AdapterMiniMaxTask,
			"response": pollResp,
		}
		if artifactURI != "" {
			artifactMeta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
		if scenarioModal(req) == runtimev1.Modal_MODAL_IMAGE {
			ApplyImageSpecMetadata(artifact, scenarioImageSpec(req))
		}
		if scenarioModal(req) == runtimev1.Modal_MODAL_VIDEO {
			ApplyVideoSpecMetadata(artifact, scenarioVideoSpec(req))
		}
		computeMs := int64(180)
		if scenarioModal(req) == runtimev1.Modal_MODAL_VIDEO {
			computeMs = 420
		}
		updater.UpdatePollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(prompt, artifactBytes, computeMs), providerJobID, nil
	}
}

// ExecuteMiniMaxTranscribe attempts transcription across multiple MiniMax
// endpoint paths, delegating to ExecuteGLMTranscribe for the actual multipart
// POST.
func ExecuteMiniMaxTranscribe(
	ctx context.Context,
	baseURL string,
	apiKey string,
	modelResolved string,
	spec *runtimev1.SpeechTranscribeScenarioSpec,
	audioBytes []byte,
	mimeType string,
	scenarioExtensions map[string]any,
) (string, string, error) {
	paths := resolveMiniMaxTranscriptionPaths(scenarioExtensions)
	if len(paths) == 0 {
		return "", "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	var lastErr error
	for _, endpointPath := range paths {
		text, err := ExecuteGLMTranscribe(ctx, JoinURL(baseURL, endpointPath), apiKey, modelResolved, spec, audioBytes, mimeType, scenarioExtensions)
		if err == nil {
			return text, endpointPath, nil
		}
		if status.Code(err) == codes.NotFound {
			lastErr = err
			continue
		}
		return "", "", err
	}
	if lastErr != nil {
		return "", "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	return "", "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

// ---------------------------------------------------------------------------
// Package-private helpers
// ---------------------------------------------------------------------------

func isMiniMaxTaskPendingStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "", "queued", "pending", "running", "processing", "in_progress":
		return true
	default:
		return false
	}
}

func isMiniMaxTaskFailedStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "failed", "error", "canceled", "cancelled":
		return true
	default:
		return false
	}
}

func resolveMiniMaxSpeechPaths(scenarioExtensions map[string]any) []string {
	return ResolveProviderEndpointPaths(
		scenarioExtensions,
		[]string{"tts_path", "speech_path", "audio_speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/v1/t2a_v2", "/v1/audio/speech"},
	)
}

func resolveMiniMaxTranscriptionPaths(scenarioExtensions map[string]any) []string {
	return ResolveProviderEndpointPaths(
		scenarioExtensions,
		[]string{"stt_path", "transcription_path", "audio_transcriptions_path"},
		[]string{"stt_paths", "transcription_paths"},
		[]string{"/v1/audio/transcriptions", "/v1/stt/transcriptions", "/v1/stt"},
	)
}

func isMiniMaxNativeTTSPath(endpointPath string) bool {
	lower := strings.ToLower(strings.TrimSpace(endpointPath))
	return strings.Contains(lower, "t2a")
}
