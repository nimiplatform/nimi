package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

var (
	dashScopeSpeechVoicePresets = []string{
		"Cherry", "Serena", "Ethan", "Chelsie", "Aura", "Breeze", "Haruto", "Maple", "Sierra", "River",
	}
	volcengineSpeechVoicePresets = []string{
		"BV001_streaming", "BV002_streaming",
	}
)

func normalizeSpeechVoiceFromPresets(voice string, presets []string, fallback string) string {
	if len(presets) == 0 {
		return strings.TrimSpace(voice)
	}
	fallbackVoice := strings.TrimSpace(fallback)
	if fallbackVoice == "" {
		fallbackVoice = strings.TrimSpace(presets[0])
	}
	trimmed := strings.TrimSpace(voice)
	if trimmed == "" {
		return fallbackVoice
	}
	trimmedLower := strings.ToLower(trimmed)
	for _, preset := range presets {
		candidate := strings.TrimSpace(preset)
		if candidate == "" {
			continue
		}
		if candidate == trimmed || strings.ToLower(candidate) == trimmedLower {
			return candidate
		}
	}
	return fallbackVoice
}

func normalizeSpeechVoiceForTarget(backendName string, modelID string, requestedVoice string) string {
	backendLower := strings.ToLower(strings.TrimSpace(backendName))
	modelLower := strings.ToLower(strings.TrimSpace(modelID))
	voice := strings.TrimSpace(requestedVoice)

	// DashScope TTS models are often called via openai-compatible connectors.
	// When stale OpenAI voice IDs (e.g. alloy) leak through, coerce to
	// a provider-supported preset to avoid AI_INPUT_INVALID.
	if strings.Contains(backendLower, "dashscope") || strings.Contains(modelLower, "qwen3-tts") || strings.Contains(modelLower, "qwen-tts") {
		return normalizeSpeechVoiceFromPresets(voice, dashScopeSpeechVoicePresets, "Cherry")
	}

	if strings.Contains(backendLower, "volcengine") || strings.Contains(modelLower, "volcengine") {
		return normalizeSpeechVoiceFromPresets(voice, volcengineSpeechVoicePresets, "BV001_streaming")
	}

	if voice == "" {
		return "alloy"
	}
	return voice
}

// Embed sends an embeddings request.
func (b *Backend) Embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	type embeddingsRequest struct {
		Model string   `json:"model"`
		Input []string `json:"input"`
	}
	type embeddingsResponse struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
		Usage struct {
			PromptTokens int64 `json:"prompt_tokens"`
			TotalTokens  int64 `json:"total_tokens"`
		} `json:"usage"`
	}

	reqInputs := make([]string, 0, len(inputs))
	for _, input := range inputs {
		trimmed := strings.TrimSpace(input)
		if trimmed == "" {
			continue
		}
		reqInputs = append(reqInputs, trimmed)
	}
	if len(reqInputs) == 0 {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	var respBody embeddingsResponse
	if err := b.postJSON(ctx, "/v1/embeddings", embeddingsRequest{
		Model: modelID,
		Input: reqInputs,
	}, &respBody); err != nil {
		return nil, nil, err
	}
	if len(respBody.Data) == 0 {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	vectors := make([]*structpb.ListValue, 0, len(respBody.Data))
	for _, item := range respBody.Data {
		values := make([]*structpb.Value, 0, len(item.Embedding))
		for _, value := range item.Embedding {
			values = append(values, structpb.NewNumberValue(value))
		}
		vectors = append(vectors, &structpb.ListValue{Values: values})
	}

	usage := &runtimev1.UsageStats{
		InputTokens:  MaxInt64(0, respBody.Usage.PromptTokens),
		OutputTokens: MaxInt64(0, respBody.Usage.TotalTokens-respBody.Usage.PromptTokens),
		ComputeMs:    0,
	}
	if usage.GetInputTokens() == 0 && usage.GetOutputTokens() == 0 {
		totalInput := int64(0)
		for _, input := range reqInputs {
			totalInput += EstimateTokens(input)
		}
		usage = &runtimev1.UsageStats{
			InputTokens:  totalInput,
			OutputTokens: int64(len(vectors)),
			ComputeMs:    MaxInt64(4, int64(len(vectors))*3),
		}
	}
	return vectors, usage, nil
}

// Transcribe sends a speech-to-text request.
func (b *Backend) Transcribe(
	ctx context.Context,
	modelID string,
	spec *runtimev1.SpeechTranscriptionSpec,
	audio []byte,
	mimeType string,
) (string, *runtimev1.UsageStats, error) {
	if len(audio) == 0 {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("model", modelID); err != nil {
		return "", nil, MapProviderRequestError(err)
	}
	if strings.TrimSpace(mimeType) != "" {
		if err := writer.WriteField("mime_type", strings.TrimSpace(mimeType)); err != nil {
			return "", nil, MapProviderRequestError(err)
		}
	}
	if spec != nil {
		if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
			if err := writer.WriteField("language", language); err != nil {
				return "", nil, MapProviderRequestError(err)
			}
		}
		if prompt := strings.TrimSpace(spec.GetPrompt()); prompt != "" {
			if err := writer.WriteField("prompt", prompt); err != nil {
				return "", nil, MapProviderRequestError(err)
			}
		}
		if format := strings.TrimSpace(spec.GetResponseFormat()); format != "" {
			if err := writer.WriteField("response_format", format); err != nil {
				return "", nil, MapProviderRequestError(err)
			}
		}
		if spec.GetTimestamps() {
			if err := writer.WriteField("timestamps", "true"); err != nil {
				return "", nil, MapProviderRequestError(err)
			}
		}
		if spec.GetDiarization() {
			if err := writer.WriteField("diarization", "true"); err != nil {
				return "", nil, MapProviderRequestError(err)
			}
		}
		if spec.GetSpeakerCount() > 0 {
			if err := writer.WriteField("speaker_count", strconv.FormatInt(int64(spec.GetSpeakerCount()), 10)); err != nil {
				return "", nil, MapProviderRequestError(err)
			}
		}
		if options := StructToMap(spec.GetProviderOptions()); len(options) > 0 {
			raw, marshalErr := json.Marshal(options)
			if marshalErr != nil {
				return "", nil, MapProviderRequestError(marshalErr)
			}
			if err := writer.WriteField("provider_options", string(raw)); err != nil {
				return "", nil, MapProviderRequestError(err)
			}
		}
	}
	fileWriter, err := writer.CreateFormFile("file", "audio.bin")
	if err != nil {
		return "", nil, MapProviderRequestError(err)
	}
	if _, err := fileWriter.Write(audio); err != nil {
		return "", nil, MapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return "", nil, MapProviderRequestError(err)
	}

	endpoint := b.baseURL + "/v1/audio/transcriptions"
	request, err := b.newRequest(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return "", nil, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if b.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+b.apiKey)
	}

	response, err := b.client.Do(request)
	if err != nil {
		return "", nil, MapProviderRequestError(err)
	}
	defer response.Body.Close()

	type transcriptionResponse struct {
		Text string `json:"text"`
	}
	var out transcriptionResponse
	if err := DecodeResponseJSON(response, &out); err != nil {
		return "", nil, err
	}
	text := strings.TrimSpace(out.Text)
	if text == "" {
		return "", nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	usage := &runtimev1.UsageStats{
		InputTokens:  MaxInt64(1, int64(len(audio)/256)),
		OutputTokens: EstimateTokens(text),
		ComputeMs:    MaxInt64(10, int64(len(audio)/64)),
	}
	return text, usage, nil
}

// GenerateImage sends an image generation request.
func (b *Backend) GenerateImage(ctx context.Context, modelID string, spec *runtimev1.ImageGenerationSpec) ([]byte, *runtimev1.UsageStats, error) {
	type imageRequest struct {
		Model           string         `json:"model"`
		Prompt          string         `json:"prompt"`
		NegativePrompt  string         `json:"negative_prompt,omitempty"`
		N               int32          `json:"n,omitempty"`
		Size            string         `json:"size,omitempty"`
		AspectRatio     string         `json:"aspect_ratio,omitempty"`
		Quality         string         `json:"quality,omitempty"`
		Style           string         `json:"style,omitempty"`
		Seed            int64          `json:"seed,omitempty"`
		ReferenceImages []string       `json:"reference_images,omitempty"`
		Mask            string         `json:"mask,omitempty"`
		ResponseFormat  string         `json:"response_format,omitempty"`
		ProviderOptions map[string]any `json:"provider_options,omitempty"`
	}
	type imageResponse struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}

	prompt := ""
	if spec != nil {
		prompt = strings.TrimSpace(spec.GetPrompt())
	}
	responseFormat := "b64_json"
	if spec != nil && strings.TrimSpace(spec.GetResponseFormat()) != "" {
		responseFormat = strings.TrimSpace(spec.GetResponseFormat())
	}

	var respBody imageResponse
	err := b.postJSON(ctx, "/v1/images/generations", imageRequest{
		Model:           modelID,
		Prompt:          prompt,
		NegativePrompt:  strings.TrimSpace(spec.GetNegativePrompt()),
		N:               spec.GetN(),
		Size:            strings.TrimSpace(spec.GetSize()),
		AspectRatio:     strings.TrimSpace(spec.GetAspectRatio()),
		Quality:         strings.TrimSpace(spec.GetQuality()),
		Style:           strings.TrimSpace(spec.GetStyle()),
		Seed:            spec.GetSeed(),
		ReferenceImages: append([]string(nil), spec.GetReferenceImages()...),
		Mask:            strings.TrimSpace(spec.GetMask()),
		ResponseFormat:  responseFormat,
		ProviderOptions: StructToMap(spec.GetProviderOptions()),
	}, &respBody)
	if err != nil {
		return nil, nil, err
	}
	if len(respBody.Data) == 0 {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	payload, err := b.DecodeMedia(respBody.Data[0].B64JSON, respBody.Data[0].URL)
	if err != nil {
		return nil, nil, err
	}
	usage := ArtifactUsage(prompt, payload, 180)
	return payload, usage, nil
}

// GenerateVideo sends a video generation request.
func (b *Backend) GenerateVideo(ctx context.Context, modelID string, spec *runtimev1.VideoGenerationSpec) ([]byte, *runtimev1.UsageStats, error) {
	type videoRequest struct {
		Model           string         `json:"model"`
		Prompt          string         `json:"prompt"`
		NegativePrompt  string         `json:"negative_prompt,omitempty"`
		DurationSec     int32          `json:"duration_sec,omitempty"`
		Fps             int32          `json:"fps,omitempty"`
		Resolution      string         `json:"resolution,omitempty"`
		AspectRatio     string         `json:"aspect_ratio,omitempty"`
		Seed            int64          `json:"seed,omitempty"`
		FirstFrameURI   string         `json:"first_frame_uri,omitempty"`
		LastFrameURI    string         `json:"last_frame_uri,omitempty"`
		CameraMotion    string         `json:"camera_motion,omitempty"`
		ProviderOptions map[string]any `json:"provider_options,omitempty"`
	}
	type videoResponse struct {
		Data []struct {
			B64MP4  string `json:"b64_mp4"`
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
		Output []struct {
			B64MP4 string `json:"b64_mp4"`
			URL    string `json:"url"`
		} `json:"output"`
	}

	prompt := ""
	if spec != nil {
		prompt = strings.TrimSpace(spec.GetPrompt())
	}

	paths := []string{"/v1/video/generations", "/v1/videos/generations"}
	var respBody videoResponse
	var err error
	for _, path := range paths {
		err = b.postJSON(ctx, path, videoRequest{
			Model:           modelID,
			Prompt:          prompt,
			NegativePrompt:  strings.TrimSpace(spec.GetNegativePrompt()),
			DurationSec:     spec.GetDurationSec(),
			Fps:             spec.GetFps(),
			Resolution:      strings.TrimSpace(spec.GetResolution()),
			AspectRatio:     strings.TrimSpace(spec.GetAspectRatio()),
			Seed:            spec.GetSeed(),
			FirstFrameURI:   strings.TrimSpace(spec.GetFirstFrameUri()),
			LastFrameURI:    strings.TrimSpace(spec.GetLastFrameUri()),
			CameraMotion:    strings.TrimSpace(spec.GetCameraMotion()),
			ProviderOptions: StructToMap(spec.GetProviderOptions()),
		}, &respBody)
		if err == nil {
			break
		}
		if status.Code(err) == codes.NotFound {
			continue
		}
		return nil, nil, err
	}
	if err != nil {
		return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}

	var b64Data string
	var mediaURL string
	if len(respBody.Data) > 0 {
		b64Data = FirstNonEmpty(respBody.Data[0].B64MP4, respBody.Data[0].B64JSON)
		mediaURL = respBody.Data[0].URL
	}
	if b64Data == "" && mediaURL == "" && len(respBody.Output) > 0 {
		b64Data = respBody.Output[0].B64MP4
		mediaURL = respBody.Output[0].URL
	}
	payload, err := b.DecodeMedia(b64Data, mediaURL)
	if err != nil {
		return nil, nil, err
	}
	usage := ArtifactUsage(prompt, payload, 420)
	return payload, usage, nil
}

// SynthesizeSpeech sends a text-to-speech request.
func (b *Backend) SynthesizeSpeech(ctx context.Context, modelID string, spec *runtimev1.SpeechSynthesisSpec) ([]byte, *runtimev1.UsageStats, error) {
	type speechRequest struct {
		Model           string         `json:"model"`
		Input           string         `json:"input"`
		Voice           string         `json:"voice,omitempty"`
		Language        string         `json:"language,omitempty"`
		AudioFormat     string         `json:"audio_format,omitempty"`
		SampleRateHz    int32          `json:"sample_rate_hz,omitempty"`
		Speed           float32        `json:"speed,omitempty"`
		Pitch           float32        `json:"pitch,omitempty"`
		Volume          float32        `json:"volume,omitempty"`
		Emotion         string         `json:"emotion,omitempty"`
		ProviderOptions map[string]any `json:"provider_options,omitempty"`
	}
	text := ""
	requestedVoice := ""
	if spec != nil {
		text = strings.TrimSpace(spec.GetText())
		requestedVoice = strings.TrimSpace(spec.GetVoice())
	}
	voice := normalizeSpeechVoiceForTarget(b.Name, modelID, requestedVoice)
	payload, err := b.postRaw(ctx, "/v1/audio/speech", speechRequest{
		Model:           modelID,
		Input:           text,
		Voice:           voice,
		Language:        strings.TrimSpace(spec.GetLanguage()),
		AudioFormat:     strings.TrimSpace(spec.GetAudioFormat()),
		SampleRateHz:    spec.GetSampleRateHz(),
		Speed:           spec.GetSpeed(),
		Pitch:           spec.GetPitch(),
		Volume:          spec.GetVolume(),
		Emotion:         strings.TrimSpace(spec.GetEmotion()),
		ProviderOptions: StructToMap(spec.GetProviderOptions()),
	})
	if err != nil {
		return nil, nil, err
	}
	usage := ArtifactUsage(text, payload, 120)
	return payload, usage, nil
}
