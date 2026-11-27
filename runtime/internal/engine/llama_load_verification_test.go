package engine

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type trackedLlamaExecutionManager struct {
	mu               sync.Mutex
	status           EngineStatus
	endpoint         string
	port             int
	pid              int
	supervisorSeq    int
	spawnSeq         int
	supervisorID     string
	instanceID       string
	preSpawnVerified bool
	starts           int
	stops            int
	depValidations   int
	depErr           error
	startedConfigs   []EngineConfig
}

func newTrackedLlamaExecutionManager(endpoint string) *trackedLlamaExecutionManager {
	return &trackedLlamaExecutionManager{
		status:   StatusStopped,
		endpoint: endpoint,
		port:     1234,
		pid:      4242,
	}
}

func (m *trackedLlamaExecutionManager) EngineStatus(EngineKind) (SupervisorInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	info := SupervisorInfo{
		Kind:                 EngineLlama,
		Port:                 m.port,
		Status:               m.status,
		PID:                  m.pid,
		Endpoint:             m.endpoint,
		SupervisorInstanceID: m.supervisorID,
	}
	if m.status == StatusHealthy {
		info.ProcessInstanceID = m.instanceID
		info.PreSpawnVerified = m.preSpawnVerified
	}
	return info, nil
}

func (m *trackedLlamaExecutionManager) StopEngine(EngineKind) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stops++
	m.status = StatusStopped
	m.instanceID = ""
	m.preSpawnVerified = false
	return nil
}

func (m *trackedLlamaExecutionManager) StartEngine(_ context.Context, cfg EngineConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.starts++
	m.supervisorSeq++
	m.spawnSeq = 1
	m.supervisorID = fmt.Sprintf("sup-%d", m.supervisorSeq)
	m.instanceID = fmt.Sprintf("%s:%d", m.supervisorID, m.spawnSeq)
	m.preSpawnVerified = cfg.PreSpawnValidated
	m.status = StatusHealthy
	m.startedConfigs = append(m.startedConfigs, cfg)
	return nil
}

func (m *trackedLlamaExecutionManager) EngineEndpoint(EngineKind) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status != StatusHealthy {
		return "", fmt.Errorf("engine llama is %s", m.status)
	}
	return m.endpoint, nil
}

func (m *trackedLlamaExecutionManager) ValidateLlamaDependencySources(EngineConfig, []capabilitydriver.InvocationExactDependencySource) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.depValidations++
	return m.depErr
}

func (m *trackedLlamaExecutionManager) replaceWithSameConfigNewProcess(samePID bool, samePort bool, preSpawnVerified bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.supervisorSeq++
	m.spawnSeq = 1
	m.supervisorID = fmt.Sprintf("sup-external-%d", m.supervisorSeq)
	m.instanceID = fmt.Sprintf("%s:%d", m.supervisorID, m.spawnSeq)
	m.preSpawnVerified = preSpawnVerified
	m.status = StatusHealthy
	if !samePID {
		m.pid++
	}
	if !samePort {
		m.port++
	}
}

func (m *trackedLlamaExecutionManager) snapshotCounts() (starts, stops, depValidations int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.starts, m.stops, m.depValidations
}

func newTestLlamaChatAndEmbedServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case "/v1/embeddings":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"index":0,"embedding":[0.1,0.2]},{"index":1,"embedding":[0.3,0.4]}],"usage":{"prompt_tokens":4}}`))
		default:
			if strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = fmt.Fprintln(w, `data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`)
				_, _ = fmt.Fprintln(w)
				_, _ = fmt.Fprintln(w, "data: [DONE]")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func llamaDependencySourcesForTest() []capabilitydriver.InvocationExactDependencySource {
	return []capabilitydriver.InvocationExactDependencySource{{
		DependencyFamily:       "native-engine-package.llama",
		DependencyID:           "llama.cpp.package",
		ConsumerScope:          "llama.cpp.cuda",
		SelectedSourceRecordID: "source-llama-test",
		CanonicalRoot:          "/managed/llama-server",
		Version:                DefaultLlamaConfig().Version,
		VerifiedArtifacts:      []string{"/managed/llama-server"},
		Hashes:                 map[string]string{"sha256": strings.Repeat("a", 64)},
	}}
}

func llamaTextPlanWithDependenciesForTest(t *testing.T, name string, stream bool) *capabilitydriver.TextInvocationPlan {
	t.Helper()
	modelBytes := []byte("captured model bytes for " + name)
	digest := sha256.Sum256(modelBytes)
	digestHex := fmt.Sprintf("%x", digest[:])
	modelPath := filepath.Join(t.TempDir(), name+".gguf")
	if err := os.WriteFile(modelPath, modelBytes, 0o600); err != nil {
		t.Fatalf("write captured model: %v", err)
	}
	plan, err := (capabilitydriver.LlamaTextDriver{}).PlanTextInvocation(capabilitydriver.TextInvocationInput{
		ModelContextWindowTokens: 32768,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			EmbeddingInputProtocol: capabilitydriver.EmbeddingInputNativeV1,
			RequirementID:          capabilitydriver.MainGGUFRequirementID,
			ModelAssetID:           "asset-" + name,
			AbsolutePath:           modelPath,
			VerifiedContentID:      "sha256:" + digestHex,
			EntrySHA256:            digestHex,
		}},
		ExactDependencySources: llamaDependencySourcesForTest(),
		BehaviorMatch: capabilitydriver.TextBehaviorAdapterMatchFacts{
			RecipeID:          capabilitydriver.LlamaGenericGGUFRecipeID,
			RecipeRevision:    "test-revision",
			DriverDialect:     capabilitydriver.LlamaDriverDialect,
			ModelAssetID:      "asset-" + name,
			VerifiedContentID: "sha256:" + digestHex,
			EntrySHA256:       digestHex,
		},
		Request: &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}},
		Stream:  stream,
	})
	if err != nil {
		t.Fatalf("PlanTextInvocation: %v", err)
	}
	return plan
}

func llamaEmbedPlanWithDependenciesForTest(t *testing.T, name string) *capabilitydriver.EmbedInvocationPlan {
	t.Helper()
	modelBytes := []byte("captured embedding model bytes for " + name)
	digest := sha256.Sum256(modelBytes)
	digestHex := fmt.Sprintf("%x", digest[:])
	modelPath := filepath.Join(t.TempDir(), name+".gguf")
	if err := os.WriteFile(modelPath, modelBytes, 0o600); err != nil {
		t.Fatalf("write captured embedding model: %v", err)
	}
	plan, err := (capabilitydriver.LlamaEmbedDriver{}).PlanEmbedInvocation(capabilitydriver.EmbedInvocationInput{
		RecipeID:                 capabilitydriver.LlamaEmbedGGUFRecipeID,
		ModelContextWindowTokens: 8192,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			EmbeddingInputProtocol: capabilitydriver.EmbeddingInputNativeV1,
			RequirementID:          capabilitydriver.EmbeddingGGUFRequirementID,
			ModelAssetID:           "asset-embed-" + name,
			AbsolutePath:           modelPath,
			VerifiedContentID:      "sha256:" + digestHex,
			EntrySHA256:            digestHex,
		}},
		ExactDependencySources: llamaDependencySourcesForTest(),
		Request:                &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"first", "second"}},
	})
	if err != nil {
		t.Fatalf("PlanEmbedInvocation: %v", err)
	}
	return plan
}

func newTrackedExecutionHostForTest(
	t *testing.T,
	server *httptest.Server,
	warmEligibleFn func([]capabilitydriver.InvocationExactBinding) bool,
) (*ExecutionHost, *trackedLlamaExecutionManager, *managerLlamaInvocationSubstrate, *atomic.Int32) {
	t.Helper()
	mgr := newTrackedLlamaExecutionManager(server.URL)
	substrate := newManagerLlamaInvocationSubstrate(nil)
	substrate.manager = mgr
	substrate.warmSkipPathEligible = warmEligibleFn
	var modelChecks atomic.Int32
	host := newExecutionHostWithSubstrate(substrate, server.Client())
	host.idle.after = time.Hour
	host.modelContentValidator = func(ctx context.Context, files []capabilitydriver.InvocationExactBinding) error {
		modelChecks.Add(1)
		return validateInvocationModelContentContext(ctx, files)
	}
	return host, mgr, substrate, &modelChecks
}

func assertContentMismatchWithRepairGuidance(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected FailureContentMismatch error, got nil")
	}
	if kind := localexecution.FailureKindOf(err); kind != localexecution.FailureContentMismatch {
		t.Fatalf("failure kind = %q, want %q (err=%v)", kind, localexecution.FailureContentMismatch, err)
	}
	lower := strings.ToLower(err.Error())
	if !strings.Contains(lower, "re-import") || !strings.Contains(lower, "repair") {
		t.Fatalf("content mismatch error missing re-import/repair guidance: %q", err.Error())
	}
}

func TestLlamaLoadVerificationModelSwitchReverifiesAndRejectsCorruption(t *testing.T) {
	server := newTestLlamaChatAndEmbedServer(t)
	host, mgr, _, modelChecks := newTrackedExecutionHostForTest(t, server, func([]capabilitydriver.InvocationExactBinding) bool {
		return true
	})

	planA := llamaTextPlanWithDependenciesForTest(t, "model-a", false)
	planB := llamaTextPlanWithDependenciesForTest(t, "model-b", false)

	// Cold load A -> verifies.
	if _, err := host.ExecuteText(context.Background(), planA, nil); err != nil {
		t.Fatalf("cold A: %v", err)
	}
	// Warm hit A -> skips re-hash, dependency check still runs.
	if _, err := host.ExecuteText(context.Background(), planA, nil); err != nil {
		t.Fatalf("warm A: %v", err)
	}
	if got := modelChecks.Load(); got != 1 {
		t.Fatalf("after warm A modelChecks = %d, want 1", got)
	}
	if starts, _, deps := mgr.snapshotCounts(); starts != 1 || deps != 2 {
		t.Fatalf("after warm A starts=%d deps=%d, want 1, 2", starts, deps)
	}

	// Switch to B -> stops A and verifies B.
	if _, err := host.ExecuteText(context.Background(), planB, nil); err != nil {
		t.Fatalf("switch to B: %v", err)
	}
	if got := modelChecks.Load(); got != 2 {
		t.Fatalf("after switch to B modelChecks = %d, want 2", got)
	}
	// Warm hit B -> skips re-hash.
	if _, err := host.ExecuteText(context.Background(), planB, nil); err != nil {
		t.Fatalf("warm B: %v", err)
	}
	if got := modelChecks.Load(); got != 2 {
		t.Fatalf("after warm B modelChecks = %d, want 2", got)
	}

	// Switch back to A -> must re-verify A.
	if _, err := host.ExecuteText(context.Background(), planA, nil); err != nil {
		t.Fatalf("switch back to A: %v", err)
	}
	if got := modelChecks.Load(); got != 3 {
		t.Fatalf("after switch back to A modelChecks = %d, want 3", got)
	}

	// Corrupt B before switching back to B -> must reject with FailureContentMismatch + repair guidance.
	if err := os.WriteFile(planB.ModelFiles()[0].AbsolutePath, []byte("tampered B bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	startsBefore, _, _ := mgr.snapshotCounts()
	_, err := host.ExecuteText(context.Background(), planB, nil)
	assertContentMismatchWithRepairGuidance(t, err)
	if startsAfter, _, _ := mgr.snapshotCounts(); startsAfter != startsBefore {
		t.Fatalf("corrupted model switch spawned process: starts %d -> %d", startsBefore, startsAfter)
	}
}

func TestLlamaLoadVerificationIdleReleaseAndReopenReverifies(t *testing.T) {
	server := newTestLlamaChatAndEmbedServer(t)
	host, mgr, _, modelChecks := newTrackedExecutionHostForTest(t, server, func([]capabilitydriver.InvocationExactBinding) bool {
		return true
	})
	host.idle.after = 50 * time.Millisecond

	plan := llamaTextPlanWithDependenciesForTest(t, "idle-reopen", false)
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("cold load: %v", err)
	}
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("warm hit: %v", err)
	}
	if got := modelChecks.Load(); got != 1 {
		t.Fatalf("before idle release modelChecks = %d, want 1", got)
	}

	if !waitForCondition(2*time.Second, func() bool {
		_, stops, _ := mgr.snapshotCounts()
		return stops >= 1
	}) {
		t.Fatal("idle worker was not released")
	}

	// Reopen after idle release must re-verify full model content.
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("reopen after idle: %v", err)
	}
	if got := modelChecks.Load(); got != 2 {
		t.Fatalf("after idle reopen modelChecks = %d, want 2", got)
	}
	if starts, _, _ := mgr.snapshotCounts(); starts != 2 {
		t.Fatalf("after idle reopen starts = %d, want 2", starts)
	}

	// Wait for second idle release, corrupt file, and confirm reopen fails closed.
	if !waitForCondition(2*time.Second, func() bool {
		_, stops, _ := mgr.snapshotCounts()
		return stops >= 2
	}) {
		t.Fatal("second idle release did not run")
	}
	if err := os.WriteFile(plan.ModelFiles()[0].AbsolutePath, []byte("corrupted during idle"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := host.ExecuteText(context.Background(), plan, nil)
	assertContentMismatchWithRepairGuidance(t, err)
	if starts, _, _ := mgr.snapshotCounts(); starts != 2 {
		t.Fatalf("corrupted reopen spawned replacement process: starts = %d, want 2", starts)
	}
}

func TestLlamaLoadVerificationSameConfigNewProcessReverifiesEvenWithSamePortAndPID(t *testing.T) {
	server := newTestLlamaChatAndEmbedServer(t)
	host, mgr, _, modelChecks := newTrackedExecutionHostForTest(t, server, func([]capabilitydriver.InvocationExactBinding) bool {
		return true
	})

	plan := llamaTextPlanWithDependenciesForTest(t, "same-config-new-proc", false)
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("cold load: %v", err)
	}
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("warm hit: %v", err)
	}
	if got := modelChecks.Load(); got != 1 {
		t.Fatalf("after warm hit modelChecks = %d, want 1", got)
	}

	// Replace with a brand-new process instance keeping identical processKey,
	// port, PID, and healthy endpoint. Must NOT warm-skip.
	mgr.replaceWithSameConfigNewProcess(true, true, false)
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("same-config new process reload: %v", err)
	}
	if got := modelChecks.Load(); got != 2 {
		t.Fatalf("after same-config new process modelChecks = %d, want 2", got)
	}
	if starts, stops, _ := mgr.snapshotCounts(); starts != 2 || stops != 1 {
		t.Fatalf("after same-config new process starts=%d stops=%d, want 2, 1", starts, stops)
	}

	// Now corrupt the file on disk and replace with another same-config process
	// keeping the exact same PID and port -> must reject with FailureContentMismatch.
	if err := os.WriteFile(plan.ModelFiles()[0].AbsolutePath, []byte("corrupted across process swap"), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr.replaceWithSameConfigNewProcess(true, true, false)
	_, err := host.ExecuteText(context.Background(), plan, nil)
	assertContentMismatchWithRepairGuidance(t, err)
	if starts, _, _ := mgr.snapshotCounts(); starts != 2 {
		t.Fatalf("corrupted same-config replacement spawned process: starts=%d, want 2", starts)
	}
}

func TestLlamaLoadVerificationManagedMutationInvalidatesWhilePreservingCapturedJob(t *testing.T) {
	var blockNext atomic.Bool
	requestEntered := make(chan struct{})
	releaseRequest := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if blockNext.CompareAndSwap(true, false) {
			close(requestEntered)
			<-releaseRequest
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer server.Close()

	host, mgr, _, modelChecks := newTrackedExecutionHostForTest(t, server, func([]capabilitydriver.InvocationExactBinding) bool {
		return true
	})
	plan := llamaTextPlanWithDependenciesForTest(t, "managed-mutation", false)

	// Cold load + warm hit.
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("cold load: %v", err)
	}
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("warm hit: %v", err)
	}
	if got := modelChecks.Load(); got != 1 {
		t.Fatalf("after warm hit modelChecks = %d, want 1", got)
	}

	// Explicit managed-mutation invalidation clears warm token without killing
	// the running process, forcing the next execution to re-verify.
	host.InvalidateModelAssetVerification()
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("after explicit invalidation: %v", err)
	}
	if got := modelChecks.Load(); got != 2 {
		t.Fatalf("after explicit invalidation modelChecks = %d, want 2", got)
	}

	// Busy RetireModelAsset during a real in-flight captured Job: invalidates
	// warm verification immediately without disrupting the running Job.
	assetID := plan.ModelFiles()[0].ModelAssetID
	blockNext.Store(true)
	inFlightDone := make(chan error, 1)
	go func() {
		res, err := host.ExecuteText(context.Background(), plan, nil)
		if err == nil && res.Text != "ok" {
			err = fmt.Errorf("unexpected in-flight result: %+v", res)
		}
		inFlightDone <- err
	}()
	select {
	case <-requestEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("in-flight captured job did not reach inference server")
	}
	retiredBusy, err := host.RetireModelAsset(assetID)
	if retiredBusy || err != nil {
		t.Fatalf("busy RetireModelAsset = (%v, %v), want (false, nil)", retiredBusy, err)
	}
	close(releaseRequest)
	select {
	case err := <-inFlightDone:
		if err != nil {
			t.Fatalf("in-flight captured job failed during busy retirement: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("in-flight captured job did not finish")
	}
	// Even before retirement stops the worker, a subsequent already-captured Job
	// must NOT skip re-verification.
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("captured job after busy retire invalidation: %v", err)
	}
	if got := modelChecks.Load(); got != 3 {
		t.Fatalf("after busy retire modelChecks = %d, want 3", got)
	}
	// Now idle: RetireModelAsset stops worker cleanly.
	retiredIdle, err := host.RetireModelAsset(assetID)
	if !retiredIdle || err != nil {
		t.Fatalf("idle RetireModelAsset = (%v, %v), want (true, nil)", retiredIdle, err)
	}
	if _, stops, _ := mgr.snapshotCounts(); stops != 1 {
		t.Fatalf("idle RetireModelAsset stops = %d, want 1", stops)
	}
	// Subsequent execution after retirement reloads and re-verifies.
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("reload after retire: %v", err)
	}
	if got := modelChecks.Load(); got != 4 {
		t.Fatalf("after retire reload modelChecks = %d, want 4", got)
	}
	// Verify corruption after InvalidateModelAssetVerification fails closed.
	host.InvalidateModelAssetVerification()
	if err := os.WriteFile(plan.ModelFiles()[0].AbsolutePath, []byte("mutated on disk"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = host.ExecuteText(context.Background(), plan, nil)
	assertContentMismatchWithRepairGuidance(t, err)
}

func TestLlamaLoadVerificationRetainsFullCheckForEmbedNonEligibleAndDynamicArgs(t *testing.T) {
	server := newTestLlamaChatAndEmbedServer(t)

	t.Run("text.embed always re-verifies even when path is eligible", func(t *testing.T) {
		host, mgr, _, modelChecks := newTrackedExecutionHostForTest(t, server, func([]capabilitydriver.InvocationExactBinding) bool {
			return true
		})
		embedPlan := llamaEmbedPlanWithDependenciesForTest(t, "embed-always-verify")
		for turn := 1; turn <= 3; turn++ {
			if _, err := host.ExecuteEmbed(context.Background(), embedPlan, nil); err != nil {
				t.Fatalf("embed turn %d: %v", turn, err)
			}
		}
		if got := modelChecks.Load(); got != 3 {
			t.Fatalf("embed modelChecks = %d, want 3 (never skip text.embed)", got)
		}
		if starts, _, deps := mgr.snapshotCounts(); starts != 1 || deps != 3 {
			t.Fatalf("embed starts=%d deps=%d, want 1, 3", starts, deps)
		}
		// Corrupting file before next embed turn must reject with FailureContentMismatch + repair guidance.
		if err := os.WriteFile(embedPlan.ModelFiles()[0].AbsolutePath, []byte("corrupted embed"), 0o600); err != nil {
			t.Fatal(err)
		}
		_, err := host.ExecuteEmbed(context.Background(), embedPlan, nil)
		assertContentMismatchWithRepairGuidance(t, err)
	})

	t.Run("non-eligible path or platform retains full re-verification", func(t *testing.T) {
		host, mgr, _, modelChecks := newTrackedExecutionHostForTest(t, server, func([]capabilitydriver.InvocationExactBinding) bool {
			return false
		})
		plan := llamaTextPlanWithDependenciesForTest(t, "non-eligible-path", false)
		for turn := 1; turn <= 3; turn++ {
			if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
				t.Fatalf("text turn %d: %v", turn, err)
			}
		}
		if got := modelChecks.Load(); got != 3 {
			t.Fatalf("non-eligible path modelChecks = %d, want 3", got)
		}
		if starts, _, deps := mgr.snapshotCounts(); starts != 1 || deps != 3 {
			t.Fatalf("non-eligible path starts=%d deps=%d, want 1, 3", starts, deps)
		}
	})

	t.Run("dynamic weight-reopening args disable warm skip", func(t *testing.T) {
		for _, args := range [][]string{
			{"--model", "a.gguf", "--lora", "adapter.gguf"},
			{"--model", "a.gguf", "--models-dir", "/models"},
			{"--model", "a.gguf", "--models-preset=/preset.ini"},
			{"--model", "a.gguf", "--embedding"},
			{"--model", "a.gguf", "--control-vector", "cv.gguf"},
		} {
			if llamaTextProcessArgsAllowWarmSkip(args) {
				t.Fatalf("expected llamaTextProcessArgsAllowWarmSkip(%v) == false", args)
			}
		}
		standard := []string{"--reasoning", "off", "--no-prefill-assistant", "--model", `C:\models\a.gguf`, "--alias", "nimi-selected-local", "--ctx-size", "32768"}
		if !llamaTextProcessArgsAllowWarmSkip(standard) {
			t.Fatalf("expected standard llama args to allow warm skip")
		}
	})
}

func TestLlamaLoadVerificationDependencyValidationStillRunsAndFailsClosedOnWarmHit(t *testing.T) {
	server := newTestLlamaChatAndEmbedServer(t)
	host, mgr, _, modelChecks := newTrackedExecutionHostForTest(t, server, func([]capabilitydriver.InvocationExactBinding) bool {
		return true
	})
	plan := llamaTextPlanWithDependenciesForTest(t, "dep-check-warm", false)

	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("cold load: %v", err)
	}
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatalf("warm hit 1: %v", err)
	}
	if got := modelChecks.Load(); got != 1 {
		t.Fatalf("modelChecks = %d, want 1", got)
	}
	if _, _, deps := mgr.snapshotCounts(); deps != 2 {
		t.Fatalf("deps = %d, want 2", deps)
	}

	// Drift dependency source before warm hit 2 -> must reject even when model
	// content hash would have been skipped!
	mgr.mu.Lock()
	mgr.depErr = errors.New("captured llama package source drifted")
	mgr.mu.Unlock()
	_, err := host.ExecuteText(context.Background(), plan, nil)
	if err == nil || !strings.Contains(err.Error(), "drifted") {
		t.Fatalf("expected dependency drift failure on warm hit, got %v", err)
	}
	if got := modelChecks.Load(); got != 1 {
		t.Fatalf("modelChecks after dep drift = %d, want 1", got)
	}
	if _, _, deps := mgr.snapshotCounts(); deps != 3 {
		t.Fatalf("deps after drift = %d, want 3", deps)
	}
}

func TestLlamaLoadVerificationConcurrencySafety(t *testing.T) {
	server := newTestLlamaChatAndEmbedServer(t)
	host, mgr, _, _ := newTrackedExecutionHostForTest(t, server, func([]capabilitydriver.InvocationExactBinding) bool {
		return true
	})
	planA := llamaTextPlanWithDependenciesForTest(t, "conc-a", false)
	planB := llamaTextPlanWithDependenciesForTest(t, "conc-b", true)

	var wg sync.WaitGroup
	errCh := make(chan error, 64)
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < 6; i++ {
				if (id+i)%2 == 0 {
					if _, err := host.ExecuteText(context.Background(), planA, nil); err != nil {
						errCh <- err
						return
					}
				} else {
					if _, err := host.StreamText(context.Background(), planB, func(localexecution.TextDelta) error { return nil }, nil); err != nil {
						errCh <- err
						return
					}
				}
			}
		}(worker)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 8; i++ {
			host.InvalidateModelAssetVerification()
			if i%3 == 0 {
				mgr.replaceWithSameConfigNewProcess(true, true, false)
			}
			_, _ = host.RetireModelAsset(planA.ModelFiles()[0].ModelAssetID)
			time.Sleep(2 * time.Millisecond)
		}
	}()
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("concurrent execution failed: %v", err)
	}
}

// TestLlamaLoadVerificationHelperProcess is a subprocess entrypoint used by
// TestLlamaLoadVerificationSupervisorCrashAutoRestart to exercise real
// Supervisor spawn, crash detection, PreRestartValidate, and ProcessInstanceID
// advancement without external binaries.
func TestLlamaLoadVerificationHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_LLAMA_LOAD_HELPER_PROCESS") != "1" {
		return
	}
	sep := -1
	for i, arg := range os.Args {
		if arg == "--" {
			sep = i
			break
		}
	}
	if sep < 0 || sep+3 >= len(os.Args) {
		os.Exit(2)
	}
	port := os.Args[sep+1]
	crashTrigger := os.Args[sep+2]
	spawnCounterPath := os.Args[sep+3]

	// Append one line per actual OS process spawn so the parent test can verify
	// exact spawn counts (including proving a failed PreRestartValidate NEVER
	// spawns a replacement process!).
	if f, err := os.OpenFile(spawnCounterPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600); err == nil {
		_, _ = fmt.Fprintf(f, "%d\n", os.Getpid())
		_ = f.Close()
	}

	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		os.Exit(3)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	})
	srv := &http.Server{Handler: mux}
	go func() {
		_ = srv.Serve(listener)
	}()

	// Crash once if trigger file appears (consume the trigger file so a cleanly
	// restarted replacement stays alive until stopped).
	ticker := time.NewTicker(15 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.After(30 * time.Second)
	for {
		select {
		case <-deadline:
			_ = srv.Close()
			os.Exit(0)
		case <-ticker.C:
			if _, err := os.Stat(crashTrigger); err == nil {
				_ = os.Remove(crashTrigger)
				_ = srv.Close()
				os.Exit(1)
			}
		}
	}
}

type realSupervisorLlamaManager struct {
	mu          sync.Mutex
	supervisor  *Supervisor
	baseCfg     EngineConfig
	depChecks   int
}

func (m *realSupervisorLlamaManager) EngineStatus(EngineKind) (SupervisorInfo, error) {
	m.mu.Lock()
	sup := m.supervisor
	m.mu.Unlock()
	if sup == nil {
		return SupervisorInfo{}, fmt.Errorf("engine llama not started")
	}
	return sup.Info(), nil
}

func (m *realSupervisorLlamaManager) StopEngine(EngineKind) error {
	m.mu.Lock()
	sup := m.supervisor
	m.supervisor = nil
	m.mu.Unlock()
	if sup == nil {
		return ErrEngineNotRunning
	}
	return sup.Stop()
}

func (m *realSupervisorLlamaManager) StartEngine(ctx context.Context, cfg EngineConfig) error {
	merged := m.baseCfg
	merged.PreSpawnValidated = cfg.PreSpawnValidated
	merged.PreRestartValidate = cfg.PreRestartValidate
	merged.CommandEnv = make(map[string]string, len(m.baseCfg.CommandEnv)+len(cfg.CommandEnv))
	for k, v := range m.baseCfg.CommandEnv {
		merged.CommandEnv[k] = v
	}
	for k, v := range cfg.CommandEnv {
		merged.CommandEnv[k] = v
	}
	sup := NewSupervisor(merged, testLogger(), nil)
	if err := sup.Start(ctx); err != nil {
		return err
	}
	m.mu.Lock()
	m.supervisor = sup
	m.mu.Unlock()
	return nil
}

func (m *realSupervisorLlamaManager) EngineEndpoint(EngineKind) (string, error) {
	m.mu.Lock()
	sup := m.supervisor
	m.mu.Unlock()
	if sup == nil {
		return "", fmt.Errorf("engine llama not started")
	}
	info := sup.Info()
	if info.Status != StatusHealthy {
		return "", fmt.Errorf("engine llama is %s", info.Status)
	}
	return info.Endpoint, nil
}

func (m *realSupervisorLlamaManager) ValidateLlamaDependencySources(EngineConfig, []capabilitydriver.InvocationExactDependencySource) error {
	m.mu.Lock()
	m.depChecks++
	m.mu.Unlock()
	return nil
}

func countSpawnLines(path string) int {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	count := 0
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}

func TestLlamaLoadVerificationSupervisorCrashAutoRestart(t *testing.T) {
	setSupervisorTestHome(t)
	executablePath, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}

	newHelperManager := func(t *testing.T) (*realSupervisorLlamaManager, string, string) {
		t.Helper()
		dir := t.TempDir()
		port := mustAllocateTestPort()
		crashTrigger := filepath.Join(dir, "crash.trigger")
		spawnLog := filepath.Join(dir, "spawns.log")
		cfg := EngineConfig{
			Kind:             EngineKind("test-llama-helper"), // generic binary launch + standard HTTP /health probe
			BinaryPath:       executablePath,
			CommandArgs:      []string{"-test.run=^TestLlamaLoadVerificationHelperProcess$", "--", strconv.Itoa(port), crashTrigger, spawnLog},
			CommandEnv:       map[string]string{"GO_WANT_LLAMA_LOAD_HELPER_PROCESS": "1"},
			Port:             port,
			Version:          "test",
			SupervisedRoot:   testSupervisedRoot(),
			HealthMode:       HealthModeHTTP,
			HealthPath:       "/health",
			StartupTimeout:   5 * time.Second,
			HealthInterval:   50 * time.Millisecond,
			MaxRestarts:      3,
			RestartBaseDelay: 30 * time.Millisecond,
			ShutdownTimeout:  time.Second,
		}
		mgr := &realSupervisorLlamaManager{baseCfg: cfg}
		t.Cleanup(func() { _ = mgr.StopEngine(EngineLlama) })
		return mgr, crashTrigger, spawnLog
	}

	t.Run("intact files re-verify before restart spawn and advance instance identity", func(t *testing.T) {
		mgr, crashTrigger, spawnLog := newHelperManager(t)
		substrate := newManagerLlamaInvocationSubstrate(nil)
		substrate.manager = mgr
		substrate.warmSkipPathEligible = func([]capabilitydriver.InvocationExactBinding) bool { return true }
		var modelChecks atomic.Int32
		host := newExecutionHostWithSubstrate(substrate, &http.Client{Timeout: 3 * time.Second})
		host.idle.after = time.Hour
		host.modelContentValidator = func(ctx context.Context, files []capabilitydriver.InvocationExactBinding) error {
			modelChecks.Add(1)
			return validateInvocationModelContentContext(ctx, files)
		}

		plan := llamaTextPlanWithDependenciesForTest(t, "crash-intact", false)
		// Cold load -> 1 verification, 1 spawn.
		if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
			t.Fatalf("cold load: %v", err)
		}
		info1, err := mgr.EngineStatus(EngineLlama)
		if err != nil || info1.ProcessInstanceID == "" || !info1.PreSpawnVerified {
			t.Fatalf("initial status = %+v, err=%v", info1, err)
		}
		// Warm hit on instance #1 -> 0 additional model verifications!
		if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
			t.Fatalf("warm hit 1: %v", err)
		}
		if got := modelChecks.Load(); got != 1 {
			t.Fatalf("warm hit 1 modelChecks = %d, want 1", got)
		}

		// Trigger real crash of subprocess #1.
		if err := os.WriteFile(crashTrigger, []byte("crash"), 0o600); err != nil {
			t.Fatal(err)
		}
		// Wait for Supervisor crash auto-restart to run PreRestartValidate and spawn instance #2.
		if !waitForCondition(8*time.Second, func() bool {
			info, err := mgr.EngineStatus(EngineLlama)
			return err == nil && info.Status == StatusHealthy && info.ProcessInstanceID != "" && info.ProcessInstanceID != info1.ProcessInstanceID
		}) {
			info, _ := mgr.EngineStatus(EngineLlama)
			t.Fatalf("supervisor did not restart with new ProcessInstanceID; info=%+v spawns=%d", info, countSpawnLines(spawnLog))
		}
		info2, _ := mgr.EngineStatus(EngineLlama)
		if info2.SupervisorInstanceID != info1.SupervisorInstanceID || !info2.PreSpawnVerified {
			t.Fatalf("restarted supervisor info = %+v, initial = %+v", info2, info1)
		}
		if countSpawnLines(spawnLog) != 2 {
			t.Fatalf("spawn count = %d, want 2", countSpawnLines(spawnLog))
		}
		// PreRestartValidate must have run BEFORE spawning instance #2 (count == 2).
		if got := modelChecks.Load(); got < 2 {
			t.Fatalf("modelChecks after crash auto-restart = %d, want >= 2", got)
		}
		checksBeforePostCrashTurn := modelChecks.Load()

		// First turn after crash auto-restart sees changed ProcessInstanceID, so
		// it re-verifies rather than blindly using instance #1's verified token.
		if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
			t.Fatalf("post-crash turn 1: %v", err)
		}
		if got := modelChecks.Load(); got != checksBeforePostCrashTurn+1 {
			t.Fatalf("post-crash turn 1 modelChecks = %d, want %d", got, checksBeforePostCrashTurn+1)
		}
		// Subsequent warm turn on the newly verified instance #2 skips re-hash!
		if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
			t.Fatalf("post-crash warm turn 2: %v", err)
		}
		if got := modelChecks.Load(); got != checksBeforePostCrashTurn+1 {
			t.Fatalf("post-crash warm turn 2 modelChecks = %d, want %d", got, checksBeforePostCrashTurn+1)
		}
	})

	t.Run("corrupted file fails closed BEFORE crash auto-restart spawns replacement", func(t *testing.T) {
		mgr, crashTrigger, spawnLog := newHelperManager(t)
		substrate := newManagerLlamaInvocationSubstrate(nil)
		substrate.manager = mgr
		substrate.warmSkipPathEligible = func([]capabilitydriver.InvocationExactBinding) bool { return true }
		host := newExecutionHostWithSubstrate(substrate, &http.Client{Timeout: 3 * time.Second})
		host.idle.after = time.Hour

		plan := llamaTextPlanWithDependenciesForTest(t, "crash-corrupt", false)
		if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
			t.Fatalf("cold load: %v", err)
		}
		if countSpawnLines(spawnLog) != 1 {
			t.Fatalf("initial spawn count = %d, want 1", countSpawnLines(spawnLog))
		}

		// Corrupt the captured model file on disk before crash.
		if err := os.WriteFile(plan.ModelFiles()[0].AbsolutePath, []byte("corrupted model bytes"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(crashTrigger, []byte("crash"), 0o600); err != nil {
			t.Fatal(err)
		}

		// Supervisor must detect FailureContentMismatch in PreRestartValidate,
		// mark StatusUnhealthy with repair guidance, and NEVER spawn a 2nd process!
		if !waitForCondition(6*time.Second, func() bool {
			info, err := mgr.EngineStatus(EngineLlama)
			return err == nil && info.Status == StatusUnhealthy && strings.Contains(strings.ToLower(info.Detail), "re-import")
		}) {
			info, _ := mgr.EngineStatus(EngineLlama)
			t.Fatalf("expected unhealthy status with content mismatch guidance, got %+v", info)
		}
		time.Sleep(150 * time.Millisecond)
		if spawns := countSpawnLines(spawnLog); spawns != 1 {
			t.Fatalf("corrupted file allowed replacement process spawn: spawns=%d, want 1", spawns)
		}
		if info, _ := mgr.EngineStatus(EngineLlama); info.ProcessInstanceID != "" {
			t.Fatalf("unhealthy supervisor retained ProcessInstanceID %q", info.ProcessInstanceID)
		}

		// Next user turn must reject with FailureContentMismatch + re-import/repair guidance.
		_, err := host.ExecuteText(context.Background(), plan, nil)
		assertContentMismatchWithRepairGuidance(t, err)
		if spawns := countSpawnLines(spawnLog); spawns != 1 {
			t.Fatalf("post-crash failed turn spawned process: spawns=%d, want 1", spawns)
		}
	})

	t.Run("restart without PreRestartValidate advances instance identity and forces re-verify reload", func(t *testing.T) {
		mgr, crashTrigger, spawnLog := newHelperManager(t)
		substrate := newManagerLlamaInvocationSubstrate(nil)
		substrate.manager = mgr
		substrate.warmSkipPathEligible = func([]capabilitydriver.InvocationExactBinding) bool { return true }
		var modelChecks atomic.Int32
		host := newExecutionHostWithSubstrate(substrate, &http.Client{Timeout: 3 * time.Second})
		host.idle.after = time.Hour
		host.modelContentValidator = func(ctx context.Context, files []capabilitydriver.InvocationExactBinding) error {
			modelChecks.Add(1)
			return validateInvocationModelContentContext(ctx, files)
		}

		plan := llamaTextPlanWithDependenciesForTest(t, "crash-no-hook", false)
		if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
			t.Fatalf("cold load: %v", err)
		}
		info1, _ := mgr.EngineStatus(EngineLlama)
		// Simulate an unmanaged/unhooked supervisor crash auto-restart by clearing
		// PreRestartValidate on the running supervisor before crashing it.
		mgr.mu.Lock()
		mgr.supervisor.cfg.PreRestartValidate = nil
		mgr.mu.Unlock()

		if err := os.WriteFile(crashTrigger, []byte("crash"), 0o600); err != nil {
			t.Fatal(err)
		}
		if !waitForCondition(8*time.Second, func() bool {
			info, err := mgr.EngineStatus(EngineLlama)
			return err == nil && info.Status == StatusHealthy && info.ProcessInstanceID != "" && info.ProcessInstanceID != info1.ProcessInstanceID
		}) {
			info, _ := mgr.EngineStatus(EngineLlama)
			t.Fatalf("unhooked supervisor did not restart; info=%+v spawns=%d", info, countSpawnLines(spawnLog))
		}
		info2, _ := mgr.EngineStatus(EngineLlama)
		if info2.PreSpawnVerified {
			t.Fatalf("restart without PreRestartValidate erroneously reported PreSpawnVerified=true: %+v", info2)
		}

		// Corrupt the file before the next ExecutionHost turn -> because the
		// unhooked restart invalidated the instance token (and PreSpawnVerified=false),
		// ExecutionHost must stop the unverified worker, re-verify, and reject!
		if err := os.WriteFile(plan.ModelFiles()[0].AbsolutePath, []byte("tampered after unhooked restart"), 0o600); err != nil {
			t.Fatal(err)
		}
		_, err := host.ExecuteText(context.Background(), plan, nil)
		assertContentMismatchWithRepairGuidance(t, err)
		if got := modelChecks.Load(); got != 2 {
			t.Fatalf("modelChecks after unhooked restart = %d, want 2", got)
		}
	})
}
