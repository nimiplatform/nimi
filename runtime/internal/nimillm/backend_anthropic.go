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
	anthropicVersionHeaderValue = "2023-06-01"
	anthropicMessageStreamLimit = 1024 * 1024
)

var anthropicCommonBetas = []string{
	"fine-grained-tool-streaming-2025-05-14",
}

var anthropicOAuthBetas = []string{
	"claude-code-20250219",
	"oauth-2025-04-20",
}

type anthropicMessageRequest struct {
	Model       string `json:"model"`
	System      string `json:"system,omitempty"`
	Messages    any    `json:"messages"`
	MaxTokens   int32  `json:"max_tokens"`
	Temperature any    `json:"temperature,omitempty"`
	TopP        any    `json:"top_p,omitempty"`
	Stream      bool   `json:"stream,omitempty"`
}

type anthropicMessageResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	StopReason string `json:"stop_reason"`
	Usage      struct {
		InputTokens  int64 `json:"input_tokens"`
		OutputTokens int64 `json:"output_tokens"`
	} `json:"usage"`
}

func (b *Backend) supportsAnthropicMessages() bool {
	if b == nil {
		return false
	}
	lowerName := strings.ToLower(strings.TrimSpace(b.Name))
	lowerBase := strings.ToLower(strings.TrimSpace(b.baseURL))
	return strings.Contains(lowerName, "anthropic") ||
		strings.Contains(lowerBase, "api.anthropic.com") ||
		strings.HasSuffix(strings.TrimSuffix(lowerBase, "/"), "/anthropic")
}

func isAnthropicOAuthToken(token string) bool {
	normalized := strings.TrimSpace(token)
	if normalized == "" {
		return false
	}
	if strings.HasPrefix(normalized, "sk-ant-api") {
		return false
	}
	return strings.HasPrefix(normalized, "sk-ant-") || strings.HasPrefix(normalized, "eyJ")
}

func anthropicCredentialHeaders(token string) map[string]string {
	headers := map[string]string{
		"anthropic-version": anthropicVersionHeaderValue,
	}
	if isAnthropicOAuthToken(token) {
		betas := append([]string{}, anthropicCommonBetas...)
		betas = append(betas, anthropicOAuthBetas...)
		headers["anthropic-beta"] = strings.Join(betas, ",")
		headers["user-agent"] = "claude-cli/2.1.74 (external, cli)"
		headers["x-app"] = "cli"
	}
	return headers
}

func (b *Backend) generateTextAnthropicMessages(
	ctx context.Context,
	modelID string,
	input []*runtimev1.ChatMessage,
	systemPrompt string,
	temperature float32,
	topP float32,
	maxTokens int32,
) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	messages, err := buildAnthropicMessages(input)
	if err != nil {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	requestBody := anthropicMessageRequest{
		Model:     strings.TrimSpace(modelID),
		System:    strings.TrimSpace(systemPrompt),
		Messages:  messages,
		MaxTokens: anthropicMaxTokens(maxTokens),
	}
	if temperature > 0 {
		requestBody.Temperature = temperature
	}
	if topP > 0 {
		requestBody.TopP = topP
	}

	var response anthropicMessageResponse
	if err := b.postJSON(ctx, "/v1/messages", requestBody, &response); err != nil {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	text := strings.TrimSpace(extractAnthropicText(response.Content))
	if text == "" {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	usage := anthropicUsage(response.Usage.InputTokens, response.Usage.OutputTokens)
	if usage == nil {
		usage = EstimateUsage(ComposeInputText(systemPrompt, input), text)
	}
	return text, usage, anthropicFinishReason(response.StopReason), nil
}

func (b *Backend) streamGenerateTextAnthropicMessages(
	ctx context.Context,
	modelID string,
	input []*runtimev1.ChatMessage,
	systemPrompt string,
	temperature float32,
	topP float32,
	maxTokens int32,
	onDelta func(string) error,
) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	messages, err := buildAnthropicMessages(input)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	requestBody := anthropicMessageRequest{
		Model:     strings.TrimSpace(modelID),
		System:    strings.TrimSpace(systemPrompt),
		Messages:  messages,
		MaxTokens: anthropicMaxTokens(maxTokens),
		Stream:    true,
	}
	if temperature > 0 {
		requestBody.Temperature = temperature
	}
	if topP > 0 {
		requestBody.TopP = topP
	}
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}

	request, err := b.newRequest(ctx, http.MethodPost, b.baseURL+"/v1/messages", bytes.NewReader(payload))
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")

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

	var outputBuilder strings.Builder
	var finish = runtimev1.FinishReason_FINISH_REASON_STOP
	var usage *runtimev1.UsageStats
	var currentEvent string
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), anthropicMessageStreamLimit)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if strings.HasPrefix(line, "event:") {
			currentEvent = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_STREAM_BROKEN)
		}
		switch currentEvent {
		case "content_block_delta":
			delta := MapField(event, "delta")
			if strings.TrimSpace(ValueAsString(MapField(delta, "type"))) != "text_delta" {
				continue
			}
			text := ValueAsString(MapField(delta, "text"))
			if text == "" {
				continue
			}
			outputBuilder.WriteString(text)
			if onDelta != nil {
				if err := onDelta(text); err != nil {
					return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
				}
			}
		case "message_delta":
			if stop := strings.TrimSpace(ValueAsString(MapField(event, "delta.stop_reason"))); stop != "" {
				finish = anthropicFinishReason(stop)
			}
		case "message_stop":
			finish = anthropicFinishReason(strings.TrimSpace(ValueAsString(MapField(event, "stop_reason"))))
		case "message_start":
			messagePayload := MapField(event, "message")
			usagePayload := MapField(messagePayload, "usage")
			usage = anthropicUsage(
				ValueAsInt64(MapField(usagePayload, "input_tokens")),
				ValueAsInt64(MapField(usagePayload, "output_tokens")),
			)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_STREAM_BROKEN)
	}
	if usage == nil {
		usage = EstimateUsage(ComposeInputText(systemPrompt, input), outputBuilder.String())
	}
	return usage, finish, nil
}

func buildAnthropicMessages(input []*runtimev1.ChatMessage) ([]map[string]any, error) {
	messages := make([]map[string]any, 0, len(input))
	for _, message := range input {
		role := strings.TrimSpace(message.GetRole())
		if role == "" {
			role = "user"
		}
		if role == "system" {
			continue
		}
		content, err := buildAnthropicMessageContent(message)
		if err != nil {
			return nil, err
		}
		if len(content) == 0 {
			continue
		}
		messages = append(messages, map[string]any{
			"role":    role,
			"content": content,
		})
	}
	return messages, nil
}

func buildAnthropicMessageContent(message *runtimev1.ChatMessage) ([]map[string]any, error) {
	if message == nil {
		return nil, nil
	}
	if len(message.GetParts()) == 0 {
		text := strings.TrimSpace(message.GetContent())
		if text == "" {
			return nil, nil
		}
		return []map[string]any{{"type": "text", "text": text}}, nil
	}
	content := make([]map[string]any, 0, len(message.GetParts()))
	for _, part := range message.GetParts() {
		switch part.GetType() {
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
			text := strings.TrimSpace(part.GetText())
			if text != "" {
				content = append(content, map[string]any{"type": "text", "text": text})
			}
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	return content, nil
}

func anthropicMaxTokens(maxTokens int32) int32 {
	if maxTokens > 0 {
		return maxTokens
	}
	return 4096
}

func extractAnthropicText(content []struct {
	Type string `json:"type"`
	Text string `json:"text"`
}) string {
	lines := make([]string, 0, len(content))
	for _, block := range content {
		if strings.TrimSpace(block.Type) != "text" {
			continue
		}
		if text := strings.TrimSpace(block.Text); text != "" {
			lines = append(lines, text)
		}
	}
	return strings.Join(lines, "\n")
}

func anthropicFinishReason(reason string) runtimev1.FinishReason {
	switch strings.TrimSpace(reason) {
	case "max_tokens":
		return runtimev1.FinishReason_FINISH_REASON_LENGTH
	case "tool_use":
		return runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
	default:
		return runtimev1.FinishReason_FINISH_REASON_STOP
	}
}

func anthropicUsage(inputTokens int64, outputTokens int64) *runtimev1.UsageStats {
	if inputTokens == 0 && outputTokens == 0 {
		return nil
	}
	return &runtimev1.UsageStats{
		InputTokens:  MaxInt64(0, inputTokens),
		OutputTokens: MaxInt64(0, outputTokens),
		ComputeMs:    0,
	}
}
