package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const (
	codexResponsesPath       = "/responses"
	codexHostChatModel       = "gpt-5.4"
	codexImageInstructions   = "You are an assistant that must fulfill image generation requests by using the image_generation tool when provided."
	codexTextMaxStreamBuffer = 1024 * 1024
)

func (b *Backend) supportsCodexResponses() bool {
	if b == nil {
		return false
	}
	lowerName := strings.ToLower(strings.TrimSpace(b.Name))
	lowerBase := strings.ToLower(strings.TrimSpace(b.baseURL))
	return strings.Contains(lowerName, "openai_codex") || strings.Contains(lowerBase, "/backend-api/codex")
}

func (b *Backend) generateTextCodexResponses(
	ctx context.Context,
	modelID string,
	input []*runtimev1.ChatMessage,
	systemPrompt string,
	temperature float32,
	topP float32,
	maxTokens int32,
) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	requestBody, err := b.buildCodexTextRequest(modelID, input, systemPrompt, temperature, topP, maxTokens, false)
	if err != nil {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}

	var response map[string]any
	if err := b.postJSON(ctx, codexResponsesPath, requestBody, &response); err != nil {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}

	text := strings.TrimSpace(extractCodexResponseText(response))
	if text == "" {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	usage := codexUsageFromResponse(response)
	if usage == nil {
		usage = EstimateUsage(ComposeInputText(systemPrompt, input), text)
	}
	return text, usage, codexFinishReasonFromResponse(response), nil
}

func (b *Backend) streamGenerateTextCodexResponses(
	ctx context.Context,
	modelID string,
	input []*runtimev1.ChatMessage,
	systemPrompt string,
	temperature float32,
	topP float32,
	maxTokens int32,
	onDelta func(string) error,
) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	requestBody, err := b.buildCodexTextRequest(modelID, input, systemPrompt, temperature, topP, maxTokens, true)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}

	request, err := b.newRequest(ctx, http.MethodPost, b.baseURL+codexResponsesPath, bytes.NewReader(payload))
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	if b.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+b.apiKey)
	}

	response, err := b.do(request)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var errPayload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&errPayload)
		response.Body.Close()
		if IsStreamUnsupported(response.StatusCode, errPayload) {
			return b.fallbackStreamToNonStream(ctx, modelID, input, systemPrompt, temperature, topP, maxTokens, onDelta)
		}
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderHTTPError(response.StatusCode, errPayload)
	}
	defer response.Body.Close()

	contentType := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Type")))
	if !strings.HasPrefix(contentType, "text/event-stream") {
		return b.fallbackStreamToNonStream(ctx, modelID, input, systemPrompt, temperature, topP, maxTokens, onDelta)
	}

	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), codexTextMaxStreamBuffer)
	var outputBuilder strings.Builder
	var finalResponse map[string]any
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_STREAM_BROKEN)
		}
		switch strings.TrimSpace(ValueAsString(event["type"])) {
		case "response.output_text.delta":
			delta := ValueAsString(event["delta"])
			if delta == "" {
				continue
			}
			outputBuilder.WriteString(delta)
			if onDelta != nil {
				if err := onDelta(delta); err != nil {
					return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
				}
			}
		case "response.completed":
			finalResponse, _ = event["response"].(map[string]any)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_STREAM_BROKEN)
	}

	outputText := outputBuilder.String()
	if finalResponse != nil && strings.TrimSpace(outputText) == "" {
		outputText = extractCodexResponseText(finalResponse)
		if outputText != "" && onDelta != nil {
			if err := onDelta(outputText); err != nil {
				return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
			}
		}
	}
	usage := codexUsageFromResponse(finalResponse)
	if usage == nil {
		usage = EstimateUsage(ComposeInputText(systemPrompt, input), outputText)
	}
	return usage, codexFinishReasonFromResponse(finalResponse), nil
}

func (b *Backend) generateImageCodexResponses(
	ctx context.Context,
	modelID string,
	spec *runtimev1.ImageGenerateScenarioSpec,
) ([]byte, *runtimev1.UsageStats, error) {
	if spec == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	requestBody := map[string]any{
		"model":        codexHostChatModel,
		"store":        false,
		"instructions": codexImageInstructions,
		"input": []map[string]any{
			{
				"type": "message",
				"role": "user",
				"content": []map[string]any{
					{
						"type": "input_text",
						"text": strings.TrimSpace(spec.GetPrompt()),
					},
				},
			},
		},
		"tools": []map[string]any{
			{
				"type":           "image_generation",
				"model":          strings.TrimSpace(modelID),
				"size":           codexImageSize(spec),
				"quality":        codexImageQuality(spec),
				"output_format":  "png",
				"background":     "opaque",
				"partial_images": 1,
			},
		},
		"tool_choice": map[string]any{
			"type": "allowed_tools",
			"mode": "required",
			"tools": []map[string]any{
				{"type": "image_generation"},
			},
		},
	}

	var response map[string]any
	if err := b.postJSON(ctx, codexResponsesPath, requestBody, &response); err != nil {
		return nil, nil, err
	}
	imageB64 := strings.TrimSpace(extractCodexImageResult(response))
	if imageB64 == "" {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	payload, ok := DecodeBase64ArtifactPayload(imageB64)
	if !ok || len(payload) == 0 {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return payload, ArtifactUsage(strings.TrimSpace(spec.GetPrompt()), payload, 180), nil
}

func (b *Backend) buildCodexTextRequest(
	modelID string,
	input []*runtimev1.ChatMessage,
	systemPrompt string,
	temperature float32,
	topP float32,
	maxTokens int32,
	stream bool,
) (map[string]any, error) {
	items, err := buildCodexResponsesInput(input)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	requestBody := map[string]any{
		"model": strings.TrimSpace(modelID),
		"store": false,
		"input": items,
	}
	if stream {
		requestBody["stream"] = true
	}
	if prompt := strings.TrimSpace(systemPrompt); prompt != "" {
		requestBody["instructions"] = prompt
	}
	if temperature > 0 {
		requestBody["temperature"] = temperature
	}
	if topP > 0 {
		requestBody["top_p"] = topP
	}
	if maxTokens > 0 {
		requestBody["max_output_tokens"] = maxTokens
	}
	return requestBody, nil
}

func buildCodexResponsesInput(input []*runtimev1.ChatMessage) ([]map[string]any, error) {
	items := make([]map[string]any, 0, len(input))
	for _, message := range input {
		role := strings.TrimSpace(message.GetRole())
		if role == "" {
			role = "user"
		}
		content, err := buildCodexResponsesContent(message)
		if err != nil {
			return nil, err
		}
		if len(content) == 0 {
			continue
		}
		items = append(items, map[string]any{
			"type":    "message",
			"role":    role,
			"content": content,
		})
	}
	return items, nil
}

func buildCodexResponsesContent(message *runtimev1.ChatMessage) ([]map[string]any, error) {
	parts := message.GetParts()
	if len(parts) == 0 {
		text := strings.TrimSpace(message.GetContent())
		if text == "" {
			return nil, nil
		}
		return []map[string]any{{"type": "input_text", "text": text}}, nil
	}

	content := make([]map[string]any, 0, len(parts))
	for _, part := range parts {
		switch part.GetType() {
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
			text := strings.TrimSpace(part.GetText())
			if text != "" {
				content = append(content, map[string]any{"type": "input_text", "text": text})
			}
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
			imageURL := part.GetImageUrl()
			if imageURL == nil {
				continue
			}
			url := strings.TrimSpace(imageURL.GetUrl())
			if url == "" {
				continue
			}
			item := map[string]any{
				"type":      "input_image",
				"image_url": url,
			}
			if detail := strings.TrimSpace(imageURL.GetDetail()); detail != "" {
				item["detail"] = detail
			}
			content = append(content, item)
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	if len(content) == 0 {
		if text := strings.TrimSpace(message.GetContent()); text != "" {
			content = append(content, map[string]any{"type": "input_text", "text": text})
		}
	}
	return content, nil
}

func extractCodexResponseText(response map[string]any) string {
	if response == nil {
		return ""
	}
	if text := strings.TrimSpace(ValueAsString(response["output_text"])); text != "" {
		return text
	}
	output, _ := response["output"].([]any)
	lines := make([]string, 0, len(output))
	for _, item := range output {
		itemMap, _ := item.(map[string]any)
		if strings.TrimSpace(ValueAsString(itemMap["type"])) != "message" {
			continue
		}
		content, _ := itemMap["content"].([]any)
		for _, part := range content {
			partMap, _ := part.(map[string]any)
			partType := strings.TrimSpace(ValueAsString(partMap["type"]))
			switch partType {
			case "output_text", "text", "input_text":
				text := strings.TrimSpace(FirstNonEmpty(
					ValueAsString(partMap["text"]),
					ValueAsString(MapField(partMap["text"], "value")),
				))
				if text != "" {
					lines = append(lines, text)
				}
			}
		}
	}
	return strings.Join(lines, "\n")
}

func extractCodexImageResult(response map[string]any) string {
	if response == nil {
		return ""
	}
	output, _ := response["output"].([]any)
	for _, item := range output {
		itemMap, _ := item.(map[string]any)
		if strings.TrimSpace(ValueAsString(itemMap["type"])) != "image_generation_call" {
			continue
		}
		if result := strings.TrimSpace(ValueAsString(itemMap["result"])); result != "" {
			return result
		}
	}
	return ""
}

func codexUsageFromResponse(response map[string]any) *runtimev1.UsageStats {
	if response == nil {
		return nil
	}
	usagePayload := MapField(response, "usage")
	inputTokens := ValueAsInt64(MapField(usagePayload, "input_tokens"))
	outputTokens := ValueAsInt64(MapField(usagePayload, "output_tokens"))
	if inputTokens == 0 && outputTokens == 0 {
		return nil
	}
	return &runtimev1.UsageStats{
		InputTokens:  MaxInt64(0, inputTokens),
		OutputTokens: MaxInt64(0, outputTokens),
		ComputeMs:    0,
	}
}

func codexFinishReasonFromResponse(response map[string]any) runtimev1.FinishReason {
	if response == nil {
		return runtimev1.FinishReason_FINISH_REASON_STOP
	}
	if strings.EqualFold(strings.TrimSpace(ValueAsString(response["status"])), "incomplete") {
		return runtimev1.FinishReason_FINISH_REASON_LENGTH
	}
	return runtimev1.FinishReason_FINISH_REASON_STOP
}

func codexImageQuality(spec *runtimev1.ImageGenerateScenarioSpec) string {
	if spec == nil {
		return "medium"
	}
	switch strings.ToLower(strings.TrimSpace(spec.GetQuality())) {
	case "low", "medium", "high":
		return strings.ToLower(strings.TrimSpace(spec.GetQuality()))
	default:
		return "medium"
	}
}

func codexImageSize(spec *runtimev1.ImageGenerateScenarioSpec) string {
	if spec == nil {
		return "1024x1024"
	}
	if size := strings.TrimSpace(spec.GetSize()); size != "" {
		return size
	}
	switch strings.TrimSpace(spec.GetAspectRatio()) {
	case "16:9", "4:3", "3:2":
		return "1536x1024"
	case "9:16", "3:4", "2:3":
		return "1024x1536"
	default:
		return "1024x1024"
	}
}
