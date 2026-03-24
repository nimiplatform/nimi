package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const (
	AdapterStabilityMusic  = "stability_music_adapter"
	AdapterSoundverseMusic = "soundverse_music_adapter"
	AdapterMubertMusic     = "mubert_music_adapter"
	AdapterLoudlyMusic     = "loudly_music_adapter"
	AdapterLlamaMusic      = "llama_music_adapter"
	AdapterSidecarMusic    = "sidecar_music_adapter"
)

func ExecuteStabilityMusic(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if scenarioModal(req) != runtimev1.Modal_MODAL_MUSIC {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioMusicSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	extensions := ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())
	_, iteration, err := NormalizeMusicIterationExtension(extensions)
	if err != nil {
		return nil, nil, "", err
	}

	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.stability.ai"
	}
	backend := NewBackend("cloud-stability", baseURL, strings.TrimSpace(cfg.APIKey), 5*time.Minute)
	resolvedModel := StripProviderModelPrefix(modelResolved, "stability")
	if resolvedModel == "" {
		resolvedModel = "stable-audio-2"
	}

	var body *JSONOrBinaryBody
	if iteration == nil {
		payload := map[string]any{
			"model":  resolvedModel,
			"prompt": strings.TrimSpace(spec.GetPrompt()),
		}
		if spec.GetDurationSeconds() > 0 {
			payload["duration"] = spec.GetDurationSeconds()
		}
		if negativePrompt := strings.TrimSpace(spec.GetNegativePrompt()); negativePrompt != "" {
			payload["negative_prompt"] = negativePrompt
		}
		body, err = DoJSONOrBinaryRequest(
			ctx,
			http.MethodPost,
			JoinURL(baseURL, "/v2beta/audio/stable-audio-2/text-to-audio"),
			strings.TrimSpace(cfg.APIKey),
			payload,
			cfg.Headers,
		)
	} else {
		body, err = doMultipartMusicRequest(
			ctx,
			backend,
			JoinURL(baseURL, "/v2beta/audio/stable-audio-2/audio-to-audio"),
			cfg.Headers,
			func(writer *multipart.Writer) error {
				if err := writer.WriteField("model", resolvedModel); err != nil {
					return err
				}
				if err := writer.WriteField("prompt", strings.TrimSpace(spec.GetPrompt())); err != nil {
					return err
				}
				if spec.GetDurationSeconds() > 0 {
					if err := writer.WriteField("duration", strconv.FormatInt(int64(spec.GetDurationSeconds()), 10)); err != nil {
						return err
					}
				}
				if negativePrompt := strings.TrimSpace(spec.GetNegativePrompt()); negativePrompt != "" {
					if err := writer.WriteField("negative_prompt", negativePrompt); err != nil {
						return err
					}
				}
				fileWriter, createErr := writer.CreateFormFile("audio", musicIterationFilename(iteration.SourceMIMEType))
				if createErr != nil {
					return createErr
				}
				audioBytes, decodeErr := decodeMusicIterationBase64(iteration.SourceAudioBase64)
				if decodeErr != nil {
					return decodeErr
				}
				if _, writeErr := fileWriter.Write(audioBytes); writeErr != nil {
					return writeErr
				}
				return nil
			},
		)
	}
	if err != nil {
		return nil, nil, "", err
	}
	if body == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return musicArtifactsFromBody(AdapterStabilityMusic, body, spec, extensions, ""), ArtifactUsage(spec.GetPrompt(), body.Bytes, 480), "", nil
}

func ExecuteSoundverseMusic(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if scenarioModal(req) != runtimev1.Modal_MODAL_MUSIC {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioMusicSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	extensions := ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())
	if _, iteration, err := NormalizeMusicIterationExtension(extensions); err != nil {
		return nil, nil, "", err
	} else if iteration != nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.soundverse.ai"
	}
	payload := map[string]any{
		"prompt": strings.TrimSpace(spec.GetPrompt()),
	}
	if lyrics := strings.TrimSpace(spec.GetLyrics()); lyrics != "" {
		payload["lyrics"] = lyrics
	}
	if title := strings.TrimSpace(spec.GetTitle()); title != "" {
		payload["song_name"] = title
	}
	if spec.GetDurationSeconds() > 0 {
		payload["duration"] = spec.GetDurationSeconds()
	}
	if spec.GetInstrumental() {
		payload["instrumental"] = true
	}
	if style := strings.TrimSpace(spec.GetStyle()); style != "" {
		payload["style_prompt"] = style
	}

	response := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, "/v5/generate/song/sync"), strings.TrimSpace(cfg.APIKey), payload, &response, cfg.Headers); err != nil {
		return nil, nil, "", err
	}
	backend := NewBackend("cloud-soundverse", baseURL, strings.TrimSpace(cfg.APIKey), 5*time.Minute)
	body, err := bodyFromMusicResponse(ctx, backend, response)
	if err != nil {
		return nil, nil, "", err
	}
	return musicArtifactsFromBody(AdapterSoundverseMusic, body, spec, extensions, ""), ArtifactUsage(spec.GetPrompt(), body.Bytes, 420), "", nil
}

func ExecuteMubertMusic(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if scenarioModal(req) != runtimev1.Modal_MODAL_MUSIC {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioMusicSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	extensions := ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())
	if _, iteration, err := NormalizeMusicIterationExtension(extensions); err != nil {
		return nil, nil, "", err
	} else if iteration != nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	headers := mubertHeaders(cfg)
	if len(headers) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED)
	}
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://music-api.mubert.com/api/v3"
	}
	payload := map[string]any{
		"prompt":   strings.TrimSpace(spec.GetPrompt()),
		"duration": MaxInt64(30, int64(spec.GetDurationSeconds())),
		"format":   "mp3",
		"bitrate":  192,
		"mode":     "track",
	}
	if strings.Contains(strings.ToLower(strings.TrimSpace(spec.GetStyle())), "loop") {
		payload["mode"] = "loop"
	}
	if strings.Contains(strings.ToLower(strings.TrimSpace(spec.GetStyle())), "low") {
		payload["intensity"] = "low"
	} else if strings.Contains(strings.ToLower(strings.TrimSpace(spec.GetStyle())), "medium") {
		payload["intensity"] = "medium"
	} else {
		payload["intensity"] = "high"
	}

	submitResp := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, "/public/tracks"), "", payload, &submitResp, headers); err != nil {
		return nil, nil, "", err
	}
	trackID := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(MapField(submitResp, "id")),
		ValueAsString(MapField(MapField(submitResp, "data"), "id")),
	))
	if trackID == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	backend := NewBackend("cloud-mubert", baseURL, "", 5*time.Minute)
	retryCount := int32(0)
	for {
		if ctx.Err() != nil {
			return nil, nil, trackID, MapProviderRequestError(ctx.Err())
		}
		current := submitResp
		if retryCount > 0 {
			current = map[string]any{}
			if err := DoJSONRequestWithHeaders(ctx, http.MethodGet, JoinURL(baseURL, "/public/tracks/"+trackID), "", nil, &current, headers); err != nil {
				return nil, nil, trackID, err
			}
		}
		generation := firstMapItem(MapField(MapField(current, "data"), "generations"))
		statusText := strings.ToLower(strings.TrimSpace(ValueAsString(MapField(generation, "status"))))
		audioURL := strings.TrimSpace(ValueAsString(MapField(generation, "url")))
		if audioURL != "" && (statusText == "" || statusText == "done") {
			body, err := bodyFromMusicResponse(ctx, backend, map[string]any{"audio_url": audioURL})
			if err != nil {
				return nil, nil, trackID, err
			}
			return musicArtifactsFromBody(AdapterMubertMusic, body, spec, extensions, trackID), ArtifactUsage(spec.GetPrompt(), body.Bytes, 420), trackID, nil
		}
		if statusText == "failed" || statusText == "error" {
			return nil, nil, trackID, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		retryCount++
		if updater != nil {
			updater.UpdatePollState(jobID, trackID, retryCount, timestamppb.New(time.Now().UTC().Add(1*time.Second)), statusText)
		}
		time.Sleep(1 * time.Second)
	}
}

func ExecuteLoudlyMusic(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if scenarioModal(req) != runtimev1.Modal_MODAL_MUSIC {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioMusicSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	extensions := ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())
	if _, iteration, err := NormalizeMusicIterationExtension(extensions); err != nil {
		return nil, nil, "", err
	} else if iteration != nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://soundtracks.loudly.com"
	}
	headers := cloneHeaderMap(cfg.Headers)
	if headers == nil {
		headers = map[string]string{}
	}
	if strings.TrimSpace(cfg.APIKey) != "" {
		headers["API-KEY"] = strings.TrimSpace(cfg.APIKey)
	}
	backend := NewBackend("cloud-loudly", baseURL, "", 5*time.Minute)
	body, err := doMultipartMusicRequest(
		ctx,
		backend,
		JoinURL(baseURL, "/api/ai/prompt/songs"),
		headers,
		func(writer *multipart.Writer) error {
			if err := writer.WriteField("prompt", strings.TrimSpace(spec.GetPrompt())); err != nil {
				return err
			}
			if spec.GetDurationSeconds() > 0 {
				if err := writer.WriteField("duration", strconv.FormatInt(int64(spec.GetDurationSeconds()), 10)); err != nil {
					return err
				}
			}
			model := strings.TrimSpace(StripProviderModelPrefix(modelResolved, "loudly"))
			if model == "" {
				model = "VEGA_2"
			}
			if err := writer.WriteField("model", model); err != nil {
				return err
			}
			return nil
		},
	)
	if err != nil {
		return nil, nil, "", err
	}
	return musicArtifactsFromBody(AdapterLoudlyMusic, body, spec, extensions, ""), ArtifactUsage(spec.GetPrompt(), body.Bytes, 420), "", nil
}

func ExecuteLlamaMusic(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if scenarioModal(req) != runtimev1.Modal_MODAL_MUSIC {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioMusicSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	extensions := ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())
	if _, iteration, err := NormalizeMusicIterationExtension(extensions); err != nil {
		return nil, nil, "", err
	} else if iteration != nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	resolvedModel := strings.TrimSpace(StripProviderModelPrefix(modelResolved, "llama"))
	if resolvedModel == "" {
		resolvedModel = strings.TrimSpace(modelResolved)
	}

	type candidate struct {
		path    string
		payload map[string]any
	}
	candidates := []candidate{}
	if strings.Contains(strings.ToLower(resolvedModel), "musicgen") {
		candidates = append(candidates, candidate{
			path: "/tts",
			payload: map[string]any{
				"backend": "transformers-musicgen",
				"model":   resolvedModel,
				"input":   strings.TrimSpace(spec.GetPrompt()),
			},
		})
	}
	candidates = append(candidates,
		candidate{
			path: "/v1/audio/speech",
			payload: map[string]any{
				"model": resolvedModel,
				"input": strings.TrimSpace(spec.GetPrompt()),
			},
		},
		candidate{
			path: "/sound",
			payload: map[string]any{
				"model": resolvedModel,
				"input": strings.TrimSpace(spec.GetPrompt()),
			},
		},
	)

	var body *JSONOrBinaryBody
	var lastErr error
	for _, item := range candidates {
		body, lastErr = DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, item.path), strings.TrimSpace(cfg.APIKey), item.payload, cfg.Headers)
		if lastErr == nil {
			return musicArtifactsFromBody(AdapterLlamaMusic, body, spec, extensions, ""), ArtifactUsage(spec.GetPrompt(), body.Bytes, 360), "", nil
		}
		if grpcStatusCode(lastErr) != codes.NotFound {
			break
		}
	}
	if lastErr != nil {
		return nil, nil, "", lastErr
	}
	return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

func ExecuteSidecarMusic(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if scenarioModal(req) != runtimev1.Modal_MODAL_MUSIC {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioMusicSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	extensions := ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())
	if _, iteration, err := NormalizeMusicIterationExtension(extensions); err != nil {
		return nil, nil, "", err
	} else if iteration != nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	payload := map[string]any{
		"model":            strings.TrimSpace(modelResolved),
		"prompt":           strings.TrimSpace(spec.GetPrompt()),
		"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
		"lyrics":           strings.TrimSpace(spec.GetLyrics()),
		"style":            strings.TrimSpace(spec.GetStyle()),
		"title":            strings.TrimSpace(spec.GetTitle()),
		"duration_seconds": spec.GetDurationSeconds(),
		"instrumental":     spec.GetInstrumental(),
	}
	body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, "/v1/music/generate"), strings.TrimSpace(cfg.APIKey), payload, cfg.Headers)
	if err != nil {
		return nil, nil, "", err
	}
	return musicArtifactsFromBody(AdapterSidecarMusic, body, spec, extensions, ""), ArtifactUsage(spec.GetPrompt(), body.Bytes, 360), "", nil
}

func scenarioMusicSpec(req *runtimev1.SubmitScenarioJobRequest) *runtimev1.MusicGenerateScenarioSpec {
	if req == nil || req.GetSpec() == nil {
		return nil
	}
	return req.GetSpec().GetMusicGenerate()
}

func doMultipartMusicRequest(
	ctx context.Context,
	backend *Backend,
	targetURL string,
	headers map[string]string,
	writeFields func(*multipart.Writer) error,
) (*JSONOrBinaryBody, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writeFields(writer); err != nil {
		return nil, MapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return nil, MapProviderRequestError(err)
	}
	request, err := backend.newRequest(ctx, http.MethodPost, targetURL, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Accept", "application/json")
	if strings.TrimSpace(backend.apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(backend.apiKey))
	}
	for key, value := range headers {
		headerName := strings.TrimSpace(key)
		headerValue := strings.TrimSpace(value)
		if headerName == "" || headerValue == "" {
			continue
		}
		request.Header.Set(headerName, headerValue)
	}
	response, err := backend.do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return nil, MapProviderHTTPError(response.StatusCode, payload)
	}
	raw, err := readLimitedResponseBody(response.Body, maxJSONOrBinaryResponseBytes)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	contentType := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Type")))
	if strings.Contains(contentType, "application/json") {
		payload := map[string]any{}
		if err := json.Unmarshal(raw, &payload); err == nil {
			return bodyFromMusicResponse(ctx, backend, payload)
		}
	}
	return &JSONOrBinaryBody{Bytes: raw, MIME: contentType}, nil
}

func bodyFromMusicResponse(ctx context.Context, backend *Backend, response map[string]any) (*JSONOrBinaryBody, error) {
	audioURL := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(response["audio_url"]),
		ValueAsString(response["url"]),
		ValueAsString(response["music_file_path"]),
		ValueAsString(MapField(response, "music_file_path")),
		ValueAsString(MapField(response, "audio_url")),
		ValueAsString(MapField(MapField(response, "data"), "audio_url")),
		ValueAsString(MapField(MapField(response, "data"), "url")),
		ValueAsString(MapField(MapField(response, "data"), "music_file_path")),
		ValueAsString(MapField(firstMapItem(MapField(MapField(response, "data"), "generations")), "url")),
	))
	audioBase64 := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(response["audio"]),
		ValueAsString(response["audio_base64"]),
		ValueAsString(MapField(response, "audio")),
		ValueAsString(MapField(response, "audio_base64")),
		ValueAsString(MapField(MapField(response, "data"), "audio")),
		ValueAsString(MapField(MapField(response, "data"), "audio_base64")),
	))
	payload, err := backend.DecodeMedia(ctx, audioBase64, audioURL)
	if err != nil {
		return nil, err
	}
	return &JSONOrBinaryBody{Bytes: payload, MIME: ""}, nil
}

func musicArtifactsFromBody(
	adapter string,
	body *JSONOrBinaryBody,
	spec *runtimev1.MusicGenerateScenarioSpec,
	extensions map[string]any,
	providerJobID string,
) []*runtimev1.ScenarioArtifact {
	artifactMeta := map[string]any{
		"adapter":          adapter,
		"prompt":           strings.TrimSpace(spec.GetPrompt()),
		"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
		"lyrics":           strings.TrimSpace(spec.GetLyrics()),
		"style":            strings.TrimSpace(spec.GetStyle()),
		"title":            strings.TrimSpace(spec.GetTitle()),
		"duration_seconds": spec.GetDurationSeconds(),
		"instrumental":     spec.GetInstrumental(),
	}
	if providerJobID != "" {
		artifactMeta["provider_job_id"] = providerJobID
	}
	if len(extensions) > 0 {
		artifactMeta["extensions"] = extensions
	}
	mimeType := strings.TrimSpace(body.MIME)
	if !strings.HasPrefix(mimeType, "audio/") {
		mimeType = resolveMusicArtifactMIME(body.Bytes)
	}
	artifact := BinaryArtifact(mimeType, body.Bytes, artifactMeta)
	ApplyMusicSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}
}

func resolveMusicArtifactMIME(payload []byte) string {
	detected := strings.TrimSpace(http.DetectContentType(payload))
	if strings.HasPrefix(detected, "audio/") {
		return detected
	}
	return "audio/mpeg"
}

func mubertHeaders(cfg MediaAdapterConfig) map[string]string {
	headers := cloneHeaderMap(cfg.Headers)
	if len(headers) > 0 {
		return headers
	}
	raw := strings.TrimSpace(cfg.APIKey)
	if raw == "" {
		return nil
	}
	parts := strings.SplitN(raw, "::", 2)
	if len(parts) != 2 {
		return nil
	}
	return map[string]string{
		"customer-id":  strings.TrimSpace(parts[0]),
		"access-token": strings.TrimSpace(parts[1]),
	}
}

func cloneHeaderMap(headers map[string]string) map[string]string {
	if len(headers) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(headers))
	for key, value := range headers {
		headerName := strings.TrimSpace(key)
		headerValue := strings.TrimSpace(value)
		if headerName == "" || headerValue == "" {
			continue
		}
		cloned[headerName] = headerValue
	}
	if len(cloned) == 0 {
		return nil
	}
	return cloned
}

func firstMapItem(value any) map[string]any {
	items, ok := value.([]any)
	if !ok || len(items) == 0 {
		return nil
	}
	first, _ := items[0].(map[string]any)
	return first
}

func musicIterationFilename(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "audio/wav", "audio/x-wav":
		return "source.wav"
	case "audio/mp4", "audio/m4a", "audio/x-m4a":
		return "source.m4a"
	case "audio/ogg":
		return "source.ogg"
	default:
		return "source.mp3"
	}
}

func grpcStatusCode(err error) codes.Code {
	if err == nil {
		return codes.OK
	}
	return status.Code(err)
}
