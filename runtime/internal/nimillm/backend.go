package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const defaultHTTPTimeout = 30 * time.Second

// Backend is an OpenAI-compatible HTTP backend for AI inference.
type Backend struct {
	Name    string
	baseURL string
	apiKey  string
	client  *http.Client
}

// NewBackend creates a new OpenAI-compatible backend.
// Returns nil if baseURL is empty.
func NewBackend(name string, baseURL string, apiKey string, timeout time.Duration) *Backend {
	trimmed := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		return nil
	}
	if timeout <= 0 {
		timeout = defaultHTTPTimeout
	}
	return &Backend{
		Name:    name,
		baseURL: trimmed,
		apiKey:  strings.TrimSpace(apiKey),
		client: &http.Client{
			Timeout: timeout,
		},
	}
}

// WithRequestOverrides returns a shallow clone with overridden endpoint and API key.
func (b *Backend) WithRequestOverrides(endpoint string, apiKey string) *Backend {
	if b == nil {
		return nil
	}
	normalizedEndpoint := strings.TrimSuffix(strings.TrimSpace(endpoint), "/")
	if normalizedEndpoint == "" {
		normalizedEndpoint = b.baseURL
	}
	normalizedAPIKey := strings.TrimSpace(apiKey)
	if normalizedEndpoint == b.baseURL && normalizedAPIKey == b.apiKey {
		return b
	}
	clone := *b
	clone.baseURL = normalizedEndpoint
	clone.apiKey = normalizedAPIKey
	return &clone
}

// Endpoint returns the backend base URL.
func (b *Backend) Endpoint() string {
	if b == nil {
		return ""
	}
	return b.baseURL
}

// GenerateText sends a non-streaming chat completion request.
func (b *Backend) GenerateText(ctx context.Context, modelID string, input []*runtimev1.ChatMessage, systemPrompt string, temperature float32, topP float32, maxTokens int32) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	type openAIMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
		Name    string `json:"name,omitempty"`
	}
	type chatRequest struct {
		Model       string          `json:"model"`
		Messages    []openAIMessage `json:"messages"`
		Temperature *float32        `json:"temperature,omitempty"`
		TopP        *float32        `json:"top_p,omitempty"`
		MaxTokens   *int32          `json:"max_tokens,omitempty"`
		Stream      bool            `json:"stream"`
	}
	type chatResponse struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
		} `json:"usage"`
	}

	messages := make([]openAIMessage, 0, len(input)+1)
	if prompt := strings.TrimSpace(systemPrompt); prompt != "" {
		messages = append(messages, openAIMessage{Role: "system", Content: prompt})
	}
	for _, item := range input {
		content := strings.TrimSpace(item.GetContent())
		if content == "" {
			continue
		}
		role := strings.TrimSpace(item.GetRole())
		if role == "" {
			role = "user"
		}
		messages = append(messages, openAIMessage{
			Role:    role,
			Content: content,
			Name:    strings.TrimSpace(item.GetName()),
		})
	}
	if len(messages) == 0 {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}

	reqBody := chatRequest{
		Model:    modelID,
		Messages: messages,
		Stream:   false,
	}
	if temperature > 0 {
		t := temperature
		reqBody.Temperature = &t
	}
	if topP > 0 {
		p := topP
		reqBody.TopP = &p
	}
	if maxTokens > 0 {
		max := maxTokens
		reqBody.MaxTokens = &max
	}

	var respBody chatResponse
	if err := b.postJSON(ctx, "/v1/chat/completions", reqBody, &respBody); err != nil {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	if len(respBody.Choices) == 0 {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	text := strings.TrimSpace(respBody.Choices[0].Message.Content)
	if text == "" {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	usage := &runtimev1.UsageStats{
		InputTokens:  MaxInt64(0, respBody.Usage.PromptTokens),
		OutputTokens: MaxInt64(0, respBody.Usage.CompletionTokens),
		ComputeMs:    0,
	}
	if usage.GetInputTokens() == 0 && usage.GetOutputTokens() == 0 {
		usage = EstimateUsage(ComposeInputText(systemPrompt, input), text)
	}
	return text, usage, MapOpenAIFinishReason(respBody.Choices[0].FinishReason), nil
}

// StreamGenerateText sends a streaming chat completion request.
func (b *Backend) StreamGenerateText(ctx context.Context, modelID string, input []*runtimev1.ChatMessage, systemPrompt string, temperature float32, topP float32, maxTokens int32, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	type openAIMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
		Name    string `json:"name,omitempty"`
	}
	type streamOptions struct {
		IncludeUsage bool `json:"include_usage"`
	}
	type chatRequest struct {
		Model         string          `json:"model"`
		Messages      []openAIMessage `json:"messages"`
		Temperature   *float32        `json:"temperature,omitempty"`
		TopP          *float32        `json:"top_p,omitempty"`
		MaxTokens     *int32          `json:"max_tokens,omitempty"`
		Stream        bool            `json:"stream"`
		StreamOptions *streamOptions  `json:"stream_options,omitempty"`
	}
	type streamResponse struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
			TotalTokens      int64 `json:"total_tokens"`
		} `json:"usage"`
	}

	messages := make([]openAIMessage, 0, len(input)+1)
	if prompt := strings.TrimSpace(systemPrompt); prompt != "" {
		messages = append(messages, openAIMessage{Role: "system", Content: prompt})
	}
	for _, item := range input {
		content := strings.TrimSpace(item.GetContent())
		if content == "" {
			continue
		}
		role := strings.TrimSpace(item.GetRole())
		if role == "" {
			role = "user"
		}
		messages = append(messages, openAIMessage{
			Role:    role,
			Content: content,
			Name:    strings.TrimSpace(item.GetName()),
		})
	}
	if len(messages) == 0 {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}

	reqBody := chatRequest{
		Model:    modelID,
		Messages: messages,
		Stream:   true,
		StreamOptions: &streamOptions{
			IncludeUsage: true,
		},
	}
	if temperature > 0 {
		t := temperature
		reqBody.Temperature = &t
	}
	if topP > 0 {
		p := topP
		reqBody.TopP = &p
	}
	if maxTokens > 0 {
		max := maxTokens
		reqBody.MaxTokens = &max
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}
	endpoint := b.baseURL + "/v1/chat/completions"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	if b.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+b.apiKey)
	}

	response, err := b.client.Do(request)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var errPayload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&errPayload)
		response.Body.Close()
		if IsStreamUnsupported(response.StatusCode, errPayload) {
			text, usage, finish, fallbackErr := b.GenerateText(ctx, modelID, input, systemPrompt, temperature, topP, maxTokens)
			if fallbackErr != nil {
				return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, fallbackErr
			}
			for _, part := range SplitText(text, 24) {
				if onDelta != nil {
					if err := onDelta(part); err != nil {
						return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
					}
				}
			}
			return usage, finish, nil
		}
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderHTTPError(response.StatusCode, errPayload)
	}
	defer response.Body.Close()

	var outputBuilder strings.Builder
	var usage *runtimev1.UsageStats
	finish := runtimev1.FinishReason_FINISH_REASON_STOP
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}

		var chunk streamResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Internal, runtimev1.ReasonCode_AI_STREAM_BROKEN.String())
		}
		if len(chunk.Choices) > 0 {
			delta := chunk.Choices[0].Delta.Content
			if delta != "" {
				outputBuilder.WriteString(delta)
				if onDelta != nil {
					if err := onDelta(delta); err != nil {
						return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
					}
				}
			}
			if rawFinish := strings.TrimSpace(chunk.Choices[0].FinishReason); rawFinish != "" {
				finish = MapOpenAIFinishReason(rawFinish)
			}
		}
		if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 || chunk.Usage.TotalTokens > 0 {
			outTokens := chunk.Usage.CompletionTokens
			if outTokens == 0 && chunk.Usage.TotalTokens > chunk.Usage.PromptTokens {
				outTokens = chunk.Usage.TotalTokens - chunk.Usage.PromptTokens
			}
			usage = &runtimev1.UsageStats{
				InputTokens:  MaxInt64(0, chunk.Usage.PromptTokens),
				OutputTokens: MaxInt64(0, outTokens),
				ComputeMs:    0,
			}
		}
	}
	if err := scanner.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
		}
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Internal, runtimev1.ReasonCode_AI_STREAM_BROKEN.String())
	}

	outputText := outputBuilder.String()
	if usage == nil {
		usage = EstimateUsage(ComposeInputText(systemPrompt, input), outputText)
	}
	return usage, finish, nil
}
