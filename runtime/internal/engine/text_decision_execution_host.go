package engine

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

const engineTextDecisionHost EngineKind = "text-decision-host"

// Private loopback JSON transport bounds. The public 1 MiB request limit is
// Runtime-owned; JSON escaping can expand it before it reaches the Worker.
const (
	maxTextDecisionWorkerRequestBytes  = 8 << 20
	maxTextDecisionWorkerResponseBytes = 2 << 20
	textDecisionWorkerStartupTimeout   = 60 * time.Second
	// A caller may stop waiting (Stop, a new query, its own budget) while the
	// resident Worker finishes that computation behind its own lock. Only a
	// Worker that completes no exchange across this many consecutive abandoned
	// calls, and has made no progress for textDecisionWorkerStuckAfter, is
	// treated as stuck and replaced; a slow first load is not stuck.
	maxConsecutiveAbandonedTextDecisionCalls = 3
	textDecisionWorkerStuckAfter             = 2 * time.Minute
)

// textDecisionWorker supervises the private resident Decision Worker process.
// The captured checkpoint itself loads inside the first call's deadline.
type textDecisionWorker interface {
	running(identity string) (endpoint string, token string, ok bool)
	start(ctx context.Context, identity string, profileRoot string) (endpoint string, token string, err error)
	stop() error
}

// @nimi-authority: rule.nimi.runtime.ai-provider.laya-local-decision
// TextDecisionExecutionHost owns one supervised resident Decision Worker and
// its FIFO execution lease. Every model, profile and device fact comes from the
// captured plan and its verified profile manifest.
type TextDecisionExecutionHost struct {
	residentModelAssets
	worker   textDecisionWorker
	client   *http.Client
	lease    speechExecutionLease
	poisoned error
	// Consecutive calls whose caller stopped waiting before the Worker replied,
	// and when the Worker last started or answered; guarded by lease.
	abandoned  int
	progressAt time.Time
	now        func() time.Time
}

func NewTextDecisionExecutionHost(manager *Manager) *TextDecisionExecutionHost {
	if manager == nil {
		return nil
	}
	return &TextDecisionExecutionHost{worker: &managedTextDecisionWorker{manager: manager}, client: &http.Client{}, now: time.Now}
}

func (host *TextDecisionExecutionHost) ExecuteTextDecision(ctx context.Context, plan *capabilitydriver.TextDecisionInvocationPlan) (localexecution.TextDecisionResult, error) {
	if host == nil || host.worker == nil || host.client == nil || plan == nil || plan.Request == nil {
		return localexecution.TextDecisionResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("decision Host or captured plan is unavailable"))
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return localexecution.TextDecisionResult{}, textDecisionFailure(ctx, err)
	}
	defer func() { release(); host.residentModelAssets.notifyIdle() }()
	host.residentModelAssets.capture([]capabilitydriver.InvocationExactBinding{plan.Binding})
	if host.poisoned != nil {
		return localexecution.TextDecisionResult{}, executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	if err := ctx.Err(); err != nil {
		return localexecution.TextDecisionResult{}, textDecisionFailure(ctx, err)
	}
	endpoint, token, device, err := host.ensureWorker(ctx, plan)
	if err != nil {
		return localexecution.TextDecisionResult{}, host.fail(ctx, err)
	}
	body, err := textDecisionWorkerRequestBody(plan, device)
	if err != nil {
		return localexecution.TextDecisionResult{}, err
	}
	payload, status, err := host.exchange(ctx, endpoint, token, body)
	if err != nil {
		if ctx.Err() != nil {
			return localexecution.TextDecisionResult{}, host.abandon(ctx, err)
		}
		return localexecution.TextDecisionResult{}, host.fail(ctx, err)
	}
	host.abandoned = 0
	host.progressAt = host.clock()
	if status != http.StatusOK {
		failure := decodeTextDecisionWorkerFailure(status, payload)
		if textDecisionInputFailure(failure) && ctx.Err() == nil {
			// A typed input rejection leaves the loaded Worker healthy.
			return localexecution.TextDecisionResult{}, failure
		}
		return localexecution.TextDecisionResult{}, host.fail(ctx, failure)
	}
	result, err := decodeTextDecisionWorkerResponse(payload, plan.Request)
	if err != nil {
		return localexecution.TextDecisionResult{}, host.fail(ctx, executionFailure(localexecution.FailureTextOutputInvalid, err))
	}
	// A computation that finished after cancellation is discarded; the healthy
	// Worker stays resident.
	if err := ctx.Err(); err != nil {
		return localexecution.TextDecisionResult{}, textDecisionFailure(ctx, err)
	}
	return result, nil
}

// ensureWorker verifies the captured profile and reuses the resident Worker
// only for an identical loading identity; otherwise it seals the complete
// captured checkpoint and replaces the Worker.
func (host *TextDecisionExecutionHost) ensureWorker(ctx context.Context, plan *capabilitydriver.TextDecisionInvocationPlan) (string, string, string, error) {
	manifest, err := ReadPythonDependencyProfileManifest(plan.ProfileRoot)
	if err != nil {
		return "", "", "", executionFailure(localexecution.FailureLoad, fmt.Errorf("read captured decision profile: %w", err))
	}
	profile := manifest.Identity
	device := profile.AcceleratorPlane
	if profile.PlatformTuple != runtime.GOOS+"/"+runtime.GOARCH || manifest.ValidationConsumer != TextDecisionConsumerID ||
		profile.ProfileDigest != plan.ProfileDigest || profile.DriverBundleDigest != plan.DriverBundleDigest || profile.DriverProtocol != plan.DriverProtocol ||
		(device != "cuda" && device != "cpu") {
		return "", "", "", executionFailure(localexecution.FailureLoad, fmt.Errorf("captured decision profile does not match the Worker"))
	}
	if err := VerifyPythonDependencyProfileStaticContent(plan.ProfileRoot, TextDecisionConsumerID, profile); err != nil {
		return "", "", "", executionFailure(localexecution.FailureLoad, err)
	}
	identity := strings.Join([]string{
		plan.ProfileRoot, plan.ProfileDigest, plan.DriverBundleDigest, plan.DriverProtocol, device,
		plan.ModelDir, plan.Binding.BundleDir, plan.Binding.VerifiedContentID, plan.Binding.EntrySHA256,
	}, "\n")
	if endpoint, token, ok := host.worker.running(identity); ok {
		return endpoint, token, device, nil
	}
	if err := host.stopWorker(); err != nil {
		return "", "", "", err
	}
	if _, err := sealInvocationModelContentContext(ctx, []capabilitydriver.InvocationExactBinding{plan.Binding}); err != nil {
		return "", "", "", err
	}
	endpoint, token, err := host.worker.start(ctx, identity, plan.ProfileRoot)
	if err != nil {
		return "", "", "", executionFailure(localexecution.FailureLoad, fmt.Errorf("start decision Worker: %w", err))
	}
	host.progressAt = host.clock()
	return endpoint, token, device, nil
}

func (host *TextDecisionExecutionHost) exchange(ctx context.Context, endpoint string, token string, body []byte) ([]byte, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(endpoint, "/")+"/v1/text/decide", bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	request.Header.Set("x-nimi-decision-token", token)
	response, err := host.client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxTextDecisionWorkerResponseBytes+1))
	if err != nil {
		return nil, 0, err
	}
	if len(payload) > maxTextDecisionWorkerResponseBytes {
		return nil, 0, executionFailure(localexecution.FailureTextOutputInvalid, fmt.Errorf("decision Worker response exceeds its private transport bound"))
	}
	return payload, response.StatusCode, nil
}

func (host *TextDecisionExecutionHost) stopWorker() error {
	// Abandonments counted against a Worker never carry over to its replacement.
	host.abandoned = 0
	if err := host.worker.stop(); err != nil {
		host.poisoned = fmt.Errorf("stop decision Worker before releasing its lease: %w", err)
		return executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	return nil
}

func (host *TextDecisionExecutionHost) fail(ctx context.Context, cause error) error {
	host.abandoned = 0
	if err := host.stopWorker(); err != nil {
		return err
	}
	return textDecisionFailure(ctx, cause)
}

// abandon reports the caller's cancellation or deadline without stopping the
// resident Worker: its lease-ordered computation finishes and its result is
// discarded, so the next call reuses the loaded checkpoint. Repeated
// abandonment with no completed exchange replaces a Worker that may be stuck.
func (host *TextDecisionExecutionHost) abandon(ctx context.Context, cause error) error {
	host.abandoned++
	if host.abandoned >= maxConsecutiveAbandonedTextDecisionCalls && host.clock().Sub(host.progressAt) >= textDecisionWorkerStuckAfter {
		return host.fail(ctx, cause)
	}
	return textDecisionFailure(ctx, cause)
}

func (host *TextDecisionExecutionHost) clock() time.Time {
	if host.now != nil {
		return host.now()
	}
	return time.Now()
}

func (host *TextDecisionExecutionHost) RetireModelAsset(id string) (bool, error) {
	if host == nil || !host.residentModelAssets.uses(id) {
		return true, nil
	}
	release, ok := host.lease.tryAcquireIdle()
	if !ok {
		return false, nil
	}
	defer release()
	return host.residentModelAssets.retire(id, host.stopWorker)
}

// textDecisionFailure preserves cancellation and deadline ownership and the
// typed phase of an already classified failure.
func textDecisionFailure(ctx context.Context, cause error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		if errors.Is(ctxErr, context.DeadlineExceeded) {
			return executionFailure(localexecution.FailureTimeout, ctxErr)
		}
		return executionFailure(localexecution.FailureCanceled, ctxErr)
	}
	var executionErr *localexecution.ExecutionError
	if errors.As(cause, &executionErr) || textDecisionInputFailure(cause) {
		return cause
	}
	return executionFailure(localexecution.FailureInference, cause)
}

func textDecisionInputFailure(err error) bool {
	var executionErr *localexecution.ExecutionError
	if errors.As(err, &executionErr) {
		return false
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	return ok && (reason == runtimev1.ReasonCode_AI_INPUT_LIMIT_EXCEEDED || reason == runtimev1.ReasonCode_AI_INPUT_INVALID)
}

type textDecisionWorkerRequest struct {
	ModelDir       string          `json:"model_dir"`
	ModelContentID string          `json:"model_content_id"`
	ProfileDigest  string          `json:"profile_digest"`
	Device         string          `json:"device"`
	Request        json.RawMessage `json:"request"`
}

func textDecisionWorkerRequestBody(plan *capabilitydriver.TextDecisionInvocationPlan, device string) ([]byte, error) {
	request, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(plan.Request)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(textDecisionWorkerRequest{
		ModelDir: plan.ModelDir, ModelContentID: plan.Binding.VerifiedContentID, ProfileDigest: plan.ProfileDigest, Device: device, Request: request,
	}); err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	if encoded.Len() > maxTextDecisionWorkerRequestBytes {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return encoded.Bytes(), nil
}

func decodeTextDecisionWorkerFailure(status int, payload []byte) error {
	var failure struct {
		ReasonCode        string `json:"reason_code"`
		Detail            string `json:"detail"`
		QuestionIndex     *int   `json:"question_index"`
		RequiredPositions *int   `json:"required_positions"`
		MaxPositions      *int   `json:"max_positions"`
	}
	if json.Unmarshal(payload, &failure) != nil || strings.TrimSpace(failure.ReasonCode) == "" {
		return executionFailure(localexecution.FailureInference, fmt.Errorf("decision Worker returned an invalid failure (HTTP %d)", status))
	}
	detail := fmt.Errorf("decision Worker %s: %s", failure.ReasonCode, failure.Detail)
	switch failure.ReasonCode {
	case "AI_INPUT_LIMIT_EXCEEDED":
		if status != http.StatusUnprocessableEntity || failure.QuestionIndex == nil || failure.RequiredPositions == nil || failure.MaxPositions == nil ||
			*failure.QuestionIndex < 0 || *failure.MaxPositions <= 0 || *failure.RequiredPositions <= *failure.MaxPositions {
			return executionFailure(localexecution.FailureInference, fmt.Errorf("decision Worker returned an incomplete limit failure"))
		}
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_LIMIT_EXCEEDED, detail, grpcerr.ReasonOptions{
			ActionHint: "shorten_decision_state_or_question",
			Message: fmt.Sprintf("question %d requires %d encoder positions; the captured decision encoder admits %d",
				*failure.QuestionIndex, *failure.RequiredPositions, *failure.MaxPositions),
		})
	case "AI_INPUT_INVALID":
		if status != http.StatusUnprocessableEntity {
			return executionFailure(localexecution.FailureInference, detail)
		}
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, detail, grpcerr.ReasonOptions{
			Message: "decision content cannot be encoded as Unicode text",
		})
	case "AI_LOCAL_EXECUTION_LOAD_FAILED":
		return executionFailure(localexecution.FailureLoad, detail)
	case "AI_LOCAL_EXECUTION_OUT_OF_MEMORY":
		return executionFailure(localexecution.FailureOutOfMemory, detail)
	case "AI_OUTPUT_INVALID":
		return executionFailure(localexecution.FailureTextOutputInvalid, detail)
	default:
		return executionFailure(localexecution.FailureInference, detail)
	}
}

type textDecisionWorkerAnswer struct {
	QuestionID string `json:"question_id"`
	Choice     *struct {
		SelectedCandidateID string    `json:"selected_candidate_id"`
		Probabilities       []float64 `json:"probabilities"`
	} `json:"choice"`
	Boolean *struct {
		TrueProbability *float64 `json:"true_probability"`
	} `json:"boolean"`
}

type textDecisionWorkerResponse struct {
	Result *struct {
		Answers []textDecisionWorkerAnswer `json:"answers"`
	} `json:"result"`
	Usage *struct {
		InputTokens int64 `json:"input_tokens"`
		ComputeMS   int64 `json:"compute_ms"`
	} `json:"usage"`
}

// decodeTextDecisionWorkerResponse maps the index-aligned Worker answers onto
// the submitted question and candidate identities. Runtime validates the
// complete typed result again before publication.
func decodeTextDecisionWorkerResponse(payload []byte, request *runtimev1.TextDecideScenarioSpec) (localexecution.TextDecisionResult, error) {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var wire textDecisionWorkerResponse
	if err := decoder.Decode(&wire); err != nil {
		return localexecution.TextDecisionResult{}, fmt.Errorf("decode decision Worker response: %w", err)
	}
	var trailing any
	if !errors.Is(decoder.Decode(&trailing), io.EOF) {
		return localexecution.TextDecisionResult{}, fmt.Errorf("decision Worker returned trailing output")
	}
	questions := request.GetQuestions()
	if wire.Result == nil || wire.Usage == nil || wire.Usage.InputTokens < 0 || wire.Usage.ComputeMS < 0 || len(wire.Result.Answers) != len(questions) {
		return localexecution.TextDecisionResult{}, fmt.Errorf("decision Worker did not answer every question")
	}
	result := &runtimev1.TextDecisionResult{Answers: make([]*runtimev1.TextDecisionAnswer, 0, len(questions))}
	for index, question := range questions {
		answer := wire.Result.Answers[index]
		if answer.QuestionID != question.GetId() {
			return localexecution.TextDecisionResult{}, fmt.Errorf("decision Worker answer %d is out of submitted order", index)
		}
		switch kind := question.GetKind().(type) {
		case *runtimev1.TextDecisionQuestion_Choice:
			candidates := kind.Choice.GetCandidates()
			if answer.Choice == nil || answer.Boolean != nil || len(answer.Choice.Probabilities) != len(candidates) {
				return localexecution.TextDecisionResult{}, fmt.Errorf("decision Worker choice answer %d is incomplete", index)
			}
			typed := &runtimev1.TextDecisionChoiceAnswer{SelectedCandidateId: answer.Choice.SelectedCandidateID, Probabilities: make([]*runtimev1.TextDecisionCandidateProbability, 0, len(candidates))}
			selected := false
			for position, candidate := range candidates {
				probability := answer.Choice.Probabilities[position]
				if !validTextDecisionWorkerProbability(probability) {
					return localexecution.TextDecisionResult{}, fmt.Errorf("decision Worker choice answer %d has an invalid probability", index)
				}
				selected = selected || candidate.GetId() == answer.Choice.SelectedCandidateID
				typed.Probabilities = append(typed.Probabilities, &runtimev1.TextDecisionCandidateProbability{CandidateId: candidate.GetId(), Probability: probability})
			}
			if !selected {
				return localexecution.TextDecisionResult{}, fmt.Errorf("decision Worker choice answer %d selected an unknown candidate", index)
			}
			result.Answers = append(result.Answers, &runtimev1.TextDecisionAnswer{QuestionId: question.GetId(), Result: &runtimev1.TextDecisionAnswer_Choice{Choice: typed}})
		case *runtimev1.TextDecisionQuestion_Boolean:
			if answer.Boolean == nil || answer.Choice != nil || answer.Boolean.TrueProbability == nil || !validTextDecisionWorkerProbability(*answer.Boolean.TrueProbability) {
				return localexecution.TextDecisionResult{}, fmt.Errorf("decision Worker boolean answer %d is invalid", index)
			}
			result.Answers = append(result.Answers, &runtimev1.TextDecisionAnswer{QuestionId: question.GetId(), Result: &runtimev1.TextDecisionAnswer_Boolean{
				Boolean: &runtimev1.TextDecisionBooleanAnswer{TrueProbability: *answer.Boolean.TrueProbability},
			}})
		default:
			return localexecution.TextDecisionResult{}, fmt.Errorf("decision question %d has no admitted kind", index)
		}
	}
	return localexecution.TextDecisionResult{Result: result, InputTokens: wire.Usage.InputTokens, ComputeMS: wire.Usage.ComputeMS}, nil
}

func validTextDecisionWorkerProbability(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 1
}

type managedTextDecisionWorker struct {
	manager  *Manager
	identity string
	endpoint string
	token    string
}

func (worker *managedTextDecisionWorker) running(identity string) (string, string, bool) {
	info, err := worker.manager.EngineStatus(engineTextDecisionHost)
	if err == nil && info.Status == StatusHealthy && info.PID > 0 && worker.identity == identity && worker.token != "" {
		return worker.endpoint, worker.token, true
	}
	return "", "", false
}

func (worker *managedTextDecisionWorker) start(ctx context.Context, identity string, profileRoot string) (string, string, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return "", "", err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		return "", "", err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", "", err
	}
	token := hex.EncodeToString(secret)
	env := pythonDependencyProfileReadOnlyEnv()
	// An inherited PYTHONPATH or PYTHONHOME could shadow the verified profile's packages.
	neutralizeAmbientPythonEnvironment(env)
	env["NIMI_RUNTIME_DECISION_ADMISSION_TOKEN"] = token
	env["USE_TF"] = "0"
	env["TOKENIZERS_PARALLELISM"] = "false"
	cfg := EngineConfig{
		Kind: engineTextDecisionHost, Port: port, BinaryPath: managedPythonPath(profileRoot),
		CommandArgs: []string{filepath.Join(profileRoot, textDecisionServerScriptName), "--port", strconv.Itoa(port)},
		CommandEnv:  env, WorkingDir: profileRoot, ExecutionHostIdentity: identity,
		HealthMode: HealthModeHTTP, HealthPath: "/health", HealthResponse: capabilitydriver.LayaProtocol,
		StartupTimeout: textDecisionWorkerStartupTimeout, HealthInterval: 30 * time.Second, ShutdownTimeout: 3 * time.Second, MaxRestarts: 0,
	}
	if err := worker.manager.StartEngine(ctx, cfg); err != nil {
		return "", "", err
	}
	// A Supervisor whose startup health failed stays registered as unhealthy;
	// that is a Worker load failure, not a started Worker.
	if info, err := worker.manager.EngineStatus(engineTextDecisionHost); err != nil || info.Status != StatusHealthy {
		detail := "status unavailable"
		if err == nil {
			detail = strings.TrimSpace(string(info.Status) + ": " + info.Detail)
		}
		return "", "", fmt.Errorf("decision Worker did not become healthy (%s)", detail)
	}
	worker.identity, worker.token, worker.endpoint = identity, token, cfg.Endpoint()
	return worker.endpoint, worker.token, nil
}

func (worker *managedTextDecisionWorker) stop() error {
	err := worker.manager.StopEngine(engineTextDecisionHost)
	if err != nil && !errors.Is(err, ErrEngineNotRunning) {
		return err
	}
	worker.identity, worker.token, worker.endpoint = "", "", ""
	return nil
}
