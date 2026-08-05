package engine

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

const maxLlamaInvocationErrorBody = 64 << 10

type llamaInvocationSubstrate interface {
	Ensure(context.Context, string, []string, localexecution.TextProgressFunc) (string, bool, error)
	Healthy() bool
}

// ExecutionHost owns llama-server process and HTTP substrate execution. It
// never resolves a model, companion, portable option, request route, or
// selection: those semantics arrive flattened in the captured Driver plan.
type ExecutionHost struct {
	logger    *slog.Logger
	substrate llamaInvocationSubstrate
	client    *http.Client

	// One llama worker can load one captured process plan at a time. Holding the
	// lease through inference prevents a later job from swapping the process
	// underneath an earlier captured job. The channel makes queued acquisition
	// cancelable without stopping the reusable resident worker.
	lease chan struct{}
}

func newExecutionLease() chan struct{} {
	lease := make(chan struct{}, 1)
	lease <- struct{}{}
	return lease
}

func NewExecutionHost(manager *Manager, logger *slog.Logger) *ExecutionHost {
	if logger == nil {
		logger = slog.Default()
	}
	return &ExecutionHost{
		logger:    logger,
		substrate: newManagerLlamaInvocationSubstrate(manager),
		client:    &http.Client{},
		lease:     newExecutionLease(),
	}
}

func newExecutionHostWithSubstrate(substrate llamaInvocationSubstrate, client *http.Client) *ExecutionHost {
	if client == nil {
		client = &http.Client{}
	}
	return &ExecutionHost{logger: slog.Default(), substrate: substrate, client: client, lease: newExecutionLease()}
}

func (h *ExecutionHost) ExecuteText(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	progress localexecution.TextProgressFunc,
) (localexecution.TextResult, error) {
	if plan == nil || plan.Stream() {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("invalid non-stream llama invocation plan"))
	}
	return h.execute(ctx, plan, nil, progress)
}

func (h *ExecutionHost) StreamText(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	onDelta func(localexecution.TextDelta) error,
	progress localexecution.TextProgressFunc,
) (localexecution.TextResult, error) {
	if plan == nil || !plan.Stream() || onDelta == nil {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("invalid streaming llama invocation plan"))
	}
	return h.execute(ctx, plan, onDelta, progress)
}

func (h *ExecutionHost) execute(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	onDelta func(localexecution.TextDelta) error,
	progress localexecution.TextProgressFunc,
) (localexecution.TextResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if h == nil || h.substrate == nil || h.client == nil {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("llama execution host is unavailable"))
	}
	if plan.ProcessKey() == "" || len(plan.ProcessArgs()) == 0 || plan.RequestPath() == "" || len(plan.RequestBody()) == 0 {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("llama invocation plan is incomplete"))
	}

	select {
	case <-ctx.Done():
		return localexecution.TextResult{}, executionFailure(localexecution.FailureCanceled, ctx.Err())
	case <-h.lease:
	}
	defer func() { h.lease <- struct{}{} }()

	endpoint, _, err := h.substrate.Ensure(ctx, plan.ProcessKey(), plan.ProcessArgs(), progress)
	if err != nil {
		if ctx.Err() != nil {
			return localexecution.TextResult{}, executionFailure(localexecution.FailureCanceled, ctx.Err())
		}
		return localexecution.TextResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("load llama invocation process: %w", err))
	}
	requestURL := strings.TrimRight(strings.TrimSpace(endpoint), "/") + "/" + strings.TrimLeft(plan.RequestPath(), "/")
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(plan.RequestBody()))
	if err != nil {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("create llama inference request: %w", err))
	}
	request.Header.Set("Content-Type", "application/json")
	if plan.Stream() {
		request.Header.Set("Accept", "text/event-stream")
	}
	response, err := h.client.Do(request)
	if err != nil {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(response.Body, maxLlamaInvocationErrorBody))
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("llama inference HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body))))
	}
	if plan.Stream() {
		return h.consumeStream(ctx, response.Body, onDelta)
	}
	return h.consumeResponse(ctx, response.Body)
}

func (h *ExecutionHost) consumeResponse(ctx context.Context, body io.Reader) (localexecution.TextResult, error) {
	var payload map[string]any
	decoder := json.NewDecoder(io.LimitReader(body, 16<<20))
	if err := decoder.Decode(&payload); err != nil {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("decode llama inference response: %w", err))
	}
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("llama inference response has no choices"))
	}
	choice, _ := choices[0].(map[string]any)
	message, _ := choice["message"].(map[string]any)
	text := textContent(message["content"])
	if strings.TrimSpace(text) == "" {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("llama inference response has no text"))
	}
	inputTokens, outputTokens := invocationUsage(payload["usage"])
	return localexecution.TextResult{
		Text:         text,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		ComputeMS:    invocationComputeMS(payload),
		FinishReason: mapLlamaFinishReason(stringValue(choice["finish_reason"])),
	}, nil
}

func (h *ExecutionHost) consumeStream(
	ctx context.Context,
	body io.Reader,
	onDelta func(localexecution.TextDelta) error,
) (localexecution.TextResult, error) {
	result := localexecution.TextResult{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}
	var output strings.Builder
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}
		var chunk map[string]any
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("decode llama stream event: %w", err))
		}
		if in, out := invocationUsage(chunk["usage"]); in != 0 || out != 0 {
			result.InputTokens = in
			result.OutputTokens = out
		}
		if computeMS := invocationComputeMS(chunk); computeMS > 0 {
			result.ComputeMS = computeMS
		}
		choices, _ := chunk["choices"].([]any)
		if len(choices) == 0 {
			continue
		}
		choice, _ := choices[0].(map[string]any)
		delta, _ := choice["delta"].(map[string]any)
		text := textContent(delta["content"])
		reasoning := firstString(delta["reasoning"], delta["reasoning_content"])
		if text != "" || reasoning != "" {
			if err := onDelta(localexecution.TextDelta{Text: text, Reasoning: reasoning}); err != nil {
				return localexecution.TextResult{}, h.inferenceFailure(ctx, err)
			}
			output.WriteString(text)
		}
		if finish := stringValue(choice["finish_reason"]); finish != "" {
			result.FinishReason = mapLlamaFinishReason(finish)
		}
	}
	if err := scanner.Err(); err != nil {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("read llama stream: %w", err))
	}
	result.Text = output.String()
	if strings.TrimSpace(result.Text) == "" {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("llama stream completed without text"))
	}
	return result, nil
}

func (h *ExecutionHost) inferenceFailure(ctx context.Context, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return executionFailure(localexecution.FailureCanceled, ctx.Err())
	}
	if h != nil && h.substrate != nil && !h.substrate.Healthy() {
		return executionFailure(localexecution.FailureProcessCrash, err)
	}
	return executionFailure(localexecution.FailureInference, err)
}

func executionFailure(kind localexecution.FailureKind, err error) error {
	return &localexecution.ExecutionError{Kind: kind, Err: err}
}

type llamaExecutionManager interface {
	EngineStatus(EngineKind) (SupervisorInfo, error)
	StopEngine(EngineKind) error
	StartEngine(context.Context, EngineConfig) error
	EngineEndpoint(EngineKind) (string, error)
}

type managerLlamaInvocationSubstrate struct {
	manager  llamaExecutionManager
	lifetime context.Context

	mu         sync.Mutex
	currentKey string
	loading    *managerLlamaInvocationLoad
}

type managerLlamaInvocationLoad struct {
	processKey string
	args       []string
	done       chan struct{}
	endpoint   string
	err        error
}

func newManagerLlamaInvocationSubstrate(manager *Manager) *managerLlamaInvocationSubstrate {
	return &managerLlamaInvocationSubstrate{manager: manager, lifetime: context.Background()}
}

func (s *managerLlamaInvocationSubstrate) Ensure(
	ctx context.Context,
	processKey string,
	processArgs []string,
	progress localexecution.TextProgressFunc,
) (string, bool, error) {
	if s == nil || s.manager == nil {
		return "", false, fmt.Errorf("engine manager is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		s.mu.Lock()
		if s.loading == nil && processKey == s.currentKey {
			endpoint, err := s.manager.EngineEndpoint(EngineLlama)
			if err == nil {
				s.mu.Unlock()
				if progress != nil {
					progress(localexecution.TextExecutionProgressReused)
				}
				return endpoint, true, nil
			}
			s.currentKey = ""
		}
		load := s.loading
		if load == nil {
			load = &managerLlamaInvocationLoad{
				processKey: processKey,
				args:       append([]string(nil), processArgs...),
				done:       make(chan struct{}),
			}
			s.loading = load
			go s.runLoad(load)
		}
		s.mu.Unlock()
		if progress != nil {
			progress(localexecution.TextExecutionProgressLoading)
		}
		select {
		case <-ctx.Done():
			return "", false, ctx.Err()
		case <-load.done:
		}
		if ctx.Err() != nil {
			return "", false, ctx.Err()
		}
		if load.processKey != processKey {
			continue
		}
		if load.err != nil {
			return "", false, load.err
		}
		if progress != nil {
			progress(localexecution.TextExecutionProgressReady)
		}
		return load.endpoint, false, nil
	}
}

func (s *managerLlamaInvocationSubstrate) runLoad(load *managerLlamaInvocationLoad) {
	if info, err := s.manager.EngineStatus(EngineLlama); err == nil && info.Status != StatusStopped {
		if err := s.manager.StopEngine(EngineLlama); err != nil {
			s.finishLoad(load, "", fmt.Errorf("stop prior llama process: %w", err))
			return
		}
	}
	cfg := DefaultLlamaConfig()
	cfg.CommandArgs = append([]string(nil), load.args...)
	if err := s.manager.StartEngine(s.lifetime, cfg); err != nil {
		s.finishLoad(load, "", err)
		return
	}
	endpoint, err := s.manager.EngineEndpoint(EngineLlama)
	s.finishLoad(load, endpoint, err)
}

func (s *managerLlamaInvocationSubstrate) finishLoad(load *managerLlamaInvocationLoad, endpoint string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	load.endpoint = endpoint
	load.err = err
	if err != nil {
		s.currentKey = ""
	} else {
		s.currentKey = load.processKey
	}
	if s.loading == load {
		s.loading = nil
	}
	close(load.done)
}

func (s *managerLlamaInvocationSubstrate) Healthy() bool {
	if s == nil || s.manager == nil {
		return false
	}
	info, err := s.manager.EngineStatus(EngineLlama)
	return err == nil && info.Status == StatusHealthy && info.PID > 0 && supervisorProcessAlive(info.PID)
}

func invocationUsage(value any) (int64, int64) {
	usage, _ := value.(map[string]any)
	input := int64Value(usage["prompt_tokens"])
	output := int64Value(usage["completion_tokens"])
	if output == 0 {
		total := int64Value(usage["total_tokens"])
		if total > input {
			output = total - input
		}
	}
	return input, output
}

func invocationComputeMS(payload map[string]any) int64 {
	usage, _ := payload["usage"].(map[string]any)
	if computeMS := int64Value(usage["compute_ms"]); computeMS > 0 {
		return computeMS
	}
	timings, _ := payload["timings"].(map[string]any)
	promptMS := int64Value(timings["prompt_ms"])
	predictedMS := int64Value(timings["predicted_ms"])
	if promptMS > 0 || predictedMS > 0 {
		return promptMS + predictedMS
	}
	return 0
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case json.Number:
		result, _ := typed.Int64()
		return result
	default:
		return 0
	}
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func firstString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok && text != "" {
			return text
		}
	}
	return ""
}

func textContent(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		var result strings.Builder
		for _, item := range typed {
			part, _ := item.(map[string]any)
			if text := stringValue(part["text"]); text != "" {
				result.WriteString(text)
			}
		}
		return result.String()
	default:
		return ""
	}
}

func mapLlamaFinishReason(value string) runtimev1.FinishReason {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "length", "max_tokens":
		return runtimev1.FinishReason_FINISH_REASON_LENGTH
	case "content_filter":
		return runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER
	case "tool_calls", "function_call":
		return runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
	case "error":
		return runtimev1.FinishReason_FINISH_REASON_ERROR
	default:
		return runtimev1.FinishReason_FINISH_REASON_STOP
	}
}
