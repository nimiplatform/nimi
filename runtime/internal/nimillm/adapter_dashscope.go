package nimillm

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterAlibabaNative = "alibaba_native_adapter"

// nativeOriginURL extracts scheme://host from a URL, stripping any path
// (e.g. /compatible-mode/v1). This prevents double-path when native adapters
// append their own API paths (e.g. /api/v1/...).
func nativeOriginURL(endpoint string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return ""
	}
	u, err := url.Parse(trimmed)
	if err != nil || u.Host == "" {
		return trimmed
	}
	return u.Scheme + "://" + u.Host
}

// ExecuteAlibabaNative executes a media job against the Alibaba native API.
// It handles four modals: image generation, video generation, TTS, and STT.
func ExecuteAlibabaNative(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := nativeOriginURL(strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/"))
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		providerOptions := StructToMap(spec.GetProviderOptions())
		submitPath := resolveAlibabaImageSubmitPath(spec)
		queryPathTemplate := resolveAlibabaTaskQueryPathTemplate(providerOptions)
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
			"input": map[string]any{
				"prompt":          spec.GetPrompt(),
				"negative_prompt": spec.GetNegativePrompt(),
			},
			"parameters": map[string]any{
				"n":            spec.GetN(),
				"size":         spec.GetSize(),
				"aspect_ratio": spec.GetAspectRatio(),
				"quality":      spec.GetQuality(),
				"style":        spec.GetStyle(),
				"seed":         spec.GetSeed(),
				"mask":         spec.GetMask(),
				"format":       spec.GetResponseFormat(),
			},
		}
		if len(spec.GetReferenceImages()) > 0 {
			submitPayload["reference_images"] = append([]string(nil), spec.GetReferenceImages()...)
		}
		if len(providerOptions) > 0 {
			submitPayload["provider_options"] = providerOptions
		}
		submitResp := map[string]any{}
		if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			return nil, nil, "", err
		}
		providerJobID := ExtractTaskIDFromPayload(submitResp)
		if providerJobID == "" {
			artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(submitResp)
			if len(artifactBytes) == 0 {
				return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			if mimeType == "" {
				mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
			}
			providerRaw := map[string]any{
				"adapter":          AdapterAlibabaNative,
				"submit_endpoint":  submitPath,
				"response":         submitResp,
				"provider_options": providerOptions,
			}
			if artifactURI != "" {
				providerRaw["uri"] = artifactURI
			}
			artifact := BinaryArtifact(mimeType, artifactBytes, providerRaw)
			ApplyImageSpecMetadata(artifact, spec)
			return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
		}
		return PollProviderTaskForArtifact(
			ctx,
			updater,
			jobID,
			baseURL,
			apiKey,
			AdapterAlibabaNative,
			providerJobID,
			submitPath,
			queryPathTemplate,
			ResolveImageArtifactMIME(spec, nil),
			180,
			spec.GetPrompt(),
			func(artifact *runtimev1.MediaArtifact) {
				ApplyImageSpecMetadata(artifact, spec)
			},
			map[string]any{
				"provider_options": providerOptions,
			},
		)
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		providerOptions := StructToMap(spec.GetProviderOptions())
		submitPath := resolveAlibabaVideoSubmitPath(spec)
		queryPathTemplate := resolveAlibabaTaskQueryPathTemplate(providerOptions)
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
			"input": map[string]any{
				"prompt":          spec.GetPrompt(),
				"negative_prompt": spec.GetNegativePrompt(),
			},
			"parameters": map[string]any{
				"duration_sec":    spec.GetDurationSec(),
				"fps":             spec.GetFps(),
				"resolution":      spec.GetResolution(),
				"aspect_ratio":    spec.GetAspectRatio(),
				"seed":            spec.GetSeed(),
				"first_frame_uri": spec.GetFirstFrameUri(),
				"last_frame_uri":  spec.GetLastFrameUri(),
				"camera_motion":   spec.GetCameraMotion(),
			},
		}
		if len(providerOptions) > 0 {
			submitPayload["provider_options"] = providerOptions
		}
		submitResp := map[string]any{}
		if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			return nil, nil, "", err
		}
		providerJobID := ExtractTaskIDFromPayload(submitResp)
		if providerJobID == "" {
			artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(submitResp)
			if len(artifactBytes) == 0 {
				return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			if mimeType == "" {
				mimeType = ResolveVideoArtifactMIME(spec, artifactBytes)
			}
			providerRaw := map[string]any{
				"adapter":          AdapterAlibabaNative,
				"submit_endpoint":  submitPath,
				"response":         submitResp,
				"provider_options": providerOptions,
			}
			if artifactURI != "" {
				providerRaw["uri"] = artifactURI
			}
			artifact := BinaryArtifact(mimeType, artifactBytes, providerRaw)
			ApplyVideoSpecMetadata(artifact, spec)
			return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 420), "", nil
		}
		return PollProviderTaskForArtifact(
			ctx,
			updater,
			jobID,
			baseURL,
			apiKey,
			AdapterAlibabaNative,
			providerJobID,
			submitPath,
			queryPathTemplate,
			"video/mp4",
			420,
			spec.GetPrompt(),
			func(artifact *runtimev1.MediaArtifact) {
				ApplyVideoSpecMetadata(artifact, spec)
			},
			map[string]any{
				"provider_options": providerOptions,
			},
		)
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		normalizedVoice := normalizeSpeechVoiceForTarget(AdapterAlibabaNative, modelResolved, strings.TrimSpace(spec.GetVoice()))
		providerOptions := StructToMap(spec.GetProviderOptions())
		payload := map[string]any{
			"model": modelResolved,
			"input": map[string]any{
				"text":  strings.TrimSpace(spec.GetText()),
				"voice": normalizedVoice,
			},
			"parameters": map[string]any{
				"voice":       normalizedVoice,
				"language":    strings.TrimSpace(spec.GetLanguage()),
				"emotion":     strings.TrimSpace(spec.GetEmotion()),
				"speed":       spec.GetSpeed(),
				"pitch":       spec.GetPitch(),
				"volume":      spec.GetVolume(),
				"format":      strings.TrimSpace(spec.GetAudioFormat()),
				"sample_rate": spec.GetSampleRateHz(),
			},
			"text":           strings.TrimSpace(spec.GetText()),
			"audio_format":   strings.TrimSpace(spec.GetAudioFormat()),
			"sample_rate_hz": spec.GetSampleRateHz(),
		}
		if len(providerOptions) > 0 {
			payload["provider_options"] = providerOptions
		}
		body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, resolveAlibabaTTSPath(spec)), apiKey, payload)
		if err != nil {
			return nil, nil, "", err
		}
		artifactBytes, mimeType := ExtractSpeechArtifactFromResponseBody(body)
		if len(artifactBytes) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "audio/") {
			mimeType = ResolveSpeechArtifactMIME(spec, artifactBytes)
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, map[string]any{
			"adapter":          AdapterAlibabaNative,
			"endpoint":         resolveAlibabaTTSPath(spec),
			"voice":            normalizedVoice,
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"audio_format":     strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":          strings.TrimSpace(spec.GetEmotion()),
			"provider_options": providerOptions,
		})
		ApplySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 120), "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		audioBytes, mimeType, audioURI, err := ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		endpoint := resolveAlibabaSTTPath(spec)
		text, err := ExecuteGLMTranscribe(ctx, JoinURL(baseURL, endpoint), apiKey, modelResolved, spec, audioBytes, mimeType)
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
			"adapter":          AdapterAlibabaNative,
			"endpoint":         endpoint,
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
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

// ---------------------------------------------------------------------------
// Alibaba-specific path resolvers (package-private)
// ---------------------------------------------------------------------------

func resolveAlibabaImageSubmitPath(spec *runtimev1.ImageGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = StructToMap(spec.GetProviderOptions())
	}
	return FirstProviderEndpointPath(
		providerOptions,
		[]string{"image_path", "image_submit_path"},
		[]string{"image_paths", "image_submit_paths"},
		[]string{"/api/v1/services/aigc/image2image/image-synthesis"},
	)
}

func resolveAlibabaVideoSubmitPath(spec *runtimev1.VideoGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = StructToMap(spec.GetProviderOptions())
	}
	return FirstProviderEndpointPath(
		providerOptions,
		[]string{"video_path", "video_submit_path"},
		[]string{"video_paths", "video_submit_paths"},
		[]string{"/api/v1/services/aigc/video-generation/video-synthesis"},
	)
}

func resolveAlibabaTaskQueryPathTemplate(providerOptions map[string]any) string {
	return ResolveTaskQueryPathTemplate(
		providerOptions,
		[]string{"task_query_path", "query_path", "task_query_path_template"},
		[]string{"task_query_paths", "query_paths", "task_query_path_templates"},
		[]string{"/api/v1/tasks/{task_id}"},
	)
}

func resolveAlibabaTTSPath(spec *runtimev1.SpeechSynthesisSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = StructToMap(spec.GetProviderOptions())
	}
	return FirstProviderEndpointPath(
		providerOptions,
		[]string{"tts_path", "speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/api/v1/services/aigc/multimodal-generation/generation"},
	)
}

func resolveAlibabaSTTPath(spec *runtimev1.SpeechTranscriptionSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = StructToMap(spec.GetProviderOptions())
	}
	return FirstProviderEndpointPath(
		providerOptions,
		[]string{"stt_path", "transcription_path"},
		[]string{"stt_paths", "transcription_paths"},
		[]string{"/api/v1/services/audio/asr/transcription"},
	)
}
