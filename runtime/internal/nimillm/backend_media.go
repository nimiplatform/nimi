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

func (b *Backend) isMediaBackend() bool {
	if b == nil {
		return false
	}
	normalized := strings.ToLower(strings.TrimSpace(b.Name))
	return strings.Contains(normalized, "local-media") ||
		normalized == "media"
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
	spec *runtimev1.SpeechTranscribeScenarioSpec,
	audio []byte,
	mimeType string,
	scenarioExtensions map[string]any,
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
		if options := scenarioExtensions; len(options) > 0 {
			raw, marshalErr := json.Marshal(options)
			if marshalErr != nil {
				return "", nil, MapProviderRequestError(marshalErr)
			}
			if err := writer.WriteField("extensions", string(raw)); err != nil {
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

	response, err := b.do(request)
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

// ManagedMediaImageDiagnostics captures llama-managed media mapping diagnostics.
type ManagedMediaImageDiagnostics struct {
	LocalPrompt    string
	SourceImage    string
	RefImagesCount int
	AppliedOptions []string
	IgnoredOptions []string
}

func normalizeImageResponseFormat(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "base64", "b64_json":
		return "b64_json", nil
	case "url":
		return "url", nil
	default:
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
}

// ImportManagedMediaModelConfig dynamically imports a managed media model
// configuration through the llama management endpoint.
func (b *Backend) ImportManagedMediaModelConfig(ctx context.Context, modelConfig map[string]any) error {
	type importResponse struct {
		Success  bool   `json:"success"`
		Message  string `json:"message"`
		Error    string `json:"error"`
		Filename string `json:"filename"`
	}
	var resp importResponse
	if err := b.postJSON(ctx, "/models/import", modelConfig, &resp); err != nil {
		return err
	}
	if !resp.Success {
		message := strings.TrimSpace(resp.Error)
		if message == "" {
			message = "managed media model import failed"
		}
		return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: message,
		})
	}
	return nil
}

// GenerateImageManagedMedia sends a llama-managed image generation request.
// It supports the minimal t2i/i2i workflow (file/files/ref_images) and best-effort
// local image parameter normalization (steps->step, method->mode).
func (b *Backend) GenerateImageManagedMedia(ctx context.Context, modelID string, spec *runtimev1.ImageGenerateScenarioSpec, scenarioExtensions map[string]any) ([]byte, *runtimev1.UsageStats, *ManagedMediaImageDiagnostics, error) {
	type imageSpec struct {
		Prompt          string         `json:"prompt"`
		NegativePrompt  string         `json:"negative_prompt,omitempty"`
		N               int32          `json:"n,omitempty"`
		Size            string         `json:"size,omitempty"`
		AspectRatio     string         `json:"aspect_ratio,omitempty"`
		Quality         string         `json:"quality,omitempty"`
		Style           string         `json:"style,omitempty"`
		Seed            int64          `json:"seed,omitempty"`
		Mask            string         `json:"mask,omitempty"`
		ResponseFormat  string         `json:"response_format,omitempty"`
		Extensions      map[string]any `json:"extensions,omitempty"`
		ReferenceImages []string       `json:"reference_images,omitempty"`
	}
	type imageResponse struct {
		Artifact struct {
			MIMEType   string `json:"mime_type"`
			DataBase64 string `json:"data_base64"`
			URL        string `json:"url"`
		} `json:"artifact"`
	}
	type imageRequest struct {
		Model string    `json:"model"`
		Spec  imageSpec `json:"spec"`
	}

	prompt := ""
	negativePrompt := ""
	responseFormat := "b64_json"
	n := int32(0)
	size := ""
	aspectRatio := ""
	quality := ""
	style := ""
	seed := int64(0)
	mask := ""
	referenceImages := []string{}
	if spec != nil {
		prompt = strings.TrimSpace(spec.GetPrompt())
		negativePrompt = strings.TrimSpace(spec.GetNegativePrompt())
		if normalizedFormat, err := normalizeImageResponseFormat(spec.GetResponseFormat()); err != nil {
			return nil, nil, nil, err
		} else {
			responseFormat = normalizedFormat
		}
		n = spec.GetN()
		size = strings.TrimSpace(spec.GetSize())
		aspectRatio = strings.TrimSpace(spec.GetAspectRatio())
		quality = strings.TrimSpace(spec.GetQuality())
		style = strings.TrimSpace(spec.GetStyle())
		seed = spec.GetSeed()
		mask = strings.TrimSpace(spec.GetMask())
		for _, image := range spec.GetReferenceImages() {
			trimmed := strings.TrimSpace(image)
			if trimmed != "" {
				referenceImages = append(referenceImages, trimmed)
			}
		}
	}

	localPrompt := prompt
	if negativePrompt != "" && !strings.Contains(localPrompt, "|") {
		localPrompt = strings.TrimSpace(localPrompt + "|" + negativePrompt)
	}

	appliedOptions := make([]string, 0, 2)
	if step := ValueAsInt32(scenarioExtensions["step"]); step > 0 {
		appliedOptions = append(appliedOptions, "step")
	} else if steps := ValueAsInt32(scenarioExtensions["steps"]); steps > 0 {
		appliedOptions = append(appliedOptions, "steps->step")
	}
	if mode := strings.TrimSpace(ValueAsString(scenarioExtensions["mode"])); mode != "" {
		appliedOptions = append(appliedOptions, "mode")
	} else if method := strings.TrimSpace(ValueAsString(scenarioExtensions["method"])); method != "" {
		appliedOptions = append(appliedOptions, "method->mode")
	}

	ignoredOptions := make([]string, 0, 3)
	for _, key := range []string{"guidance_scale", "eta", "strength"} {
		if _, exists := scenarioExtensions[key]; exists {
			ignoredOptions = append(ignoredOptions, key)
		}
	}

	sourceImage := ""
	if len(referenceImages) > 0 {
		sourceImage = referenceImages[0]
	}

	requestBody := imageRequest{
		Model: modelID,
		Spec: imageSpec{
			Prompt:          localPrompt,
			NegativePrompt:  negativePrompt,
			N:               n,
			Size:            size,
			AspectRatio:     aspectRatio,
			Quality:         quality,
			Style:           style,
			Seed:            seed,
			Mask:            mask,
			ResponseFormat:  responseFormat,
			Extensions:      scenarioExtensions,
			ReferenceImages: append([]string(nil), referenceImages...),
		},
	}
	if requestBody.Spec.Extensions == nil {
		requestBody.Spec.Extensions = map[string]any{}
	}
	if step := ValueAsInt32(scenarioExtensions["step"]); step > 0 {
		requestBody.Spec.Extensions["step"] = step
	} else if steps := ValueAsInt32(scenarioExtensions["steps"]); steps > 0 {
		requestBody.Spec.Extensions["step"] = steps
	}
	if mode := strings.TrimSpace(ValueAsString(scenarioExtensions["mode"])); mode != "" {
		requestBody.Spec.Extensions["mode"] = mode
	} else if method := strings.TrimSpace(ValueAsString(scenarioExtensions["method"])); method != "" {
		requestBody.Spec.Extensions["mode"] = method
	}

	var respBody imageResponse
	if err := b.postJSON(ctx, "/v1/media/image/generate", requestBody, &respBody); err != nil {
		return nil, nil, nil, err
	}
	payload, err := b.DecodeMedia(ctx, respBody.Artifact.DataBase64, respBody.Artifact.URL)
	if err != nil {
		return nil, nil, nil, err
	}

	diag := &ManagedMediaImageDiagnostics{
		LocalPrompt:    localPrompt,
		SourceImage:    sourceImage,
		RefImagesCount: 0,
		AppliedOptions: appliedOptions,
		IgnoredOptions: ignoredOptions,
	}
	if len(referenceImages) > 1 {
		diag.RefImagesCount = len(referenceImages) - 1
	}
	usage := ArtifactUsage(localPrompt, payload, 180)
	return payload, usage, diag, nil
}

// GenerateImage sends an image generation request.
func (b *Backend) GenerateImage(ctx context.Context, modelID string, spec *runtimev1.ImageGenerateScenarioSpec, scenarioExtensions map[string]any) ([]byte, *runtimev1.UsageStats, error) {
	if b.isMediaBackend() {
		return b.generateImageMedia(ctx, modelID, spec, scenarioExtensions)
	}
	if spec == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

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
		Extensions      map[string]any `json:"extensions,omitempty"`
	}
	type imageResponse struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}

	prompt := strings.TrimSpace(spec.GetPrompt())
	responseFormat := "b64_json"
	normalizedFormat, err := normalizeImageResponseFormat(spec.GetResponseFormat())
	if err != nil {
		return nil, nil, err
	}
	responseFormat = normalizedFormat

	var respBody imageResponse
	err = b.postJSON(ctx, "/v1/images/generations", imageRequest{
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
		Extensions:      scenarioExtensions,
	}, &respBody)
	if err != nil {
		return nil, nil, err
	}
	if len(respBody.Data) == 0 {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	payload, err := b.DecodeMedia(ctx, respBody.Data[0].B64JSON, respBody.Data[0].URL)
	if err != nil {
		return nil, nil, err
	}
	usage := ArtifactUsage(prompt, payload, 180)
	return payload, usage, nil
}

// GenerateVideo sends a video generation request.
func (b *Backend) GenerateVideo(ctx context.Context, modelID string, spec *runtimev1.VideoGenerateScenarioSpec, scenarioExtensions map[string]any) ([]byte, *runtimev1.UsageStats, error) {
	if b.isMediaBackend() {
		return b.generateVideoMedia(ctx, modelID, spec, scenarioExtensions)
	}

	type videoRequest struct {
		Model                    string           `json:"model"`
		Prompt                   string           `json:"prompt"`
		NegativePrompt           string           `json:"negative_prompt,omitempty"`
		Mode                     string           `json:"mode,omitempty"`
		Content                  []map[string]any `json:"content,omitempty"`
		DurationSec              int32            `json:"duration_sec,omitempty"`
		Frames                   int32            `json:"frames,omitempty"`
		Fps                      int32            `json:"fps,omitempty"`
		Resolution               string           `json:"resolution,omitempty"`
		AspectRatio              string           `json:"aspect_ratio,omitempty"`
		Seed                     int64            `json:"seed,omitempty"`
		CameraFixed              bool             `json:"camera_fixed,omitempty"`
		Watermark                bool             `json:"watermark,omitempty"`
		GenerateAudio            bool             `json:"generate_audio,omitempty"`
		Draft                    bool             `json:"draft,omitempty"`
		ServiceTier              string           `json:"service_tier,omitempty"`
		ExecutionExpiresAfterSec int32            `json:"execution_expires_after_sec,omitempty"`
		ReturnLastFrame          bool             `json:"return_last_frame,omitempty"`
		Extensions               map[string]any   `json:"extensions,omitempty"`
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

	prompt := VideoPrompt(spec)
	mode := ""
	if spec != nil {
		mode = strings.ToLower(strings.TrimPrefix(spec.GetMode().String(), "VIDEO_MODE_"))
	}
	content := VideoContentPayload(spec)

	paths := []string{"/v1/video/generations", "/v1/videos/generations"}
	var respBody videoResponse
	var err error
	for _, path := range paths {
		err = b.postJSON(ctx, path, videoRequest{
			Model:                    modelID,
			Prompt:                   prompt,
			NegativePrompt:           VideoNegativePrompt(spec),
			Mode:                     mode,
			Content:                  content,
			DurationSec:              VideoDurationSec(spec),
			Frames:                   VideoFrames(spec),
			Fps:                      VideoFPS(spec),
			Resolution:               VideoResolution(spec),
			AspectRatio:              VideoRatio(spec),
			Seed:                     VideoSeed(spec),
			CameraFixed:              VideoCameraFixed(spec),
			Watermark:                VideoWatermark(spec),
			GenerateAudio:            VideoGenerateAudio(spec),
			Draft:                    VideoDraft(spec),
			ServiceTier:              VideoServiceTier(spec),
			ExecutionExpiresAfterSec: VideoExecutionExpiresAfterSec(spec),
			ReturnLastFrame:          VideoReturnLastFrame(spec),
			Extensions:               scenarioExtensions,
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
	payload, err := b.DecodeMedia(ctx, b64Data, mediaURL)
	if err != nil {
		return nil, nil, err
	}
	usage := ArtifactUsage(prompt, payload, 420)
	return payload, usage, nil
}

// GenerateMusic sends a music generation request.
func (b *Backend) GenerateMusic(ctx context.Context, modelID string, spec *runtimev1.MusicGenerateScenarioSpec, scenarioExtensions map[string]any) ([]byte, *runtimev1.UsageStats, error) {
	type musicResponse struct {
		Data []struct {
			B64Audio string `json:"b64_audio"`
			B64JSON  string `json:"b64_json"`
			URL      string `json:"url"`
		} `json:"data"`
		Output []struct {
			B64Audio string `json:"b64_audio"`
			URL      string `json:"url"`
		} `json:"output"`
	}

	prompt := strings.TrimSpace(spec.GetPrompt())
	requestBody, err := buildMusicGenerationRequest(b.Name, modelID, spec, scenarioExtensions)
	if err != nil {
		return nil, nil, err
	}
	paths := []string{"/v1/music/generations", "/v1/audio/generations"}
	var respBody musicResponse
	for _, path := range paths {
		err = b.postJSON(ctx, path, requestBody, &respBody)
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
		b64Data = FirstNonEmpty(respBody.Data[0].B64Audio, respBody.Data[0].B64JSON)
		mediaURL = respBody.Data[0].URL
	}
	if b64Data == "" && mediaURL == "" && len(respBody.Output) > 0 {
		b64Data = respBody.Output[0].B64Audio
		mediaURL = respBody.Output[0].URL
	}
	payload, err := b.DecodeMedia(ctx, b64Data, mediaURL)
	if err != nil {
		return nil, nil, err
	}
	usage := ArtifactUsage(prompt, payload, 420)
	return payload, usage, nil
}

// SynthesizeSpeech sends a text-to-speech request.
func (b *Backend) SynthesizeSpeech(ctx context.Context, modelID string, spec *runtimev1.SpeechSynthesizeScenarioSpec, scenarioExtensions map[string]any) ([]byte, *runtimev1.UsageStats, error) {
	if spec == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	type speechRequest struct {
		Model        string         `json:"model"`
		Input        string         `json:"input"`
		Voice        string         `json:"voice,omitempty"`
		Language     string         `json:"language,omitempty"`
		AudioFormat  string         `json:"audio_format,omitempty"`
		SampleRateHz int32          `json:"sample_rate_hz,omitempty"`
		Speed        float32        `json:"speed,omitempty"`
		Pitch        float32        `json:"pitch,omitempty"`
		Volume       float32        `json:"volume,omitempty"`
		Emotion      string         `json:"emotion,omitempty"`
		Extensions   map[string]any `json:"extensions,omitempty"`
	}
	text := strings.TrimSpace(spec.GetText())
	requestedVoice := strings.TrimSpace(scenarioVoiceRef(spec))
	payload, err := b.postRaw(ctx, "/v1/audio/speech", speechRequest{
		Model:        modelID,
		Input:        text,
		Voice:        requestedVoice,
		Language:     strings.TrimSpace(spec.GetLanguage()),
		AudioFormat:  strings.TrimSpace(spec.GetAudioFormat()),
		SampleRateHz: spec.GetSampleRateHz(),
		Speed:        spec.GetSpeed(),
		Pitch:        spec.GetPitch(),
		Volume:       spec.GetVolume(),
		Emotion:      strings.TrimSpace(spec.GetEmotion()),
		Extensions:   scenarioExtensions,
	})
	if err != nil {
		return nil, nil, err
	}
	usage := ArtifactUsage(text, payload, 120)
	return payload, usage, nil
}
