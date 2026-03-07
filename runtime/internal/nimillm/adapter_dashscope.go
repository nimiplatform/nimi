package nimillm

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
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
	compatibleBaseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	baseURL := nativeOriginURL(compatibleBaseURL)
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
		scenarioExtensions := scenarioExtensionPayloadForScenario(req)
		submitPath, queryPathTemplate, submitPayload, submitHeaders := buildAlibabaImageSubmitRequest(modelResolved, spec, scenarioExtensions)
		submitResp := map[string]any{}
		if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp, submitHeaders); err != nil {
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
				"adapter":         AdapterAlibabaNative,
				"submit_endpoint": submitPath,
				"response":        submitResp,
				"extensions":      scenarioExtensions,
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
		scenarioExtensions := scenarioExtensionPayloadForScenario(req)
		parameters := map[string]any{
			"voice":       requestedVoice,
			"language":    strings.TrimSpace(spec.GetLanguage()),
			"emotion":     strings.TrimSpace(spec.GetEmotion()),
			"speed":       spec.GetSpeed(),
			"pitch":       spec.GetPitch(),
			"volume":      spec.GetVolume(),
			"format":      strings.TrimSpace(spec.GetAudioFormat()),
			"sample_rate": spec.GetSampleRateHz(),
		}
		applyAlibabaTTSScenarioExtensions(parameters, scenarioExtensions)
		payload := map[string]any{
			"model": modelResolved,
			"input": map[string]any{
				"text":  strings.TrimSpace(spec.GetText()),
				"voice": requestedVoice,
			},
			"parameters":     parameters,
			"text":           strings.TrimSpace(spec.GetText()),
			"audio_format":   strings.TrimSpace(spec.GetAudioFormat()),
			"sample_rate_hz": spec.GetSampleRateHz(),
		}
		if len(scenarioExtensions) > 0 {
			payload["extensions"] = scenarioExtensions
		}
		ttsPath := resolveAlibabaTTSPath(scenarioExtensions)
		body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, ttsPath), apiKey, payload)
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
			"adapter":      AdapterAlibabaNative,
			"endpoint":     ttsPath,
			"voice":        requestedVoice,
			"language":     strings.TrimSpace(spec.GetLanguage()),
			"audio_format": strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":      strings.TrimSpace(spec.GetEmotion()),
			"extensions":   scenarioExtensions,
		})
		ApplySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 120), "", nil
	case runtimev1.Modal_MODAL_STT:
		return ExecuteDashScopeTranscribe(ctx, cfg, req, modelResolved)
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func ExecuteDashScopeTranscribe(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	spec := scenarioSpeechTranscribeSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if err := validateCoreTranscriptionOnly("dashscope", spec); err != nil {
		return nil, nil, "", err
	}

	scenarioExtensions := scenarioExtensionPayloadForScenario(req)
	audioBytes, mimeType, audioURI, err := ResolveTranscriptionAudioSource(ctx, spec)
	if err != nil {
		return nil, nil, "", err
	}

	audioPayload := map[string]any{
		"data": strings.TrimSpace(audioURI),
	}
	if audioPayload["data"] == "" {
		audioPayload["data"] = encodeInlineAudioDataURI(audioBytes, mimeType)
		audioPayload["format"] = resolveInlineAudioFormat(mimeType, audioBytes)
	}

	systemMessage := buildCoreTranscriptionInstruction(spec)
	messages := []map[string]any{
		{
			"role":    "system",
			"content": systemMessage,
		},
		{
			"role": "user",
			"content": []map[string]any{
				{
					"type":        "input_audio",
					"input_audio": audioPayload,
				},
			},
		},
	}
	payload := map[string]any{
		"model":    modelResolved,
		"messages": messages,
		"stream":   false,
	}
	asrOptions := map[string]any{}
	if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
		asrOptions["language"] = language
	}
	if value, ok := scenarioExtensions["enable_itn"]; ok {
		asrOptions["enable_itn"] = ValueAsBool(value)
	}
	if len(asrOptions) > 0 {
		payload["extra_body"] = map[string]any{
			"asr_options": asrOptions,
		}
	}

	endpoint := resolveAlibabaSTTPath(scenarioExtensions)
	responsePayload := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, endpoint), strings.TrimSpace(cfg.APIKey), payload, &responsePayload); err != nil {
		return nil, nil, "", err
	}

	text := extractChatCompletionMessageText(responsePayload)
	if text == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	usage := usageFromChatCompletionTranscription(responsePayload, audioBytes, text)
	artifactMeta := map[string]any{
		"text":            text,
		"adapter":         AdapterDashScopeChatTranscribe,
		"endpoint":        endpoint,
		"language":        strings.TrimSpace(spec.GetLanguage()),
		"prompt":          strings.TrimSpace(spec.GetPrompt()),
		"response_format": strings.TrimSpace(spec.GetResponseFormat()),
		"mime_type":       resolveInlineAudioMIME(mimeType, audioBytes),
		"audio_uri":       audioURI,
		"response":        responsePayload,
	}
	if len(scenarioExtensions) > 0 {
		artifactMeta["extensions"] = scenarioExtensions
	}
	artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), artifactMeta)
	ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}

// ---------------------------------------------------------------------------
// Alibaba-specific path resolvers (package-private)
// ---------------------------------------------------------------------------

func resolveAlibabaImageSubmitPath(modelResolved string, scenarioExtensions map[string]any) string {
	defaults := []string{"/api/v1/services/aigc/multimodal-generation/generation"}
	switch resolveDashScopeImageRequestContract(modelResolved) {
	case dashScopeImageRequestContractAsyncTask:
		defaults = []string{"/api/v1/services/aigc/image-generation/generation"}
	case dashScopeImageRequestContractAsyncText2Image:
		defaults = []string{"/api/v1/services/aigc/text2image/image-synthesis"}
	}
	return FirstProviderEndpointPath(
		scenarioExtensions,
		[]string{"image_path", "image_submit_path"},
		[]string{"image_paths", "image_submit_paths"},
		defaults,
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

func resolveAlibabaTTSPath(scenarioExtensions map[string]any) string {
	return FirstProviderEndpointPath(
		scenarioExtensions,
		[]string{"tts_path", "speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/api/v1/services/aigc/multimodal-generation/generation"},
	)
}

func applyAlibabaTTSScenarioExtensions(parameters map[string]any, scenarioExtensions map[string]any) {
	if parameters == nil || len(scenarioExtensions) == 0 {
		return
	}

	instructions := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(scenarioExtensions["instructions"]),
		ValueAsString(scenarioExtensions["instruct"]),
		ValueAsString(scenarioExtensions["instruction_text"]),
	))
	if instructions != "" {
		parameters["instructions"] = instructions
	}

	if optimizeValue := FirstNonNil(
		scenarioExtensions["optimize_instructions"],
		scenarioExtensions["optimizeInstructions"],
	); optimizeValue != nil {
		parameters["optimize_instructions"] = ValueAsBool(optimizeValue)
	}
}

func resolveAlibabaSTTPath(scenarioExtensions map[string]any) string {
	return FirstProviderEndpointPath(
		scenarioExtensions,
		[]string{"stt_path", "transcription_path"},
		[]string{"stt_paths", "transcription_paths"},
		[]string{"/chat/completions"},
	)
}

func buildAlibabaImageSubmitRequest(
	modelResolved string,
	spec *runtimev1.ImageGenerateScenarioSpec,
	scenarioExtensions map[string]any,
) (string, string, map[string]any, map[string]string) {
	submitPath := resolveAlibabaImageSubmitPath(modelResolved, scenarioExtensions)
	queryPathTemplate := resolveAlibabaTaskQueryPathTemplate(scenarioExtensions)
	normalizedSize := normalizeDashScopeImageSize(spec.GetSize())
	switch resolveDashScopeImageRequestContract(modelResolved) {
	case dashScopeImageRequestContractAsyncTask:
		content := []any{
			map[string]any{
				"text": strings.TrimSpace(spec.GetPrompt()),
			},
		}
		for _, referenceImage := range spec.GetReferenceImages() {
			trimmed := strings.TrimSpace(referenceImage)
			if trimmed == "" {
				continue
			}
			content = append(content, map[string]any{
				"image": trimmed,
			})
		}
		input := map[string]any{
			"messages": []any{
				map[string]any{
					"role":    "user",
					"content": content,
				},
			},
		}
		parameters := map[string]any{}
		if n := spec.GetN(); n > 0 {
			parameters["n"] = n
		}
		if size := normalizedSize; size != "" {
			parameters["size"] = size
		}
		if ratio := strings.TrimSpace(spec.GetAspectRatio()); ratio != "" {
			parameters["aspect_ratio"] = ratio
		}
		if seed := spec.GetSeed(); seed > 0 {
			parameters["seed"] = seed
		}
		if negativePrompt := strings.TrimSpace(spec.GetNegativePrompt()); negativePrompt != "" {
			parameters["negative_prompt"] = negativePrompt
		}
		payload := map[string]any{
			"model": modelResolved,
			"input": input,
		}
		if len(parameters) > 0 {
			payload["parameters"] = parameters
		}
		if len(scenarioExtensions) > 0 {
			payload["extensions"] = scenarioExtensions
		}
		return submitPath, queryPathTemplate, payload, map[string]string{
			"X-DashScope-Async": "enable",
		}
	case dashScopeImageRequestContractAsyncText2Image:
		input := map[string]any{
			"prompt": strings.TrimSpace(spec.GetPrompt()),
		}
		if negativePrompt := strings.TrimSpace(spec.GetNegativePrompt()); negativePrompt != "" {
			input["negative_prompt"] = negativePrompt
		}
		parameters := map[string]any{}
		if n := spec.GetN(); n > 0 {
			parameters["n"] = n
		}
		if size := normalizedSize; size != "" {
			parameters["size"] = size
		}
		if ratio := strings.TrimSpace(spec.GetAspectRatio()); ratio != "" {
			parameters["aspect_ratio"] = ratio
		}
		if seed := spec.GetSeed(); seed > 0 {
			parameters["seed"] = seed
		}
		payload := map[string]any{
			"model": modelResolved,
			"input": input,
		}
		if len(parameters) > 0 {
			payload["parameters"] = parameters
		}
		if len(scenarioExtensions) > 0 {
			payload["extensions"] = scenarioExtensions
		}
		return submitPath, queryPathTemplate, payload, map[string]string{
			"X-DashScope-Async": "enable",
		}
	default:
		// qwen-image-2.0 / z-image / flux image generation follows the
		// synchronous multimodal contract, while wan stays on async tasks.
		content := []any{
			map[string]any{
				"text": strings.TrimSpace(spec.GetPrompt()),
			},
		}
		for _, referenceImage := range spec.GetReferenceImages() {
			trimmed := strings.TrimSpace(referenceImage)
			if trimmed == "" {
				continue
			}
			content = append(content, map[string]any{
				"image": trimmed,
			})
		}
		input := map[string]any{
			"messages": []any{
				map[string]any{
					"role":    "user",
					"content": content,
				},
			},
		}
		parameters := map[string]any{}
		if n := spec.GetN(); n > 0 {
			parameters["n"] = n
		}
		if size := normalizedSize; size != "" {
			parameters["size"] = size
		}
		if ratio := strings.TrimSpace(spec.GetAspectRatio()); ratio != "" {
			parameters["aspect_ratio"] = ratio
		}
		if quality := strings.TrimSpace(spec.GetQuality()); quality != "" {
			parameters["quality"] = quality
		}
		if style := strings.TrimSpace(spec.GetStyle()); style != "" {
			parameters["style"] = style
		}
		if seed := spec.GetSeed(); seed > 0 {
			parameters["seed"] = seed
		}
		if negativePrompt := strings.TrimSpace(spec.GetNegativePrompt()); negativePrompt != "" {
			parameters["negative_prompt"] = negativePrompt
		}
		if mask := strings.TrimSpace(spec.GetMask()); mask != "" {
			parameters["mask"] = mask
		}
		if responseFormat := strings.TrimSpace(spec.GetResponseFormat()); responseFormat != "" {
			parameters["format"] = responseFormat
		}
		payload := map[string]any{
			"model": modelResolved,
			"input": input,
		}
		if len(parameters) > 0 {
			payload["parameters"] = parameters
		}
		if len(scenarioExtensions) > 0 {
			payload["extensions"] = scenarioExtensions
		}
		return submitPath, queryPathTemplate, payload, nil
	}
}

type dashScopeImageRequestContract int

const (
	dashScopeImageRequestContractSyncMultimodal dashScopeImageRequestContract = iota
	dashScopeImageRequestContractAsyncTask
	dashScopeImageRequestContractAsyncText2Image
)

func resolveDashScopeImageRequestContract(modelResolved string) dashScopeImageRequestContract {
	normalized := strings.ToLower(strings.TrimSpace(StripProviderModelPrefix(modelResolved, "dashscope")))
	switch {
	case strings.HasPrefix(normalized, "wan2.6"):
		return dashScopeImageRequestContractAsyncTask
	case strings.HasPrefix(normalized, "wan2.5-t2i"):
		return dashScopeImageRequestContractAsyncTask
	case normalized == "qwen-image":
		return dashScopeImageRequestContractAsyncText2Image
	case normalized == "qwen-image-plus":
		return dashScopeImageRequestContractAsyncText2Image
	default:
		return dashScopeImageRequestContractSyncMultimodal
	}
}

func normalizeDashScopeImageSize(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || strings.Contains(trimmed, "*") {
		return trimmed
	}

	normalized := strings.ReplaceAll(strings.ToLower(trimmed), "×", "x")
	normalized = strings.ReplaceAll(normalized, "X", "x")
	parts := strings.Split(normalized, "x")
	if len(parts) != 2 {
		return trimmed
	}
	if _, err := strconv.Atoi(strings.TrimSpace(parts[0])); err != nil {
		return trimmed
	}
	if _, err := strconv.Atoi(strings.TrimSpace(parts[1])); err != nil {
		return trimmed
	}
	return strings.TrimSpace(parts[0]) + "*" + strings.TrimSpace(parts[1])
}
