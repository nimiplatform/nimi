package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const defaultHTTPTimeout = 30 * time.Second

// Backend is an OpenAI-compatible HTTP backend for AI inference.
type Backend struct {
	Name    string
	baseURL string
	apiKey  string
	client  *http.Client

	// Security controls for outbound endpoint validation.
	enforceEndpointSecurity bool
	allowLoopbackEndpoint   bool
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

func buildOpenAIMessages(systemPrompt string, input []*runtimev1.ChatMessage) []openAIMessage {
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
	return messages
}

// NewBackend creates a new OpenAI-compatible backend.
// Returns nil if baseURL is empty.
func NewBackend(name string, baseURL string, apiKey string, timeout time.Duration) *Backend {
	return newBackend(name, baseURL, apiKey, timeout, nil, false, false)
}

// NewBackendWithTransport creates a backend with an optional custom transport.
// When transport is non-nil it is used for all HTTP requests (e.g. a pinned
// transport from endpointsec). Returns nil if baseURL is empty.
func NewBackendWithTransport(name string, baseURL string, apiKey string, timeout time.Duration, transport http.RoundTripper) *Backend {
	return newBackend(name, baseURL, apiKey, timeout, transport, false, false)
}

// NewSecuredBackend creates a backend that validates the endpoint before each
// outbound request and uses a DNS-pinned transport (K-SEC-003/K-SEC-004).
func NewSecuredBackend(name string, baseURL string, apiKey string, timeout time.Duration, allowLoopback bool) *Backend {
	normalized := normalizeBackendBaseURL(baseURL)
	if normalized == "" {
		return nil
	}
	if err := endpointsec.ValidateEndpoint(normalized, allowLoopback); err != nil {
		return nil
	}
	transport, err := endpointsec.NewPinnedTransport(normalized, allowLoopback)
	if err != nil {
		return nil
	}
	return newBackend(name, normalized, apiKey, timeout, transport, true, allowLoopback)
}

func newBackend(name string, baseURL string, apiKey string, timeout time.Duration, transport http.RoundTripper, secure bool, allowLoopback bool) *Backend {
	normalized := normalizeBackendBaseURL(baseURL)
	if normalized == "" {
		return nil
	}
	if timeout <= 0 {
		timeout = defaultHTTPTimeout
	}
	client := &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}
	return &Backend{
		Name:                    name,
		baseURL:                 normalized,
		apiKey:                  strings.TrimSpace(apiKey),
		client:                  client,
		enforceEndpointSecurity: secure,
		allowLoopbackEndpoint:   allowLoopback,
	}
}

func normalizeBackendBaseURL(baseURL string) string {
	trimmed := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	// Strip trailing /v1 to prevent double-versioned paths: the backend
	// hardcodes /v1/... in request paths (e.g. /v1/chat/completions).
	trimmed = strings.TrimSuffix(trimmed, "/v1")
	return trimmed
}

// WithRequestOverrides returns a shallow clone with overridden endpoint and API key.
func (b *Backend) WithRequestOverrides(endpoint string, apiKey string) *Backend {
	return b.WithRequestOverridesWithPolicy(endpoint, apiKey, b.allowLoopbackEndpoint)
}

// WithRequestOverridesWithPolicy returns a clone with overridden request
// endpoint/API key and an explicit loopback policy.
func (b *Backend) WithRequestOverridesWithPolicy(endpoint string, apiKey string, allowLoopback bool) *Backend {
	if b == nil {
		return nil
	}
	normalizedEndpoint := normalizeBackendBaseURL(endpoint)
	if normalizedEndpoint == "" {
		normalizedEndpoint = b.baseURL
	}
	normalizedAPIKey := strings.TrimSpace(apiKey)
	if normalizedEndpoint == b.baseURL && normalizedAPIKey == b.apiKey && allowLoopback == b.allowLoopbackEndpoint {
		return b
	}
	if b.enforceEndpointSecurity {
		return NewSecuredBackend(b.Name, normalizedEndpoint, normalizedAPIKey, b.timeout(), allowLoopback)
	}
	clone := *b
	clone.baseURL = normalizedEndpoint
	clone.apiKey = normalizedAPIKey
	clone.allowLoopbackEndpoint = allowLoopback
	return &clone
}

func (b *Backend) timeout() time.Duration {
	if b == nil || b.client == nil || b.client.Timeout <= 0 {
		return defaultHTTPTimeout
	}
	return b.client.Timeout
}

func (b *Backend) httpClientForContext(ctx context.Context) *http.Client {
	if b == nil || b.client == nil {
		return &http.Client{Timeout: defaultHTTPTimeout}
	}
	if ctx != nil {
		if _, ok := ctx.Deadline(); ok && b.client.Timeout > 0 {
			clone := *b.client
			clone.Timeout = 0
			return &clone
		}
	}
	return b.client
}

func (b *Backend) do(request *http.Request) (*http.Response, error) {
	if request == nil {
		return nil, errors.New("request is required")
	}
	return b.httpClientForContext(request.Context()).Do(request)
}

// Endpoint returns the backend base URL.
func (b *Backend) Endpoint() string {
	if b == nil {
		return ""
	}
	return b.baseURL
}

func (b *Backend) newRequest(ctx context.Context, method string, endpoint string, body io.Reader) (*http.Request, error) {
	if b.enforceEndpointSecurity {
		if err := endpointsec.ValidateEndpoint(endpoint, b.allowLoopbackEndpoint); err != nil {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
		}
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	return request, nil
}

// GenerateText sends a non-streaming chat completion request.
func (b *Backend) GenerateText(ctx context.Context, modelID string, input []*runtimev1.ChatMessage, systemPrompt string, temperature float32, topP float32, maxTokens int32) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
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

	messages := buildOpenAIMessages(systemPrompt, input)
	if len(messages) == 0 {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
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
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	text := strings.TrimSpace(respBody.Choices[0].Message.Content)
	if text == "" {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
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

	messages := buildOpenAIMessages(systemPrompt, input)
	if len(messages) == 0 {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
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
	request, err := b.newRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
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

	contentType := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Type")))
	if !strings.HasPrefix(contentType, "text/event-stream") {
		response.Body.Close()
		return b.fallbackStreamToNonStream(ctx, modelID, input, systemPrompt, temperature, topP, maxTokens, onDelta)
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
			return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_STREAM_BROKEN)
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
			return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		}
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_STREAM_BROKEN)
	}

	outputText := outputBuilder.String()
	if usage == nil {
		usage = EstimateUsage(ComposeInputText(systemPrompt, input), outputText)
	}
	return usage, finish, nil
}

func (b *Backend) fallbackStreamToNonStream(
	ctx context.Context,
	modelID string,
	input []*runtimev1.ChatMessage,
	systemPrompt string,
	temperature float32,
	topP float32,
	maxTokens int32,
	onDelta func(string) error,
) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	MarkStreamSimulated(ctx)
	text, usage, finish, err := b.GenerateText(ctx, modelID, input, systemPrompt, temperature, topP, maxTokens)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	for _, part := range SplitText(text, 24) {
		if onDelta != nil {
			if sendErr := onDelta(part); sendErr != nil {
				return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, sendErr
			}
		}
	}
	return usage, finish, nil
}
