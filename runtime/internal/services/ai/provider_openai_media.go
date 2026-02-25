package ai

import (
	"bytes"
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"mime/multipart"
	"net/http"
	"strings"
)

func (b *openAIBackend) embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
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
		return nil, nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}

	var respBody embeddingsResponse
	if err := b.postJSON(ctx, "/v1/embeddings", embeddingsRequest{
		Model: modelID,
		Input: reqInputs,
	}, &respBody); err != nil {
		return nil, nil, err
	}
	if len(respBody.Data) == 0 {
		return nil, nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
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
		InputTokens:  maxInt64(0, respBody.Usage.PromptTokens),
		OutputTokens: maxInt64(0, respBody.Usage.TotalTokens-respBody.Usage.PromptTokens),
		ComputeMs:    0,
	}
	if usage.GetInputTokens() == 0 && usage.GetOutputTokens() == 0 {
		totalInput := int64(0)
		for _, input := range reqInputs {
			totalInput += estimateTokens(input)
		}
		usage = &runtimev1.UsageStats{
			InputTokens:  totalInput,
			OutputTokens: int64(len(vectors)),
			ComputeMs:    maxInt64(4, int64(len(vectors))*3),
		}
	}
	return vectors, usage, nil
}

func (b *openAIBackend) transcribe(ctx context.Context, modelID string, audio []byte, mimeType string) (string, *runtimev1.UsageStats, error) {
	if len(audio) == 0 {
		return "", nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("model", modelID); err != nil {
		return "", nil, mapProviderRequestError(err)
	}
	fileWriter, err := writer.CreateFormFile("file", "audio.bin")
	if err != nil {
		return "", nil, mapProviderRequestError(err)
	}
	if _, err := fileWriter.Write(audio); err != nil {
		return "", nil, mapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return "", nil, mapProviderRequestError(err)
	}

	endpoint := b.baseURL + "/v1/audio/transcriptions"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return "", nil, mapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if b.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+b.apiKey)
	}

	response, err := b.client.Do(request)
	if err != nil {
		return "", nil, mapProviderRequestError(err)
	}
	defer response.Body.Close()

	type transcriptionResponse struct {
		Text string `json:"text"`
	}
	var out transcriptionResponse
	if err := decodeResponseJSON(response, &out); err != nil {
		return "", nil, err
	}
	text := strings.TrimSpace(out.Text)
	if text == "" {
		return "", nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}

	usage := &runtimev1.UsageStats{
		InputTokens:  maxInt64(1, int64(len(audio)/256)),
		OutputTokens: estimateTokens(text),
		ComputeMs:    maxInt64(10, int64(len(audio)/64)),
	}
	return text, usage, nil
}

func (b *openAIBackend) generateImage(ctx context.Context, modelID string, prompt string) ([]byte, *runtimev1.UsageStats, error) {
	type imageRequest struct {
		Model          string `json:"model"`
		Prompt         string `json:"prompt"`
		ResponseFormat string `json:"response_format,omitempty"`
	}
	type imageResponse struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}

	var respBody imageResponse
	err := b.postJSON(ctx, "/v1/images/generations", imageRequest{
		Model:          modelID,
		Prompt:         prompt,
		ResponseFormat: "b64_json",
	}, &respBody)
	if err != nil {
		return nil, nil, err
	}
	if len(respBody.Data) == 0 {
		return nil, nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}

	payload, err := b.decodeMedia(respBody.Data[0].B64JSON, respBody.Data[0].URL)
	if err != nil {
		return nil, nil, err
	}
	usage := artifactUsage(prompt, payload, 180)
	return payload, usage, nil
}

func (b *openAIBackend) generateVideo(ctx context.Context, modelID string, prompt string) ([]byte, *runtimev1.UsageStats, error) {
	type videoRequest struct {
		Model  string `json:"model"`
		Prompt string `json:"prompt"`
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

	paths := []string{"/v1/video/generations", "/v1/videos/generations"}
	var respBody videoResponse
	var err error
	for _, path := range paths {
		err = b.postJSON(ctx, path, videoRequest{
			Model:  modelID,
			Prompt: prompt,
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
		return nil, nil, status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}

	var b64Data string
	var mediaURL string
	if len(respBody.Data) > 0 {
		b64Data = firstNonEmpty(respBody.Data[0].B64MP4, respBody.Data[0].B64JSON)
		mediaURL = respBody.Data[0].URL
	}
	if b64Data == "" && mediaURL == "" && len(respBody.Output) > 0 {
		b64Data = respBody.Output[0].B64MP4
		mediaURL = respBody.Output[0].URL
	}
	payload, err := b.decodeMedia(b64Data, mediaURL)
	if err != nil {
		return nil, nil, err
	}
	usage := artifactUsage(prompt, payload, 420)
	return payload, usage, nil
}

func (b *openAIBackend) synthesizeSpeech(ctx context.Context, modelID string, text string) ([]byte, *runtimev1.UsageStats, error) {
	type speechRequest struct {
		Model string `json:"model"`
		Input string `json:"input"`
		Voice string `json:"voice,omitempty"`
	}
	payload, err := b.postRaw(ctx, "/v1/audio/speech", speechRequest{
		Model: modelID,
		Input: text,
		Voice: "alloy",
	})
	if err != nil {
		return nil, nil, err
	}
	usage := artifactUsage(text, payload, 120)
	return payload, usage, nil
}
