package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// The query returns a file identity, not the download locator. This metadata
// request stays on the original admitted Connector; body IO uses the existing
// credential-free artifact opener.
// https://platform.minimax.io/docs/api-reference/file-management-retrieve
func retrieveMiniMaxVideoSource(ctx context.Context, cfg MediaAdapterConfig, query map[string]any) (nativeArtifactSource, error) {
	invalid := func() (nativeArtifactSource, error) {
		return nativeArtifactSource{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	fileID := strings.TrimSpace(ValueAsString(query["file_id"]))
	expectedID, err := strconv.ParseInt(fileID, 10, 64)
	if err != nil {
		return invalid()
	}
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodGet, JoinURL(cfg.BaseURL, "/v1/files/retrieve?file_id="+url.QueryEscape(fileID)), nil)
	if err != nil {
		return nativeArtifactSource{}, err
	}
	request.Header.Set("Accept", "application/json")
	applyProviderRequestHeaders(request, cfg.Headers)
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	response, err := client.Do(request)
	if err != nil {
		return nativeArtifactSource{}, MapProviderRequestError(err)
	}
	defer response.Body.Close()
	raw, err := readLimitedResponseBody(response.Body, maxJSONOrBinaryResponseBytes)
	if err != nil {
		return nativeArtifactSource{}, providerResponseDecodeError(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure map[string]any
		_ = json.Unmarshal(raw, &failure)
		return nativeArtifactSource{}, MapProviderHTTPError(response.StatusCode, failure)
	}
	// Retrieve declares file_id as integer/int64. Decode directly into int64:
	// routing it through map[string]any would irreversibly round IDs above 2^53.
	var payload struct {
		File *struct {
			ID          *int64 `json:"file_id"`
			DownloadURL string `json:"download_url"`
		} `json:"file"`
		Base *struct {
			StatusCode *int `json:"status_code"`
		} `json:"base_resp"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nativeArtifactSource{}, providerResponseDecodeError(err)
	}
	if payload.Base == nil || payload.Base.StatusCode == nil || *payload.Base.StatusCode != 0 || payload.File == nil || payload.File.ID == nil || *payload.File.ID != expectedID {
		return invalid()
	}
	locator := strings.TrimSpace(payload.File.DownloadURL)
	u, err := url.Parse(locator)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return invalid()
	}
	return nativeArtifactSource{uri: locator, mime: "video/mp4"}, nil
}

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
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_IMAGE:
		return executeMiniMaxImage(ctx, cfg, req, modelResolved, extractScenarioExtensions)
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
		if speed := scenarioSpeechSpeed(spec); speed > 0 {
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
			"model": modelResolved,
			"input": strings.TrimSpace(spec.GetText()),
			"text":  strings.TrimSpace(spec.GetText()),
		}
		if voice := strings.TrimSpace(scenarioVoiceRef(spec)); voice != "" {
			openAIPayload["voice"] = voice
		}
		if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
			openAIPayload["language"] = language
		}
		if emotion := strings.TrimSpace(spec.GetEmotion()); emotion != "" {
			openAIPayload["emotion"] = emotion
		}
		if speed := scenarioSpeechSpeed(spec); speed > 0 {
			openAIPayload["speed"] = speed
		}
		if pitch := spec.GetPitch(); pitch != 0 {
			openAIPayload["pitch"] = pitch
		}
		if volume := spec.GetVolume(); volume > 0 {
			openAIPayload["volume"] = volume
		}
		if sampleRate := spec.GetSampleRateHz(); sampleRate > 0 {
			openAIPayload["sample_rate_hz"] = sampleRate
		}
		if audioFormat := strings.TrimSpace(spec.GetAudioFormat()); audioFormat != "" {
			openAIPayload["audio_format"] = audioFormat
			openAIPayload["response_format"] = audioFormat
		}
		if len(scenarioExtensions) > 0 {
			openAIPayload["extensions"] = scenarioExtensions
		}
		paths := resolveMiniMaxSpeechPaths()
		var firstNotFoundErr error
		var firstOtherErr error
		for _, endpointPath := range paths {
			payload := openAIPayload
			if isMiniMaxNativeTTSPath(endpointPath) {
				payload = miniMaxPayload
			}
			body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, endpointPath), apiKey, payload, nil)
			if err != nil {
				if status.Code(err) == codes.NotFound {
					if firstNotFoundErr == nil {
						firstNotFoundErr = err
					}
					continue
				}
				return nil, nil, "", err
			}
			artifactBytes, mimeType := ExtractSpeechArtifactFromResponseBody(ctx, body)
			if len(artifactBytes) == 0 {
				if firstOtherErr == nil {
					firstOtherErr = grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
				}
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
			return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
		}
		if firstOtherErr != nil {
			return nil, nil, "", firstOtherErr
		}
		if firstNotFoundErr != nil {
			return nil, nil, "", grpcerr.WrapWithReasonCode(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
				firstNotFoundErr,
				grpcerr.ReasonOptions{Message: "provider speech endpoint is unsupported"},
			)
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
		ApplyTranscriptionSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
	}

	// Only video uses the task create/query/file-retrieve protocol.
	if scenarioModal(req) != runtimev1.Modal_MODAL_VIDEO {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioVideoSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	submitPath, queryPath, defaultMIME := "/v1/video_generation", "/v1/query/video_generation", "video/mp4"
	prompt := VideoPrompt(spec)
	submitPayload := map[string]any{
		"model":  modelResolved,
		"prompt": prompt,
	}
	if videoSpec := scenarioVideoSpec(req); videoSpec != nil {
		videoPayload, err := miniMaxVideoSubmitPayload(modelResolved, videoSpec)
		if err != nil {
			return nil, nil, "", err
		}
		for key, value := range videoPayload {
			submitPayload[key] = value
		}
	}
	if opts := StructToMap(extractScenarioExtensions(req)); len(opts) > 0 {
		submitPayload["extensions"] = opts
	}
	ctx = originalControlRequest(ctx)
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	submitResp := map[string]any{}
	if err := DoJSONRequest(nativeCreateRequest(ctx), http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
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
	artifact := BinaryArtifact(defaultMIME, nil, map[string]any{"adapter": AdapterMiniMaxTask})
	if spec := scenarioVideoSpec(req); spec != nil {
		ApplyVideoSpecMetadata(artifact, spec)
	}
	_, err := publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterMiniMaxTask, TaskID: providerJobID, QueryPathTemplate: queryPath + "?task_id={task_id}", Artifact: artifact})
	return nil, nil, providerJobID, err
}

func miniMaxVideoSubmitPayload(modelResolved string, spec *runtimev1.VideoGenerateScenarioSpec) (map[string]any, error) {
	if spec == nil || strings.TrimSpace(VideoPrompt(spec)) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if !strings.EqualFold(strings.TrimSpace(modelResolved), "MiniMax-Hailuo-2.3") {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if VideoNegativePrompt(spec) != "" || VideoRatio(spec) != "" || VideoFrames(spec) > 0 || VideoFPS(spec) > 0 ||
		VideoSeed(spec) != 0 || VideoCameraFixed(spec) || VideoGenerateAudio(spec) || VideoDraft(spec) ||
		VideoServiceTier(spec) != "" || VideoExecutionExpiresAfterSec(spec) > 0 || VideoReturnLastFrame(spec) ||
		len(VideoReferenceVideoURIs(spec)) > 0 || len(VideoReferenceAudioURIs(spec)) > 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	firstFrame := strings.TrimSpace(VideoFirstFrameURI(spec))
	lastFrame := strings.TrimSpace(VideoLastFrameURI(spec))
	referenceImages := VideoReferenceImageURIs(spec)
	switch VideoModeValue(spec) {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if firstFrame != "" || lastFrame != "" || len(referenceImages) > 0 {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if firstFrame == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if lastFrame != "" || len(referenceImages) > 0 {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	default:
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}

	payload := map[string]any{
		"model":  strings.TrimSpace(modelResolved),
		"prompt": VideoPrompt(spec),
	}
	if firstFrame != "" {
		payload["first_frame_image"] = firstFrame
	}
	if duration := VideoDurationSec(spec); duration > 0 {
		payload["duration"] = duration
	}
	if resolution := strings.ToUpper(VideoResolution(spec)); resolution != "" {
		payload["resolution"] = resolution
	}
	if spec.GetOptions() != nil && spec.GetOptions().Watermark != nil {
		payload["aigc_watermark"] = spec.GetOptions().GetWatermark()
	}
	return payload, nil
}

// ExecuteMiniMaxTranscribe uses the single adapter-owned MiniMax endpoint and
// delegates the multipart POST to ExecuteGLMTranscribe.
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
	paths := resolveMiniMaxTranscriptionPaths()
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
		return "", "", grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
			lastErr,
			grpcerr.ReasonOptions{Message: "provider transcription endpoint is unsupported"},
		)
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

func resolveMiniMaxSpeechPaths() []string {
	return providerEndpointPaths([]string{"/v1/t2a_v2"})
}

func resolveMiniMaxTranscriptionPaths() []string {
	return providerEndpointPaths([]string{"/v1/audio/transcriptions"})
}

func isMiniMaxNativeTTSPath(endpointPath string) bool {
	lower := strings.ToLower(strings.TrimSpace(endpointPath))
	return strings.Contains(lower, "t2a")
}
