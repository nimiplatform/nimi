package engine

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

type fakeLlamaExecutionManager struct {
	mu             sync.Mutex
	status         EngineStatus
	endpoint       string
	starts         int
	stops          int
	startedConfigs []EngineConfig
	startBlock     chan struct{}
	started        chan struct{}
}

func (m *fakeLlamaExecutionManager) EngineStatus(EngineKind) (SupervisorInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return SupervisorInfo{Kind: EngineLlama, Status: m.status}, nil
}

func (m *fakeLlamaExecutionManager) StopEngine(EngineKind) error {
	m.mu.Lock()
	m.stops++
	m.status = StatusStopped
	m.mu.Unlock()
	return nil
}

func (m *fakeLlamaExecutionManager) StartEngine(ctx context.Context, config EngineConfig) error {
	m.mu.Lock()
	m.starts++
	m.startedConfigs = append(m.startedConfigs, config)
	started := m.started
	block := m.startBlock
	m.mu.Unlock()
	if started != nil {
		select {
		case <-started:
		default:
			close(started)
		}
	}
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	m.mu.Lock()
	m.status = StatusHealthy
	m.mu.Unlock()
	return nil
}

func (m *fakeLlamaExecutionManager) EngineEndpoint(EngineKind) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.endpoint, nil
}

func (m *fakeLlamaExecutionManager) ValidateLlamaDependencySources(EngineConfig, []capabilitydriver.InvocationExactDependencySource) error {
	return nil
}

type fakeLlamaInvocationSubstrate struct {
	mu         sync.Mutex
	endpoint   string
	currentKey string
	starts     int
	args       [][]string
	ensureErr  error
	healthy    bool
}

func (f *fakeLlamaInvocationSubstrate) Ensure(
	_ context.Context,
	key string,
	args []string,
	validateContent func() error,
	progress localexecution.TextProgressFunc,
) (string, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.ensureErr != nil {
		return "", false, f.ensureErr
	}
	if key == f.currentKey && f.healthy {
		if progress != nil {
			progress(localexecution.TextExecutionProgressReused)
		}
		return f.endpoint, true, nil
	}
	if validateContent != nil {
		if err := validateContent(); err != nil {
			return "", false, err
		}
	}
	if progress != nil {
		progress(localexecution.TextExecutionProgressLoading)
	}
	f.starts++
	f.currentKey = key
	f.healthy = true
	f.args = append(f.args, append([]string(nil), args...))
	if progress != nil {
		progress(localexecution.TextExecutionProgressReady)
	}
	return f.endpoint, false, nil
}

func (f *fakeLlamaInvocationSubstrate) Healthy() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.healthy
}

func TestManagerInvocationSubstrateStartsWithoutStoppingAbsentWorker(t *testing.T) {
	manager := &fakeLlamaExecutionManager{status: StatusStopped, endpoint: "http://127.0.0.1:1234"}
	substrate := newManagerLlamaInvocationSubstrate(nil)
	substrate.manager = manager
	var progress []localexecution.TextExecutionProgress
	endpoint, reused, err := substrate.Ensure(context.Background(), "plan-a", []string{"--model", "/exact/main.gguf"}, nil, func(stage localexecution.TextExecutionProgress) {
		progress = append(progress, stage)
	})
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	manager.mu.Lock()
	starts, stops := manager.starts, manager.stops
	manager.mu.Unlock()
	if endpoint != manager.endpoint || reused || starts != 1 || stops != 0 {
		t.Fatalf("endpoint=%q reused=%t starts=%d stops=%d", endpoint, reused, starts, stops)
	}
	want := []localexecution.TextExecutionProgress{localexecution.TextExecutionProgressLoading, localexecution.TextExecutionProgressReady}
	if fmt.Sprint(progress) != fmt.Sprint(want) {
		t.Fatalf("progress = %v, want %v", progress, want)
	}
}

func TestManagerInvocationSubstrateRevalidatesAfterStopAndBeforeStart(t *testing.T) {
	manager := &fakeLlamaExecutionManager{status: StatusHealthy, endpoint: "http://127.0.0.1:1234"}
	substrate := newManagerLlamaInvocationSubstrate(nil)
	substrate.manager = manager
	validatedAtSpawnBoundary := false
	_, _, err := substrate.Ensure(context.Background(), "replacement-plan", []string{"--model", "/exact/main.gguf"}, func() error {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		validatedAtSpawnBoundary = manager.stops == 1 && manager.starts == 0 && manager.status == StatusStopped
		return executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("replacement detected"))
	}, nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureContentMismatch {
		t.Fatalf("spawn-boundary validation kind = %q, err=%v", localexecution.FailureKindOf(err), err)
	}
	manager.mu.Lock()
	starts, stops := manager.starts, manager.stops
	manager.mu.Unlock()
	if !validatedAtSpawnBoundary || starts != 0 || stops != 1 {
		t.Fatalf("spawn-boundary validation observed=%t starts=%d stops=%d", validatedAtSpawnBoundary, starts, stops)
	}
}

func TestManagerInvocationSubstrateUsesExplicitHostConfig(t *testing.T) {
	manager := &fakeLlamaExecutionManager{status: StatusStopped, endpoint: "http://127.0.0.1:45678"}
	config := DefaultLlamaConfig()
	config.Version = "llama-config-override"
	config.Port = 45678
	config.CommandArgs = []string{"caller-command-args-must-not-run"}
	substrate := newManagerLlamaInvocationSubstrateWithConfig(nil, config)
	substrate.manager = manager
	planArgs := []string{"--model", "/exact/main.gguf"}
	if _, _, err := substrate.Ensure(context.Background(), "plan-explicit", planArgs, nil, nil); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if len(manager.startedConfigs) != 1 {
		t.Fatalf("started configs = %d, want 1", len(manager.startedConfigs))
	}
	started := manager.startedConfigs[0]
	if started.Version != config.Version || started.Port != config.Port || started.Kind != EngineLlama || fmt.Sprint(started.CommandArgs) != fmt.Sprint(planArgs) {
		t.Fatalf("started config = %+v, want version=%s port=%d kind=%s args=%v", started, config.Version, config.Port, EngineLlama, planArgs)
	}
}

func TestNewExecutionHostWithLlamaConfigRejectsMissingVersion(t *testing.T) {
	config := DefaultLlamaConfig()
	config.Version = "  "
	if _, err := NewExecutionHostWithLlamaConfig(&Manager{}, nil, config); err == nil || !strings.Contains(err.Error(), "version is required") {
		t.Fatalf("missing version error = %v", err)
	}
}

func TestManagerInvocationSubstrateLastWaiterCancellationStopsInFlightLoad(t *testing.T) {
	block := make(chan struct{})
	manager := &fakeLlamaExecutionManager{
		status: StatusStopped, endpoint: "http://127.0.0.1:1234", startBlock: block, started: make(chan struct{}),
	}
	substrate := newManagerLlamaInvocationSubstrate(nil)
	substrate.manager = manager
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, _, err := substrate.Ensure(ctx, "plan-a", []string{"--model", "/exact/main.gguf"}, nil, nil)
		result <- err
	}()
	select {
	case <-manager.started:
	case <-time.After(2 * time.Second):
		t.Fatal("load did not start")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled Ensure error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled Ensure waited for process loading")
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		substrate.mu.Lock()
		loading := substrate.loading
		substrate.mu.Unlock()
		if loading == nil {
			break
		}
		time.Sleep(time.Millisecond)
	}
	substrate.mu.Lock()
	loading := substrate.loading
	substrate.mu.Unlock()
	if loading != nil {
		t.Fatal("last waiter cancellation did not stop in-flight load")
	}
	close(block)
	endpoint, _, err := substrate.Ensure(context.Background(), "plan-a", []string{"--model", "/exact/main.gguf"}, nil, nil)
	if err != nil || endpoint != manager.endpoint {
		t.Fatalf("reuse completed background load: endpoint=%q err=%v", endpoint, err)
	}
	manager.mu.Lock()
	starts, stops := manager.starts, manager.stops
	manager.mu.Unlock()
	if starts != 2 || stops != 0 {
		t.Fatalf("canceled/retried load lifecycle starts=%d stops=%d", starts, stops)
	}
}

func TestManagerInvocationSubstrateOneCanceledWaiterKeepsSharedLoad(t *testing.T) {
	block := make(chan struct{})
	manager := &fakeLlamaExecutionManager{
		status: StatusStopped, endpoint: "http://127.0.0.1:1234", startBlock: block, started: make(chan struct{}),
	}
	substrate := newManagerLlamaInvocationSubstrate(nil)
	substrate.manager = manager
	ctx, cancel := context.WithCancel(context.Background())
	canceledResult := make(chan error, 1)
	readyResult := make(chan error, 1)
	go func() {
		_, _, err := substrate.Ensure(ctx, "plan-a", []string{"--model", "/exact/main.gguf"}, nil, nil)
		canceledResult <- err
	}()
	select {
	case <-manager.started:
	case <-time.After(2 * time.Second):
		t.Fatal("load did not start")
	}
	go func() {
		_, _, err := substrate.Ensure(context.Background(), "plan-a", []string{"--model", "/exact/main.gguf"}, nil, nil)
		readyResult <- err
	}()
	time.Sleep(10 * time.Millisecond)
	cancel()
	if err := <-canceledResult; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled waiter error = %v", err)
	}
	close(block)
	if err := <-readyResult; err != nil {
		t.Fatalf("remaining waiter error = %v", err)
	}
	manager.mu.Lock()
	starts := manager.starts
	manager.mu.Unlock()
	if starts != 1 {
		t.Fatalf("shared load started %d times, want one", starts)
	}
}

func TestExecutionHostReusesOnlyTheCapturedProcessPlan(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer server.Close()

	substrate := &fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}
	host := newExecutionHostWithSubstrate(substrate, server.Client())
	first := llamaInvocationPlanForHostTest(t, "first", nil, false)
	second := llamaInvocationPlanForHostTest(t, "second", nil, false)
	var progress []localexecution.TextExecutionProgress
	for _, plan := range []*capabilitydriver.TextInvocationPlan{first, first, second} {
		result, err := host.ExecuteText(context.Background(), plan, func(stage localexecution.TextExecutionProgress) {
			progress = append(progress, stage)
		})
		if err != nil || result.Text != "ok" {
			t.Fatalf("ExecuteText = %+v, %v", result, err)
		}
	}
	if substrate.starts != 2 {
		t.Fatalf("process starts = %d, want 2 (same plan reuse then exact swap)", substrate.starts)
	}
	wantProgress := []localexecution.TextExecutionProgress{
		localexecution.TextExecutionProgressLoading, localexecution.TextExecutionProgressReady,
		localexecution.TextExecutionProgressReused,
		localexecution.TextExecutionProgressLoading, localexecution.TextExecutionProgressReady,
	}
	if fmt.Sprint(progress) != fmt.Sprint(wantProgress) {
		t.Fatalf("progress = %v, want %v", progress, wantProgress)
	}
	if len(substrate.args) != 2 || !strings.Contains(strings.Join(substrate.args[0], " "), "first.gguf") ||
		!strings.Contains(strings.Join(substrate.args[1], " "), "second.gguf") {
		t.Fatalf("captured process args = %#v", substrate.args)
	}
}

func TestExecutionHostStreamsSSEDeltasAndUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprintln(w, `data: {"choices":[{"delta":{"content":"he"}}]}`)
		_, _ = fmt.Fprintln(w)
		_, _ = fmt.Fprintln(w, `data: {"choices":[{"delta":{"content":"llo"},"finish_reason":"length"}],"usage":{"prompt_tokens":4,"completion_tokens":2},"timings":{"prompt_ms":6,"predicted_ms":9}}`)
		_, _ = fmt.Fprintln(w)
		_, _ = fmt.Fprintln(w, "data: [DONE]")
	}))
	defer server.Close()
	substrate := &fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}
	host := newExecutionHostWithSubstrate(substrate, server.Client())
	var deltas []string
	result, err := host.StreamText(
		context.Background(),
		llamaInvocationPlanForHostTest(t, "stream", nil, true),
		func(delta localexecution.TextDelta) error {
			deltas = append(deltas, delta.Text)
			return nil
		},
		nil,
	)
	if err != nil {
		t.Fatalf("StreamText: %v", err)
	}
	if strings.Join(deltas, "") != "hello" || result.Text != "hello" || result.InputTokens != 4 || result.OutputTokens != 2 ||
		result.ComputeMS != 15 || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_LENGTH {
		t.Fatalf("stream deltas=%v result=%+v", deltas, result)
	}
}

type syntheticTextBehaviorStreamEvent struct {
	Kind     string `json:"kind"`
	Index    uint32 `json:"index"`
	Text     string `json:"text"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Args     string `json:"args"`
	Complete bool   `json:"complete"`
}

type syntheticTextBehaviorStreamAssembler struct {
	ordered *textbehavior.OrderedStreamAssembler
}

func (assembler *syntheticTextBehaviorStreamAssembler) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	var event syntheticTextBehaviorStreamEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, err
	}
	fragment := textbehavior.PrivateFragment{ItemIndex: event.Index, Text: event.Text, Complete: event.Complete}
	switch event.Kind {
	case "reasoning":
		fragment.Kind = textbehavior.OrderedItemReasoningSummary
	case "tool":
		fragment.Kind = textbehavior.OrderedItemToolCall
		fragment.ToolCall = &textbehavior.ToolCallFragment{IDPart: event.ID, NamePart: event.Name, ArgumentsJSONPart: event.Args}
	case "text":
		fragment.Kind = textbehavior.OrderedItemText
	default:
		return nil, fmt.Errorf("unknown synthetic stream event")
	}
	return assembler.ordered.AppendFragment(fragment)
}

func (assembler *syntheticTextBehaviorStreamAssembler) Finish() (textbehavior.NormalizedResult, error) {
	items, err := assembler.ordered.FinishItems()
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return textbehavior.NormalizedResult{
		Items: items, FinishReason: runtimev1.FinishReason_FINISH_REASON_TOOL_CALL,
		Usage: &runtimev1.UsageStats{InputTokens: 7, OutputTokens: 5, ComputeMs: 11},
	}, nil
}

func TestExecutionHostRunsResolvedTextBehaviorHooksAndOrderedOutput(t *testing.T) {
	var syncRequestBody []byte
	syncServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/x-nimi-behavior" {
			t.Errorf("sync content type = %q", r.Header.Get("Content-Type"))
		}
		syncRequestBody, _ = io.ReadAll(r.Body)
		_, _ = w.Write([]byte(`{"engine":"synthetic-sync"}`))
	}))
	defer syncServer.Close()
	adapter := syntheticExecutionTextBehaviorAdapter(t)
	syncPlan := llamaTextBehaviorInvocationPlanForHostTest(t, "behavior-sync", false, adapter)
	syncHost := newExecutionHostWithSubstrate(&fakeLlamaInvocationSubstrate{endpoint: syncServer.URL, healthy: true}, syncServer.Client())
	syncResult, err := syncHost.ExecuteText(context.Background(), syncPlan, nil)
	if err != nil {
		t.Fatalf("ExecuteText behavior adapter: %v", err)
	}
	if string(syncRequestBody) != `{"adapter":"synthetic","stream":false,"tools":2}` || len(syncResult.Items) != 3 ||
		syncResult.Items[0].Kind != textbehavior.OrderedItemReasoningSummary ||
		syncResult.Items[1].ToolCall.GetId() != "call-sync" || syncResult.Items[2].Text != "done" || syncResult.Text != "done" {
		t.Fatalf("sync request=%s result=%+v", syncRequestBody, syncResult)
	}

	streamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"kind":"reasoning","index":0,"text":"check","complete":false}`,
			`{"kind":"tool","index":1,"id":"call-","name":"look","args":"{\"city\":"}`,
			`{"kind":"reasoning","index":0,"text":"ing","complete":true}`,
			`{"kind":"tool","index":1,"id":"1","name":"up","args":"\"Paris\"}","complete":true}`,
			`{"kind":"tool","index":2,"id":"call-2","name":"weather","args":"{}","complete":true}`,
			`{"kind":"text","index":3,"text":"done","complete":true}`,
		} {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", event)
		}
		_, _ = fmt.Fprintln(w, "data: [DONE]")
	}))
	defer streamServer.Close()
	streamHost := newExecutionHostWithSubstrate(&fakeLlamaInvocationSubstrate{endpoint: streamServer.URL, healthy: true}, streamServer.Client())
	streamPlan := llamaTextBehaviorInvocationPlanForHostTest(t, "behavior-stream", true, adapter)
	var deltas []textbehavior.OrderedDelta
	streamResult, err := streamHost.StreamText(context.Background(), streamPlan, func(delta localexecution.TextDelta) error {
		if delta.Text != "" || delta.Ordered == nil {
			return fmt.Errorf("adapter delta leaked into base carrier: %+v", delta)
		}
		deltas = append(deltas, *delta.Ordered)
		return nil
	}, nil)
	if err != nil {
		t.Fatalf("StreamText behavior adapter: %v", err)
	}
	if len(deltas) != 5 || deltas[0].Kind != textbehavior.OrderedItemReasoningSummary || deltas[1].ItemCompleted != true ||
		deltas[2].ToolCall.GetId() != "call-1" || deltas[3].ToolCall.GetId() != "call-2" || deltas[4].Text != "done" ||
		len(streamResult.Items) != 4 || streamResult.Text != "done" || streamResult.InputTokens != 7 || streamResult.OutputTokens != 5 {
		t.Fatalf("stream deltas=%+v result=%+v", deltas, streamResult)
	}
}

func TestExecutionHostRejectsRawReasoningOnlyAsTypedIncomplete(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%t", stream), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if stream {
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = fmt.Fprintln(w, `data: {"choices":[{"delta":{"reasoning_content":"private raw chain"},"finish_reason":"length"}]}`)
					_, _ = fmt.Fprintln(w, "data: [DONE]")
					return
				}
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"","reasoning_content":"private raw chain"},"finish_reason":"length"}]}`))
			}))
			defer server.Close()
			host := newExecutionHostWithSubstrate(&fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}, server.Client())
			plan := llamaInvocationPlanForHostTest(t, "raw-reasoning-only", nil, stream)
			var err error
			if stream {
				_, err = host.StreamText(context.Background(), plan, func(delta localexecution.TextDelta) error {
					t.Fatalf("raw reasoning was exposed: %+v", delta)
					return nil
				}, nil)
			} else {
				_, err = host.ExecuteText(context.Background(), plan, nil)
			}
			if localexecution.FailureKindOf(err) != localexecution.FailureTextOutputIncomplete {
				t.Fatalf("raw-only failure = %v kind=%q", err, localexecution.FailureKindOf(err))
			}
		})
	}
}

func TestExecutionHostPreservesReasoningContinuityFailureCategory(t *testing.T) {
	host := &ExecutionHost{}
	err := host.textBehaviorInferenceFailure(context.Background(), grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID))
	if localexecution.FailureKindOf(err) != localexecution.FailureTextOutputInvalid {
		t.Fatalf("reasoning continuity failure = %v kind=%q", err, localexecution.FailureKindOf(err))
	}
}

func TestExecutionHostRejectsAdapterHiddenReasoningWithoutPublicOutputAsTypedIncomplete(t *testing.T) {
	templateIdentity := "sha256:" + strings.Repeat("c", 64)
	adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{
		AdapterID: "synthetic-hidden-reasoning", Version: "1", RequestSerializerID: "synthetic/request/v1",
		NonStreamParserID: "synthetic/hidden/v1", StreamAssemblerID: "synthetic/stream/v1",
		RequiredTemplateIdentity: templateIdentity, ProcessIdentityImpact: textbehavior.ProcessIdentityAdapterAndTemplate,
	}, func(_ *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
		return textbehavior.SerializedRequest{ContentType: "application/json", Payload: []byte(`{"stream":false}`)}, nil
	}, func(_ []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
		// An exact adapter may consume native hidden reasoning, but it cannot
		// convert a raw-only response into an empty success.
		return textbehavior.NormalizedResult{FinishReason: runtimev1.FinishReason_FINISH_REASON_LENGTH}, nil
	}, func(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
		return &syntheticTextBehaviorStreamAssembler{ordered: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), nil)}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"reasoning_content":"private raw chain","finish_reason":"length"}`))
	}))
	defer server.Close()
	host := newExecutionHostWithSubstrate(&fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}, server.Client())
	_, err = host.ExecuteText(context.Background(), llamaTextBehaviorInvocationPlanForHostTest(t, "hidden-reasoning-only", false, adapter), nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureTextOutputIncomplete {
		t.Fatalf("adapter raw-only failure = %v kind=%q", err, localexecution.FailureKindOf(err))
	}
}

func TestExecutionHostExecutesCapturedEmbeddingPlan(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/embeddings" {
			t.Fatalf("request path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"index":1,"embedding":[0.3,0.4]},{"index":0,"embedding":[0.1,0.2]}],"usage":{"prompt_tokens":7}}`))
	}))
	defer server.Close()

	substrate := &fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}
	host := newExecutionHostWithSubstrate(substrate, server.Client())
	result, err := host.ExecuteEmbed(context.Background(), llamaEmbedInvocationPlanForHostTest(t, "embedding"), nil)
	if err != nil {
		t.Fatalf("ExecuteEmbed: %v", err)
	}
	if len(result.Vectors) != 2 || result.Vectors[0].GetValues()[0] != 0.1 ||
		result.Vectors[1].GetValues()[0] != 0.3 || result.InputTokens != 7 {
		t.Fatalf("embedding result = %+v", result)
	}
	if substrate.starts != 1 || !containsString(substrate.args[0], "--embedding") {
		t.Fatalf("embedding substrate starts=%d args=%v", substrate.starts, substrate.args)
	}
}

func TestExecutionHostQueuedRequestCancellationDoesNotWaitForResidentLease(t *testing.T) {
	requestStarted := make(chan struct{})
	release := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-release
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintln(w, `{"choices":[{"message":{"content":"done"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()
	substrate := &fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}
	host := newExecutionHostWithSubstrate(substrate, server.Client())
	firstDone := make(chan error, 1)
	go func() {
		_, err := host.ExecuteText(context.Background(), llamaInvocationPlanForHostTest(t, "queued", nil, false), nil)
		firstDone <- err
	}()
	select {
	case <-requestStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("first inference did not acquire the lease")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	startedAt := time.Now()
	_, err := host.ExecuteText(ctx, llamaInvocationPlanForHostTest(t, "queued", nil, false), nil)
	if time.Since(startedAt) > time.Second {
		t.Fatal("canceled queued request waited for the resident lease")
	}
	var executionErr *localexecution.ExecutionError
	if !errors.As(err, &executionErr) || executionErr.Kind != localexecution.FailureCanceled {
		t.Fatalf("queued cancellation error = %v", err)
	}
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatalf("first inference: %v", err)
	}
}

func TestExecutionHostStreamCancellationClosesInferenceRequestButKeepsProcess(t *testing.T) {
	requestStarted := make(chan struct{})
	requestCanceled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		close(requestStarted)
		<-r.Context().Done()
		close(requestCanceled)
	}))
	defer server.Close()

	substrate := &fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}
	host := newExecutionHostWithSubstrate(substrate, server.Client())
	plan := llamaInvocationPlanForHostTest(t, "cancel", nil, true)
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		_, err := host.StreamText(ctx, plan, func(localexecution.TextDelta) error { return nil }, nil)
		errCh <- err
	}()
	select {
	case <-requestStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("stream request did not start")
	}
	cancel()
	select {
	case err := <-errCh:
		if localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
			t.Fatalf("stream cancel error = %v (%s)", err, localexecution.FailureKindOf(err))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("StreamText did not return after cancellation")
	}
	select {
	case <-requestCanceled:
	case <-time.After(2 * time.Second):
		t.Fatal("HTTP inference request was not canceled")
	}
	if !substrate.Healthy() || substrate.starts != 1 {
		t.Fatalf("cancel changed resident process: healthy=%v starts=%d", substrate.Healthy(), substrate.starts)
	}
}

func TestExecutionHostClassifiesResidentProcessCrash(t *testing.T) {
	substrate := &fakeLlamaInvocationSubstrate{healthy: true}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		substrate.mu.Lock()
		substrate.healthy = false
		substrate.mu.Unlock()
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			t.Error("test server does not support hijacking")
			return
		}
		connection, _, err := hijacker.Hijack()
		if err != nil {
			t.Errorf("hijack: %v", err)
			return
		}
		_ = connection.Close()
	}))
	defer server.Close()
	substrate.endpoint = server.URL
	host := newExecutionHostWithSubstrate(substrate, server.Client())
	_, err := host.ExecuteText(context.Background(), llamaInvocationPlanForHostTest(t, "crash", nil, false), nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureProcessCrash {
		t.Fatalf("process crash kind = %q, err=%v", localexecution.FailureKindOf(err), err)
	}
}

func TestExecutionHostClassifiesLoadFailure(t *testing.T) {
	substrate := &fakeLlamaInvocationSubstrate{ensureErr: fmt.Errorf("model mmap failed")}
	host := newExecutionHostWithSubstrate(substrate, nil)
	_, err := host.ExecuteText(context.Background(), llamaInvocationPlanForHostTest(t, "broken", nil, false), nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureLoad {
		t.Fatalf("load failure kind = %q, err=%v", localexecution.FailureKindOf(err), err)
	}
}

func TestExecutionHostClassifiesExplicitLoadOOM(t *testing.T) {
	substrate := &fakeLlamaInvocationSubstrate{ensureErr: fmt.Errorf("CUDA_ERROR_OUT_OF_MEMORY while allocating model")}
	host := newExecutionHostWithSubstrate(substrate, nil)
	_, err := host.ExecuteText(context.Background(), llamaInvocationPlanForHostTest(t, "oom", nil, false), nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureOutOfMemory {
		t.Fatalf("load OOM kind = %q, err=%v", localexecution.FailureKindOf(err), err)
	}
}

func TestManagerValidatesCapturedLlamaPackageSourceAgainstRegistry(t *testing.T) {
	roots := testManagedRoots(t)
	mgr, err := NewManager(testLogger(), roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	version := DefaultLlamaConfig().Version
	binary := filepath.Join(roots.Environments, "llama", version, llamaBinaryName())
	if err := os.MkdirAll(filepath.Dir(binary), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("binary"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := mgr.registry.Put(&RegistryEntry{Engine: EngineLlama, Version: version, BinaryPath: binary, SHA256: "archive-sha", Platform: "darwin/arm64", AssetName: "llama-" + version + "-bin-macos-arm64.tar.gz", AcceleratorPlane: "metal"}); err != nil {
		t.Fatal(err)
	}
	sources := []capabilitydriver.InvocationExactDependencySource{{
		DependencyFamily: "native-engine-package.llama", DependencyID: "llama.cpp.package", ConsumerScope: "llama.cpp.metal",
		SelectedSourceRecordID: "source-llama", CanonicalRoot: binary, Version: version, VerifiedArtifacts: []string{binary}, Hashes: map[string]string{"sha256": "archive-sha"},
	}}
	if err := mgr.ValidateLlamaDependencySources(EngineConfig{Version: version}, sources); err != nil {
		t.Fatalf("matching captured source: %v", err)
	}
	sources[0].CanonicalRoot = filepath.Join(t.TempDir(), "other-llama-server")
	if err := mgr.ValidateLlamaDependencySources(EngineConfig{Version: version}, sources); err == nil {
		t.Fatal("registry drift did not reject captured llama package source")
	}
}

func TestInvocationContentSealCoversCompleteDeclaredBundleIdentity(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(t *testing.T, binding *capabilitydriver.InvocationExactBinding)
		want   localexecution.FailureKind
	}{
		{name: "original bytes"},
		{
			name: "same-size sibling drift",
			mutate: func(t *testing.T, binding *capabilitydriver.InvocationExactBinding) {
				path := filepath.Join(binding.BundleDir, "tokenizer.json")
				original, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, bytes.Repeat([]byte{'x'}, len(original)), 0o600); err != nil {
					t.Fatal(err)
				}
			},
			want: localexecution.FailureContentMismatch,
		},
		{
			name: "missing sibling",
			mutate: func(t *testing.T, binding *capabilitydriver.InvocationExactBinding) {
				if err := os.Remove(filepath.Join(binding.BundleDir, "tokenizer.json")); err != nil {
					t.Fatal(err)
				}
			},
			want: localexecution.FailureContentMismatch,
		},
		{
			name: "declared order drift",
			mutate: func(_ *testing.T, binding *capabilitydriver.InvocationExactBinding) {
				binding.DeclaredFiles[0], binding.DeclaredFiles[1] = binding.DeclaredFiles[1], binding.DeclaredFiles[0]
			},
			want: localexecution.FailureContentMismatch,
		},
		{
			name: "undeclared regular payload",
			mutate: func(t *testing.T, binding *capabilitydriver.InvocationExactBinding) {
				if err := os.WriteFile(filepath.Join(binding.BundleDir, "generation_config.json"), []byte(`{"undeclared":true}`), 0o600); err != nil {
					t.Fatal(err)
				}
			},
			want: localexecution.FailureContentMismatch,
		},
		{
			name: "canonical manifest control file",
			mutate: func(t *testing.T, binding *capabilitydriver.InvocationExactBinding) {
				if err := os.WriteFile(filepath.Join(binding.BundleDir, "asset.manifest.json"), []byte(`{"schema_version":"test"}`), 0o600); err != nil {
					t.Fatal(err)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			binding := speechBindingFixture(t, "model.gguf", map[string][]byte{
				"model.gguf":     []byte("captured-model"),
				"tokenizer.json": []byte("captured-tokenizer"),
			})
			if test.mutate != nil {
				test.mutate(t, &binding)
			}
			err := validateInvocationModelContent([]capabilitydriver.InvocationExactBinding{binding})
			if got := localexecution.FailureKindOf(err); got != test.want {
				t.Fatalf("bundle seal error=%v kind=%q, want %q", err, got, test.want)
			}
		})
	}
}

func TestExecutionHostRejectsCapturedContentDriftBeforeSpawn(t *testing.T) {
	substrate := &fakeLlamaInvocationSubstrate{endpoint: "http://127.0.0.1:1", healthy: true}
	host := newExecutionHostWithSubstrate(substrate, nil)
	plan := llamaInvocationPlanForHostTest(t, "drift", nil, false)
	files := plan.ModelFiles()
	if len(files) != 1 {
		t.Fatalf("captured model files = %d, want 1", len(files))
	}
	if err := os.WriteFile(files[0].AbsolutePath, []byte("replacement model bytes"), 0o600); err != nil {
		t.Fatalf("replace captured model: %v", err)
	}
	_, err := host.ExecuteText(context.Background(), plan, nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureContentMismatch {
		t.Fatalf("content drift kind = %q, err=%v", localexecution.FailureKindOf(err), err)
	}
	if substrate.starts != 0 {
		t.Fatalf("content drift spawned %d process(es)", substrate.starts)
	}
}

func llamaInvocationPlanForHostTest(t *testing.T, name string, portable *structpb.Struct, stream bool) *capabilitydriver.TextInvocationPlan {
	t.Helper()
	modelBytes := []byte("captured model bytes for " + name)
	digest := sha256.Sum256(modelBytes)
	digestHex := fmt.Sprintf("%x", digest[:])
	modelPath := filepath.Join(t.TempDir(), name+".gguf")
	if err := os.WriteFile(modelPath, modelBytes, 0o600); err != nil {
		t.Fatalf("write captured model: %v", err)
	}
	plan, err := (capabilitydriver.LlamaTextDriver{}).PlanTextInvocation(capabilitydriver.TextInvocationInput{
		PortableConfig:           portable,
		ModelContextWindowTokens: 32768,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			RequirementID:     capabilitydriver.MainGGUFRequirementID,
			ModelAssetID:      "asset-" + name,
			AbsolutePath:      modelPath,
			VerifiedContentID: "sha256:" + digestHex,
			EntrySHA256:       digestHex,
		}},
		BehaviorMatch: capabilitydriver.TextBehaviorAdapterMatchFacts{
			RecipeID: capabilitydriver.LlamaGemma4RecipeID, RecipeRevision: "test-revision", DriverDialect: capabilitydriver.LlamaDriverDialect,
			ModelAssetID: "asset-" + name, VerifiedContentID: "sha256:" + digestHex, EntrySHA256: digestHex,
		},
		Request: &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}},
		Stream:  stream,
	})
	if err != nil {
		t.Fatalf("PlanTextInvocation: %v", err)
	}
	return plan
}

func syntheticExecutionTextBehaviorAdapter(t *testing.T) *textbehavior.Adapter {
	t.Helper()
	templateIdentity := "sha256:" + strings.Repeat("c", 64)
	adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{
		AdapterID: "synthetic-exact", Version: "1", RequestSerializerID: "synthetic/request/v1",
		NonStreamParserID: "synthetic/sync/v1", StreamAssemblerID: "synthetic/stream/v1",
		RequiredTemplateIdentity: templateIdentity, ProcessIdentityImpact: textbehavior.ProcessIdentityAdapterAndTemplate,
	}, func(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		payload, err := json.Marshal(map[string]any{"adapter": "synthetic", "stream": stream, "tools": len(spec.GetTools())})
		return textbehavior.SerializedRequest{ContentType: "application/x-nimi-behavior", Payload: payload}, err
	}, func(payload []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
		var value map[string]any
		if err := json.Unmarshal(payload, &value); err != nil || value["engine"] != "synthetic-sync" {
			return textbehavior.NormalizedResult{}, fmt.Errorf("unexpected synthetic sync response")
		}
		return textbehavior.NormalizedResult{
			Items: []textbehavior.OrderedItem{
				{Kind: textbehavior.OrderedItemReasoningSummary, Text: "checked"},
				{Kind: textbehavior.OrderedItemToolCall, ToolCall: &runtimev1.ToolCall{Id: "call-sync", Name: "lookup", ArgumentsJson: `{"city":"Paris"}`}},
				{Kind: textbehavior.OrderedItemText, Text: "done"},
			},
			FinishReason: runtimev1.FinishReason_FINISH_REASON_TOOL_CALL,
			Usage:        &runtimev1.UsageStats{InputTokens: 3, OutputTokens: 2, ComputeMs: 5},
		}, nil
	}, func(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
		return &syntheticTextBehaviorStreamAssembler{ordered: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), nil)}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}

func llamaTextBehaviorInvocationPlanForHostTest(t *testing.T, name string, stream bool, adapter *textbehavior.Adapter) *capabilitydriver.TextInvocationPlan {
	t.Helper()
	modelBytes := []byte("captured behavior model bytes for " + name)
	digest := sha256.Sum256(modelBytes)
	digestHex := fmt.Sprintf("%x", digest[:])
	modelPath := filepath.Join(t.TempDir(), name+".gguf")
	if err := os.WriteFile(modelPath, modelBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	templateIdentity := "sha256:" + strings.Repeat("c", 64)
	plan, err := (capabilitydriver.LlamaTextDriver{}).PlanTextInvocation(capabilitydriver.TextInvocationInput{
		ModelContextWindowTokens: 32768,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			RequirementID: capabilitydriver.MainGGUFRequirementID, ModelAssetID: "asset-" + name,
			AbsolutePath: modelPath, VerifiedContentID: "sha256:" + digestHex, EntrySHA256: digestHex,
			TemplateIdentity: templateIdentity,
		}},
		BehaviorMatch: capabilitydriver.TextBehaviorAdapterMatchFacts{
			RecipeID: capabilitydriver.LlamaGemma4RecipeID, RecipeRevision: "test-revision", DriverDialect: capabilitydriver.LlamaDriverDialect,
			ModelAssetID: "asset-" + name, VerifiedContentID: "sha256:" + digestHex, EntrySHA256: digestHex,
			TemplateIdentity: templateIdentity,
		},
		BehaviorAdapter: adapter,
		Request: &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{Role: "user", Content: "use tools"}},
			Reasoning: &runtimev1.ReasoningConfig{
				Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE,
				Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
				Intensity:    &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW},
			},
			Tools: []*runtimev1.ToolSpec{
				{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup"},
				{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "weather"},
			},
		},
		Stream: stream,
	})
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func llamaEmbedInvocationPlanForHostTest(t *testing.T, name string) *capabilitydriver.EmbedInvocationPlan {
	t.Helper()
	modelBytes := []byte("captured embedding model bytes for " + name)
	digest := sha256.Sum256(modelBytes)
	digestHex := fmt.Sprintf("%x", digest[:])
	modelPath := filepath.Join(t.TempDir(), name+".gguf")
	if err := os.WriteFile(modelPath, modelBytes, 0o600); err != nil {
		t.Fatalf("write captured embedding model: %v", err)
	}
	plan, err := (capabilitydriver.LlamaEmbedDriver{}).PlanEmbedInvocation(capabilitydriver.EmbedInvocationInput{
		ModelContextWindowTokens: 8192,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			RequirementID:     capabilitydriver.EmbeddingGGUFRequirementID,
			ModelAssetID:      "asset-" + name,
			AbsolutePath:      modelPath,
			VerifiedContentID: "sha256:" + digestHex,
			EntrySHA256:       digestHex,
		}},
		Request: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"first", "second"}},
	})
	if err != nil {
		t.Fatalf("PlanEmbedInvocation: %v", err)
	}
	return plan
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
