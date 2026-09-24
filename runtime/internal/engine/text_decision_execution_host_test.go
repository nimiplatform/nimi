package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type fakeTextDecisionWorker struct {
	mu       sync.Mutex
	endpoint string
	identity string
	starts   int
	stops    int
}

func (worker *fakeTextDecisionWorker) running(identity string) (string, string, bool) {
	worker.mu.Lock()
	defer worker.mu.Unlock()
	return worker.endpoint, "fake-token", worker.identity != "" && worker.identity == identity
}

func (worker *fakeTextDecisionWorker) start(_ context.Context, identity string, _ string) (string, string, error) {
	worker.mu.Lock()
	defer worker.mu.Unlock()
	worker.starts++
	worker.identity = identity
	return worker.endpoint, "fake-token", nil
}

func (worker *fakeTextDecisionWorker) stop() error {
	worker.mu.Lock()
	defer worker.mu.Unlock()
	worker.stops++
	worker.identity = ""
	return nil
}

func (worker *fakeTextDecisionWorker) counts() (int, int) {
	worker.mu.Lock()
	defer worker.mu.Unlock()
	return worker.starts, worker.stops
}

func textDecisionTestProfile(t *testing.T, plane string) (string, PythonDependencyProfileIdentity) {
	t.Helper()
	platform := runtime.GOOS + "/" + runtime.GOARCH
	identity, err := ResolvePythonDependencyProfileIdentity(TextDecisionConsumerID, platform, plane)
	if err != nil {
		t.Skipf("Laya decision profile is not admitted on %s: %v", platform, err)
	}
	root := filepath.Join(t.TempDir(), identity.ProfileDigest)
	files, err := PythonDependencyProfileStaticFiles(TextDecisionConsumerID, identity)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		path := filepath.Join(root, file.RelativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, file.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writePythonDependencyProfileManifest(root, TextDecisionConsumerID, identity); err != nil {
		t.Fatal(err)
	}
	return root, identity
}

func textDecisionTestBinding(t *testing.T) capabilitydriver.InvocationExactBinding {
	t.Helper()
	bundle := filepath.Join(t.TempDir(), "asset")
	declared := []string{
		"ckpt/encoder/config.json", "ckpt/model.safetensors", "ckpt/rl_agent_config.json",
		"ckpt/tokenizer/tokenizer.json", "ckpt/tokenizer/tokenizer_config.json",
	}
	hasher := sha256.New()
	entrySHA := ""
	for _, relative := range declared {
		path := filepath.Join(bundle, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		content := []byte("content of " + relative)
		if err := os.WriteFile(path, content, 0o644); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(content)
		hasher.Write(sum[:])
		if strings.HasSuffix(relative, "model.safetensors") {
			entrySHA = hex.EncodeToString(sum[:])
		}
	}
	return capabilitydriver.InvocationExactBinding{
		RequirementID: capabilitydriver.LayaModelSlot, ModelAssetID: "asset-laya", BundleDir: bundle,
		AbsolutePath: filepath.Join(bundle, "ckpt", "model.safetensors"), DeclaredFiles: declared,
		VerifiedContentID: "sha256:" + hex.EncodeToString(hasher.Sum(nil)), EntrySHA256: entrySHA,
	}
}

func textDecisionTestSpec() *runtimev1.TextDecideScenarioSpec {
	return &runtimev1.TextDecideScenarioSpec{
		State: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Json{Json: `{"request":"latest <b>news</b> & more"}`}},
		Questions: []*runtimev1.TextDecisionQuestion{
			{Id: "window", Instructions: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "Which window?"}},
				Kind: &runtimev1.TextDecisionQuestion_Choice{Choice: &runtimev1.TextDecisionChoice{Candidates: []*runtimev1.TextDecisionCandidate{
					{Id: "day", Description: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "past day"}}}, {Id: "week"},
				}}}},
			{Id: "news", Instructions: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "News?"}},
				Kind: &runtimev1.TextDecisionQuestion_Boolean{Boolean: &runtimev1.TextDecisionBoolean{}}},
		},
	}
}

func newTextDecisionTestHost(t *testing.T, handler http.HandlerFunc) (*TextDecisionExecutionHost, *fakeTextDecisionWorker, *capabilitydriver.TextDecisionInvocationPlan) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	root, identity := textDecisionTestProfile(t, "cpu")
	binding := textDecisionTestBinding(t)
	worker := &fakeTextDecisionWorker{endpoint: server.URL}
	host := &TextDecisionExecutionHost{worker: worker, client: server.Client()}
	plan := &capabilitydriver.TextDecisionInvocationPlan{
		Request: textDecisionTestSpec(), Binding: binding, ModelDir: filepath.Dir(binding.AbsolutePath),
		ProfileRoot: root, ProfileDigest: identity.ProfileDigest, DriverBundleDigest: identity.DriverBundleDigest, DriverProtocol: capabilitydriver.LayaProtocol,
	}
	return host, worker, plan
}

func writeTextDecisionWorkerJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func TestTextDecisionHostFramesCapturedRequestAndMapsTypedAnswers(t *testing.T) {
	var seen textDecisionWorkerRequest
	host, worker, plan := newTextDecisionTestHost(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/text/decide" || r.Header.Get("x-nimi-decision-token") != "fake-token" || r.Header.Get("Content-Type") != "application/json; charset=utf-8" {
			t.Errorf("unexpected Worker request framing: %s %v", r.URL.Path, r.Header)
		}
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &seen); err != nil {
			t.Errorf("request is not JSON: %v", err)
		}
		writeTextDecisionWorkerJSON(w, http.StatusOK, map[string]any{
			"result": map[string]any{"answers": []any{
				map[string]any{"question_id": "window", "choice": map[string]any{"selected_candidate_id": "week", "probabilities": []float64{0.123456789012345, 0.876543210987655}}},
				map[string]any{"question_id": "news", "boolean": map[string]any{"true_probability": 0.6}},
			}},
			"usage": map[string]any{"input_tokens": 42, "compute_ms": 7},
		})
	})
	for call := 0; call < 2; call++ {
		result, err := host.ExecuteTextDecision(context.Background(), plan)
		if err != nil {
			t.Fatalf("call %d: %v", call, err)
		}
		choice := result.Result.GetAnswers()[0].GetChoice()
		if choice.GetSelectedCandidateId() != "week" || choice.GetProbabilities()[0].GetCandidateId() != "day" || choice.GetProbabilities()[0].GetProbability() != 0.123456789012345 ||
			result.Result.GetAnswers()[1].GetBoolean().GetTrueProbability() != 0.6 || result.InputTokens != 42 || result.ComputeMS != 7 {
			t.Fatalf("typed answers were not mapped exactly: %+v", result)
		}
	}
	if starts, stops := worker.counts(); starts != 1 || stops != 1 {
		t.Fatalf("same captured identity must reuse one Worker: starts=%d stops=%d", starts, stops)
	}
	if seen.ModelDir != plan.ModelDir || seen.ModelContentID != plan.Binding.VerifiedContentID || seen.ProfileDigest != plan.ProfileDigest || seen.Device != "cpu" {
		t.Fatalf("captured loading identity was not forwarded: %+v", seen)
	}
	var request map[string]any
	if err := json.Unmarshal(seen.Request, &request); err != nil {
		t.Fatal(err)
	}
	questions := request["questions"].([]any)
	state := request["state"].(map[string]any)
	if state["json"] != `{"request":"latest <b>news</b> & more"}` || len(questions) != 2 || questions[1].(map[string]any)["boolean"] == nil {
		t.Fatalf("captured request was rewritten: %s", seen.Request)
	}
}

func TestTextDecisionHostMapsTypedWorkerFailures(t *testing.T) {
	for _, test := range []struct {
		name       string
		status     int
		body       any
		reason     runtimev1.ReasonCode
		kind       localexecution.FailureKind
		keepWorker bool
	}{
		{name: "limit", status: 422, body: map[string]any{"reason_code": "AI_INPUT_LIMIT_EXCEEDED", "detail": "x", "question_index": 1, "required_positions": 9000, "max_positions": 8192},
			reason: runtimev1.ReasonCode_AI_INPUT_LIMIT_EXCEEDED, keepWorker: true},
		{name: "invalid unicode", status: 422, body: map[string]any{"reason_code": "AI_INPUT_INVALID", "detail": "x"}, reason: runtimev1.ReasonCode_AI_INPUT_INVALID, keepWorker: true},
		{name: "incomplete limit", status: 422, body: map[string]any{"reason_code": "AI_INPUT_LIMIT_EXCEEDED", "detail": "x"}, kind: localexecution.FailureInference},
		{name: "load or device", status: 500, body: map[string]any{"reason_code": "AI_LOCAL_EXECUTION_LOAD_FAILED", "detail": "no CUDA"}, kind: localexecution.FailureLoad},
		{name: "memory", status: 500, body: map[string]any{"reason_code": "AI_LOCAL_EXECUTION_OUT_OF_MEMORY", "detail": "x"}, kind: localexecution.FailureOutOfMemory},
		{name: "inference", status: 500, body: map[string]any{"reason_code": "AI_LOCAL_EXECUTION_INFERENCE_FAILED", "detail": "x"}, kind: localexecution.FailureInference},
		{name: "incomplete answers", status: 200, body: map[string]any{"result": map[string]any{"answers": []any{}}, "usage": map[string]any{"input_tokens": 1, "compute_ms": 1}}, kind: localexecution.FailureTextOutputInvalid},
		{name: "unknown selection", status: 200, body: map[string]any{"result": map[string]any{"answers": []any{
			map[string]any{"question_id": "window", "choice": map[string]any{"selected_candidate_id": "month", "probabilities": []float64{0.5, 0.5}}},
			map[string]any{"question_id": "news", "boolean": map[string]any{"true_probability": 0.6}},
		}}, "usage": map[string]any{"input_tokens": 1, "compute_ms": 1}}, kind: localexecution.FailureTextOutputInvalid},
	} {
		t.Run(test.name, func(t *testing.T) {
			host, worker, plan := newTextDecisionTestHost(t, func(w http.ResponseWriter, _ *http.Request) {
				writeTextDecisionWorkerJSON(w, test.status, test.body)
			})
			_, err := host.ExecuteTextDecision(context.Background(), plan)
			if err == nil {
				t.Fatal("typed Worker failure was published as success")
			}
			if test.reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != test.reason || status.Code(err) != codes.InvalidArgument || localexecution.FailureKindOf(err) != "" {
					t.Fatalf("reason=%v code=%v err=%v", reason, status.Code(err), err)
				}
			} else if kind := localexecution.FailureKindOf(err); kind != test.kind {
				t.Fatalf("failure kind=%q want %q (%v)", kind, test.kind, err)
			}
			_, stops := worker.counts()
			if keptStops := 1; test.keepWorker != (stops == keptStops) {
				t.Fatalf("Worker retention mismatch: stops=%d keep=%v", stops, test.keepWorker)
			}
		})
	}
}

func TestTextDecisionHostDiscardsResultsAfterCancellationAndDeadline(t *testing.T) {
	for _, deadline := range []bool{false, true} {
		entered := make(chan struct{})
		finish := make(chan struct{})
		host, worker, plan := newTextDecisionTestHost(t, func(w http.ResponseWriter, r *http.Request) {
			close(entered)
			<-finish
			// The accelerator computation finishes after the caller is gone.
			writeTextDecisionWorkerJSON(w, http.StatusOK, map[string]any{"result": map[string]any{"answers": []any{}}, "usage": map[string]any{"input_tokens": 1, "compute_ms": 1}})
		})
		ctx, cancel := context.WithCancel(context.Background())
		if deadline {
			ctx, cancel = context.WithTimeout(context.Background(), 300*time.Millisecond)
		}
		done := make(chan error, 1)
		go func() {
			_, err := host.ExecuteTextDecision(ctx, plan)
			done <- err
		}()
		var err error
		select {
		case <-entered:
			if !deadline {
				cancel()
			}
			err = <-done
		case err = <-done:
			if !deadline {
				t.Fatalf("Worker was not reached: %v", err)
			}
		}
		close(finish)
		cancel()
		want := localexecution.FailureCanceled
		if deadline {
			want = localexecution.FailureTimeout
		}
		if kind := localexecution.FailureKindOf(err); kind != want {
			t.Fatalf("deadline=%v: kind=%q err=%v", deadline, kind, err)
		}
		// The healthy Worker stays resident; only the abandoned result is discarded.
		if starts, stops := worker.counts(); starts != 1 || stops != 1 {
			t.Fatalf("abandoned call must keep the resident Worker: starts=%d stops=%d", starts, stops)
		}
	}
}

// newStalledTextDecisionTestHost serves a Worker that answers nothing until
// the caller gives up, and signals each call that reached it.
func newStalledTextDecisionTestHost(t *testing.T) (*TextDecisionExecutionHost, *fakeTextDecisionWorker, *capabilitydriver.TextDecisionInvocationPlan, <-chan struct{}) {
	t.Helper()
	release := make(chan struct{})
	entered := make(chan struct{}, 1)
	host, worker, plan := newTextDecisionTestHost(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case entered <- struct{}{}:
		default:
		}
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})
	// Registered after the server, so stalled handlers are released before it closes.
	t.Cleanup(func() { close(release) })
	return host, worker, plan, entered
}

// abandonTextDecisionCall runs one call whose caller gives up. The first call
// is stopped only once it reached the loading Worker: a deadline that elapsed
// while its checkpoint was still being sealed would leave no Worker to keep.
// Later calls reach the resident Worker and give up at their deadline.
func abandonTextDecisionCall(t *testing.T, host *TextDecisionExecutionHost, plan *capabilitydriver.TextDecisionInvocationPlan, entered <-chan struct{}, call int) {
	t.Helper()
	want := localexecution.FailureTimeout
	var ctx context.Context
	var cancel context.CancelFunc
	if call == 1 {
		want = localexecution.FailureCanceled
		ctx, cancel = context.WithCancel(context.Background())
		go func() {
			select {
			case <-entered:
			case <-ctx.Done():
			}
			cancel()
		}()
	} else {
		ctx, cancel = context.WithTimeout(context.Background(), 50*time.Millisecond)
	}
	_, err := host.ExecuteTextDecision(ctx, plan)
	cancel()
	if kind := localexecution.FailureKindOf(err); kind != want {
		t.Fatalf("call %d: kind=%q want %q err=%v", call, kind, want, err)
	}
}

func TestTextDecisionHostReplacesWorkerAfterRepeatedAbandonment(t *testing.T) {
	host, worker, plan, entered := newStalledTextDecisionTestHost(t)
	now := time.Now()
	host.now = func() time.Time { return now }
	for call := 1; call <= maxConsecutiveAbandonedTextDecisionCalls; call++ {
		// The Worker answers nothing while the calls span its stall window.
		now = now.Add(textDecisionWorkerStuckAfter / 2)
		abandonTextDecisionCall(t, host, plan, entered, call)
		_, stops := worker.counts()
		wantStops := 1
		if call == maxConsecutiveAbandonedTextDecisionCalls {
			wantStops = 2
		}
		if stops != wantStops {
			t.Fatalf("call %d: stops=%d want %d", call, stops, wantStops)
		}
	}
}

func TestTextDecisionHostKeepsLoadingWorkerAcrossQuickAbandonment(t *testing.T) {
	host, worker, plan, entered := newStalledTextDecisionTestHost(t)
	// Callers giving up repeatedly within the stall window (a slow first load)
	// never replace the Worker.
	for call := 1; call <= maxConsecutiveAbandonedTextDecisionCalls+2; call++ {
		abandonTextDecisionCall(t, host, plan, entered, call)
	}
	if starts, stops := worker.counts(); starts != 1 || stops != 1 {
		t.Fatalf("quick abandonment must keep the Worker: starts=%d stops=%d", starts, stops)
	}
}

func TestTextDecisionHostSealsCapturedCheckpointBeforeStartingWorker(t *testing.T) {
	host, worker, plan := newTextDecisionTestHost(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Error("changed content reached the Worker")
	})
	if err := os.WriteFile(filepath.Join(plan.ModelDir, "tokenizer", "tokenizer.json"), []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := host.ExecuteTextDecision(context.Background(), plan)
	if kind := localexecution.FailureKindOf(err); kind != localexecution.FailureContentMismatch {
		t.Fatalf("kind=%q err=%v", kind, err)
	}
	if starts, _ := worker.counts(); starts != 0 {
		t.Fatal("Worker started for changed checkpoint content")
	}
	changed := *plan
	changed.ProfileDigest = strings.Repeat("0", 64)
	_, err = host.ExecuteTextDecision(context.Background(), &changed)
	if kind := localexecution.FailureKindOf(err); kind != localexecution.FailureLoad {
		t.Fatalf("mismatched profile: kind=%q err=%v", kind, err)
	}
}

func TestTextDecisionHostRetiresResidentCheckpointWhenIdle(t *testing.T) {
	host, worker, plan := newTextDecisionTestHost(t, func(w http.ResponseWriter, _ *http.Request) {
		writeTextDecisionWorkerJSON(w, 422, map[string]any{"reason_code": "AI_INPUT_INVALID", "detail": "x"})
	})
	if _, err := host.ExecuteTextDecision(context.Background(), plan); err == nil {
		t.Fatal("expected input rejection")
	}
	retired, err := host.RetireModelAsset(plan.Binding.ModelAssetID)
	if err != nil || !retired {
		t.Fatalf("retire: %v %v", retired, err)
	}
	if _, stops := worker.counts(); stops != 2 {
		t.Fatalf("retirement did not stop the resident Worker: stops=%d", stops)
	}
	if retired, err := host.RetireModelAsset("other"); err != nil || !retired {
		t.Fatal("unrelated ModelAsset retirement must be immediate")
	}
}
