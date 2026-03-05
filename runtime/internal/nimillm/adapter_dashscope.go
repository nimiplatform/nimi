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

// ExecuteAlibabaNative executes a scenario job against the Alibaba native API.
// It handles four modals: image generation, video generation, TTS, and STT.
func ExecuteAlibabaNative(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := nativeOriginURL(strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/"))
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := scenarioImageSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		scenarioExtensions := StructToMap(nil)
		submitPath := resolveAlibabaImageSubmitPath(spec)
		queryPathTemplate := resolveAlibabaTaskQueryPathTemplate(scenarioExtensions)
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
		if len(scenarioExtensions) > 0 {
			submitPayload["extensions"] = scenarioExtensions
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
			artifactMeta := map[string]any{
				"adapter":          AdapterAlibabaNative,
				"submit_endpoint":  submitPath,
				"response":         submitResp,
				"extensions": scenarioExtensions,
			}
			if artifactURI != "" {
				artifactMeta["uri"] = artifactURI
			}
			artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
			ApplyImageSpecMetadata(artifact, spec)
			return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
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
			func(artifact *runtimev1.ScenarioArtifact) {
				ApplyImageSpecMetadata(artifact, spec)
			},
			map[string]any{
				"extensions": scenarioExtensions,
			},
		)
	case runtimev1.Modal_MODAL_VIDEO:
		spec := scenarioVideoSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		submitPath := resolveAlibabaVideoSubmitPath()
		queryPathTemplate := resolveAlibabaTaskQueryPathTemplate(nil)
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          VideoPrompt(spec),
			"negative_prompt": VideoNegativePrompt(spec),
			"input": map[string]any{
				"prompt":          VideoPrompt(spec),
				"negative_prompt": VideoNegativePrompt(spec),
			},
			"parameters": map[string]any{
				"duration_sec":          VideoDurationSec(spec),
				"frames":                VideoFrames(spec),
				"fps":                   VideoFPS(spec),
				"resolution":            VideoResolution(spec),
				"aspect_ratio":          VideoRatio(spec),
				"seed":                  VideoSeed(spec),
				"first_frame_uri":       VideoFirstFrameURI(spec),
				"last_frame_uri":        VideoLastFrameURI(spec),
				"reference_images":      VideoReferenceImageURIs(spec),
				"camera_fixed":          VideoCameraFixed(spec),
				"watermark":             VideoWatermark(spec),
				"generate_audio":        VideoGenerateAudio(spec),
				"draft":                 VideoDraft(spec),
				"service_tier":          VideoServiceTier(spec),
				"execution_expires_sec": VideoExecutionExpiresAfterSec(spec),
				"return_last_frame":     VideoReturnLastFrame(spec),
			},
		}
		if content := VideoContentPayload(spec); len(content) > 0 {
			submitPayload["content"] = content
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
			artifactMeta := map[string]any{
				"adapter":         AdapterAlibabaNative,
				"submit_endpoint": submitPath,
				"response":        submitResp,
			}
			if artifactURI != "" {
				artifactMeta["uri"] = artifactURI
			}
			artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
			ApplyVideoSpecMetadata(artifact, spec)
			return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(VideoPrompt(spec), artifactBytes, 420), "", nil
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
			VideoPrompt(spec),
			func(artifact *runtimev1.ScenarioArtifact) {
				ApplyVideoSpecMetadata(artifact, spec)
			},
			map[string]any{"mode": spec.GetMode().String()},
		)
	case runtimev1.Modal_MODAL_TTS:
		spec := scenarioSpeechSynthesizeSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		requestedVoice := strings.TrimSpace(scenarioVoiceRef(spec))
		scenarioExtensions := StructToMap(nil)
		payload := map[string]any{
			"model": modelResolved,
			"input": map[string]any{
				"text":  strings.TrimSpace(spec.GetText()),
				"voice": requestedVoice,
			},
			"parameters": map[string]any{
				"voice":       requestedVoice,
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
		if len(scenarioExtensions) > 0 {
			payload["extensions"] = scenarioExtensions
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
			"voice":            requestedVoice,
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"audio_format":     strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":          strings.TrimSpace(spec.GetEmotion()),
			"extensions": scenarioExtensions,
		})
		ApplySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 120), "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := scenarioSpeechTranscribeSpec(req)
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
			"extensions": StructToMap(nil),
		})
		ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

// ---------------------------------------------------------------------------
// Alibaba-specific path resolvers (package-private)
// ---------------------------------------------------------------------------

func resolveAlibabaImageSubmitPath(spec *runtimev1.ImageGenerateScenarioSpec) string {
	scenarioExtensions := map[string]any{}
	if spec != nil {
		scenarioExtensions = StructToMap(nil)
	}
	return FirstProviderEndpointPath(
		scenarioExtensions,
		[]string{"image_path", "image_submit_path"},
		[]string{"image_paths", "image_submit_paths"},
		[]string{"/api/v1/services/aigc/image2image/image-synthesis"},
	)
}

func resolveAlibabaVideoSubmitPath() string {
	return FirstProviderEndpointPath(
		nil,
		[]string{"video_path", "video_submit_path"},
		[]string{"video_paths", "video_submit_paths"},
		[]string{"/api/v1/services/aigc/video-generation/video-synthesis"},
	)
}

func resolveAlibabaTaskQueryPathTemplate(scenarioExtensions map[string]any) string {
	return ResolveTaskQueryPathTemplate(
		scenarioExtensions,
		[]string{"task_query_path", "query_path", "task_query_path_template"},
		[]string{"task_query_paths", "query_paths", "task_query_path_templates"},
		[]string{"/api/v1/tasks/{task_id}"},
	)
}

func resolveAlibabaTTSPath(spec *runtimev1.SpeechSynthesizeScenarioSpec) string {
	scenarioExtensions := map[string]any{}
	if spec != nil {
		scenarioExtensions = StructToMap(nil)
	}
	return FirstProviderEndpointPath(
		scenarioExtensions,
		[]string{"tts_path", "speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/api/v1/services/aigc/multimodal-generation/generation"},
	)
}

func resolveAlibabaSTTPath(spec *runtimev1.SpeechTranscribeScenarioSpec) string {
	scenarioExtensions := map[string]any{}
	if spec != nil {
		scenarioExtensions = StructToMap(nil)
	}
	return FirstProviderEndpointPath(
		scenarioExtensions,
		[]string{"stt_path", "transcription_path"},
		[]string{"stt_paths", "transcription_paths"},
		[]string{"/api/v1/services/audio/asr/transcription"},
	)
}
