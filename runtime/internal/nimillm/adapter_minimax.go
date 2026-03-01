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

// ExecuteMiniMaxTask handles MiniMax media job execution for TTS, STT, image,
// and video modalities.
func ExecuteMiniMaxTask(
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
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		providerOptions := StructToMap(spec.GetProviderOptions())
		miniMaxPayload := map[string]any{
			"model":  modelResolved,
			"text":   strings.TrimSpace(spec.GetText()),
			"input":  strings.TrimSpace(spec.GetText()),
			"stream": false,
		}
		if len(providerOptions) > 0 {
			miniMaxPayload["provider_options"] = providerOptions
		}
		voiceSetting := map[string]any{}
		if voice := strings.TrimSpace(spec.GetVoice()); voice != "" {
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
			"voice":          strings.TrimSpace(spec.GetVoice()),
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
		if len(providerOptions) > 0 {
			openAIPayload["provider_options"] = providerOptions
		}
		paths := resolveMiniMaxSpeechPaths(spec)
		var lastErr error
		for _, endpointPath := range paths {
			payload := openAIPayload
			if isMiniMaxNativeTTSPath(endpointPath) {
				payload = miniMaxPayload
			}
			body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, endpointPath), apiKey, payload)
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
				"adapter":          AdapterMiniMaxTask,
				"endpoint":         endpointPath,
				"voice":            strings.TrimSpace(spec.GetVoice()),
				"language":         strings.TrimSpace(spec.GetLanguage()),
				"audio_format":     strings.TrimSpace(spec.GetAudioFormat()),
				"emotion":          strings.TrimSpace(spec.GetEmotion()),
				"provider_options": providerOptions,
			})
			ApplySpeechSpecMetadata(artifact, spec)
			return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 120), "", nil
		}
		if lastErr != nil {
			if status.Code(lastErr) == codes.NotFound {
				return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
			}
			return nil, nil, "", lastErr
		}
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		audioBytes, mimeType, audioURI, err := ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, endpointPath, err := ExecuteMiniMaxTranscribe(ctx, baseURL, apiKey, modelResolved, spec, audioBytes, mimeType)
		if err != nil {
			return nil, nil, "", err
		}
		usage := &runtimev1.UsageStats{
			InputTokens:  MaxInt64(1, int64(len(audioBytes)/256)),
			OutputTokens: EstimateTokens(text),
			ComputeMs:    MaxInt64(10, int64(len(audioBytes)/64)),
		}
		artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":             text,
			"adapter":          AdapterMiniMaxTask,
			"endpoint":         endpointPath,
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"timestamps":       spec.GetTimestamps(),
			"diarization":      spec.GetDiarization(),
			"speaker_count":    spec.GetSpeakerCount(),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":        mimeType,
			"audio_uri":        audioURI,
			"provider_options": StructToMap(spec.GetProviderOptions()),
		})
		ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	}

	// MODAL_IMAGE / MODAL_VIDEO: async task submission + polling
	submitPath := "/v1/image_generation"
	queryPath := "/v1/query/image_generation"
	prompt := ""
	defaultMIME := "image/png"
	if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
		submitPath = "/v1/video_generation"
		queryPath = "/v1/query/video_generation"
		defaultMIME = "video/mp4"
	}
	if req.GetModal() != runtimev1.Modal_MODAL_IMAGE && req.GetModal() != runtimev1.Modal_MODAL_VIDEO {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if req.GetModal() == runtimev1.Modal_MODAL_IMAGE {
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		prompt = spec.GetPrompt()
	} else {
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		prompt = spec.GetPrompt()
	}

	submitPayload := map[string]any{
		"model":  modelResolved,
		"prompt": prompt,
	}
	if imageSpec := req.GetImageSpec(); imageSpec != nil {
		submitPayload["negative_prompt"] = imageSpec.GetNegativePrompt()
		submitPayload["size"] = imageSpec.GetSize()
		submitPayload["aspect_ratio"] = imageSpec.GetAspectRatio()
		submitPayload["quality"] = imageSpec.GetQuality()
		submitPayload["style"] = imageSpec.GetStyle()
		submitPayload["response_format"] = imageSpec.GetResponseFormat()
	}
	if videoSpec := req.GetVideoSpec(); videoSpec != nil {
		submitPayload["negative_prompt"] = videoSpec.GetNegativePrompt()
		submitPayload["duration_sec"] = videoSpec.GetDurationSec()
		submitPayload["fps"] = videoSpec.GetFps()
		submitPayload["resolution"] = videoSpec.GetResolution()
		submitPayload["aspect_ratio"] = videoSpec.GetAspectRatio()
		submitPayload["first_frame_uri"] = videoSpec.GetFirstFrameUri()
		submitPayload["last_frame_uri"] = videoSpec.GetLastFrameUri()
		submitPayload["camera_motion"] = videoSpec.GetCameraMotion()
	}
	if opts := StructToMap(extractProviderOptions(req)); len(opts) > 0 {
		submitPayload["provider_options"] = opts
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
		providerRaw := map[string]any{
			"adapter":  AdapterMiniMaxTask,
			"response": pollResp,
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, providerRaw)
		if req.GetModal() == runtimev1.Modal_MODAL_IMAGE {
			ApplyImageSpecMetadata(artifact, req.GetImageSpec())
		}
		if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
			ApplyVideoSpecMetadata(artifact, req.GetVideoSpec())
		}
		computeMs := int64(180)
		if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
			computeMs = 420
		}
		updater.UpdatePollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(prompt, artifactBytes, computeMs), providerJobID, nil
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
	spec *runtimev1.SpeechTranscriptionSpec,
	audioBytes []byte,
	mimeType string,
) (string, string, error) {
	paths := resolveMiniMaxTranscriptionPaths(spec)
	if len(paths) == 0 {
		return "", "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	var lastErr error
	for _, endpointPath := range paths {
		text, err := ExecuteGLMTranscribe(ctx, JoinURL(baseURL, endpointPath), apiKey, modelResolved, spec, audioBytes, mimeType)
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

func resolveMiniMaxSpeechPaths(spec *runtimev1.SpeechSynthesisSpec) []string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = StructToMap(spec.GetProviderOptions())
	}
	return ResolveProviderEndpointPaths(
		providerOptions,
		[]string{"tts_path", "speech_path", "audio_speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/v1/t2a_v2", "/v1/audio/speech"},
	)
}

func resolveMiniMaxTranscriptionPaths(spec *runtimev1.SpeechTranscriptionSpec) []string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = StructToMap(spec.GetProviderOptions())
	}
	return ResolveProviderEndpointPaths(
		providerOptions,
		[]string{"stt_path", "transcription_path", "audio_transcriptions_path"},
		[]string{"stt_paths", "transcription_paths"},
		[]string{"/v1/audio/transcriptions", "/v1/stt/transcriptions", "/v1/stt"},
	)
}

func isMiniMaxNativeTTSPath(endpointPath string) bool {
	lower := strings.ToLower(strings.TrimSpace(endpointPath))
	return strings.Contains(lower, "t2a")
}
