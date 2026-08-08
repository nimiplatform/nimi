package engine

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
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
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
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

func (m *fakeLlamaExecutionManager) StartEngine(_ context.Context, config EngineConfig) error {
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
		<-block
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
	if started.Port != config.Port || started.Kind != EngineLlama || fmt.Sprint(started.CommandArgs) != fmt.Sprint(planArgs) {
		t.Fatalf("started config = %+v, want port=%d kind=%s args=%v", started, config.Port, EngineLlama, planArgs)
	}
}

func TestManagerInvocationSubstrateCancellationDoesNotKillInFlightLoad(t *testing.T) {
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
	close(block)
	endpoint, _, err := substrate.Ensure(context.Background(), "plan-a", []string{"--model", "/exact/main.gguf"}, nil, nil)
	if err != nil || endpoint != manager.endpoint {
		t.Fatalf("reuse completed background load: endpoint=%q err=%v", endpoint, err)
	}
	manager.mu.Lock()
	starts, stops := manager.starts, manager.stops
	manager.mu.Unlock()
	if starts != 1 || stops != 0 {
		t.Fatalf("background load lifecycle starts=%d stops=%d", starts, stops)
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
			LocalAssetID:      "asset-" + name,
			AbsolutePath:      modelPath,
			VerifiedContentID: "sha256:" + digestHex,
			EntrySHA256:       digestHex,
		}},
		Request: &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}},
		Stream:  stream,
	})
	if err != nil {
		t.Fatalf("PlanTextInvocation: %v", err)
	}
	return plan
}
