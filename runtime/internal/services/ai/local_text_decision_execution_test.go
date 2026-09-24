package ai

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type fakeTextDecisionHost struct {
	execute func(context.Context, *capabilitydriver.TextDecisionInvocationPlan) (localexecution.TextDecisionResult, error)
	plans   []*capabilitydriver.TextDecisionInvocationPlan
}

func (host *fakeTextDecisionHost) ExecuteTextDecision(ctx context.Context, plan *capabilitydriver.TextDecisionInvocationPlan) (localexecution.TextDecisionResult, error) {
	host.plans = append(host.plans, plan)
	return host.execute(ctx, plan)
}

func decisionTestSpec() *runtimev1.TextDecideScenarioSpec {
	return &runtimev1.TextDecideScenarioSpec{
		State: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Json{Json: `{"request":"rust async news"}`}},
		Questions: []*runtimev1.TextDecisionQuestion{
			{Id: "window", Instructions: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "Which window?"}},
				Kind: &runtimev1.TextDecisionQuestion_Choice{Choice: &runtimev1.TextDecisionChoice{Candidates: []*runtimev1.TextDecisionCandidate{{Id: "day"}, {Id: "week"}}}}},
			{Id: "news", Instructions: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "News?"}},
				Kind: &runtimev1.TextDecisionQuestion_Boolean{Boolean: &runtimev1.TextDecisionBoolean{}}},
		},
	}
}

func decisionTestResult(day, week, news float64) *runtimev1.TextDecisionResult {
	selected := "day"
	if week > day {
		selected = "week"
	}
	return &runtimev1.TextDecisionResult{Answers: []*runtimev1.TextDecisionAnswer{
		{QuestionId: "window", Result: &runtimev1.TextDecisionAnswer_Choice{Choice: &runtimev1.TextDecisionChoiceAnswer{SelectedCandidateId: selected, Probabilities: []*runtimev1.TextDecisionCandidateProbability{
			{CandidateId: "day", Probability: day}, {CandidateId: "week", Probability: week},
		}}}},
		{QuestionId: "news", Result: &runtimev1.TextDecisionAnswer_Boolean{Boolean: &runtimev1.TextDecisionBooleanAnswer{TrueProbability: news}}},
	}}
}

func decisionSelectedExecution(root string) *localexecution.SelectedLocalExecution {
	requirements, _ := (capabilitydriver.LayaDriver{}).ProjectRecipe(capabilitydriver.LayaTypedDecisionsRecipeID, nil, nil)
	profile := strings.Repeat("a", 64)
	bundle := filepath.Join(root, "asset")
	return &localexecution.SelectedLocalExecution{
		LoadoutID: "decision-loadout", DisplayName: "Laya multilingual", CapabilityContract: capabilitydriver.TextDecideContract,
		RecipeID: capabilitydriver.LayaTypedDecisionsRecipeID, RecipeRevision: "1", Configured: true,
		DriverIdentity: &runtimev1.CapabilityImplementationIdentity{ImplementationId: capabilitydriver.LayaImplementationID, DriverId: capabilitydriver.LayaDriverID, DriverDialect: capabilitydriver.LayaDriverDialect},
		Requirements:   requirements,
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID: capabilitydriver.LayaModelSlot, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			ModelAssetID: "asset-laya", BundleDir: bundle, AbsolutePath: filepath.Join(bundle, "multilingual", "model.safetensors"),
			DeclaredFiles:     []string{"multilingual/encoder/config.json", "multilingual/model.safetensors", "multilingual/rl_agent_config.json", "multilingual/tokenizer/tokenizer.json", "multilingual/tokenizer/tokenizer_config.json"},
			VerifiedContentID: "sha256:" + strings.Repeat("b", 64), EntrySHA256: strings.Repeat("c", 64),
		}},
		ExactDependencySources: []localexecution.ExactDependencySource{{
			DependencyFamily: "python.package-set", DependencyID: "python-profile." + profile, ConsumerScope: capabilitydriver.LayaConsumerID,
			SelectedSourceRecordID: "profile-record", CanonicalRoot: filepath.Join(root, profile), Version: profile,
			Hashes: map[string]string{"profile_digest": profile, "driver_bundle_sha256": strings.Repeat("d", 64)},
		}},
	}
}

func decisionTestAssembly(t *testing.T, root string, spec *runtimev1.TextDecideScenarioSpec) (*localResolvedAssembly, *capabilitydriver.TextDecisionInvocationPlan) {
	t.Helper()
	selected := decisionSelectedExecution(root)
	plan, err := (capabilitydriver.LayaDriver{}).PlanTextDecisionInvocation(capabilitydriver.TextDecisionInvocationInput{
		RecipeID: selected.RecipeID, Request: spec,
		Bindings: projectInvocationExactBindings(selected.ExactBindings), DependencySources: invocationExactDependencySources(selected.ExactDependencySources),
	})
	if err != nil {
		t.Fatal(err)
	}
	assembly, err := localResolvedAssemblyForDecision(selected, plan)
	if err != nil {
		t.Fatal(err)
	}
	return assembly, plan
}

func TestDecisionResolvedAssemblyRoundTripsAndRejectsChangedCapture(t *testing.T) {
	root := t.TempDir()
	assembly, plan := decisionTestAssembly(t, root, decisionTestSpec())
	cloned, err := cloneLocalResolvedAssembly(assembly)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateLocalResolvedAssembly(cloned); err != nil {
		t.Fatal(err)
	}
	rehydrated, err := decisionPlanFromResolvedAssembly(cloned)
	if err != nil {
		t.Fatal(err)
	}
	if rehydrated.ModelDir != filepath.Join(root, "asset", "multilingual") || rehydrated.ModelDir != plan.ModelDir ||
		rehydrated.ProfileDigest != plan.ProfileDigest || rehydrated.Binding.VerifiedContentID != plan.Binding.VerifiedContentID ||
		len(rehydrated.Request.GetQuestions()) != 2 || rehydrated.Request.GetState().GetJson() != `{"request":"rust async news"}` {
		t.Fatalf("rehydrated plan differs: %+v", rehydrated)
	}
	if identity, err := projectResolvedAssemblyEffectiveInputIdentity(cloned); err != nil || identity.GetModelAxes()[0].GetContentId() != plan.Binding.VerifiedContentID {
		t.Fatalf("effective input identity: %v %v", identity, err)
	}
	for name, mutate := range map[string]func(*localResolvedAssembly){
		"model dir":      func(value *localResolvedAssembly) { value.LoadPlan.Decision.ModelDir = filepath.Join(root, "other") },
		"profile digest": func(value *localResolvedAssembly) { value.LoadPlan.Decision.ProfileDigest = strings.Repeat("e", 64) },
		"dependency":     func(value *localResolvedAssembly) { value.DependencySources[0].Version = strings.Repeat("f", 64) },
		"kind":           func(value *localResolvedAssembly) { value.LoadPlan.Kind = "annotation" },
		"request":        func(value *localResolvedAssembly) { value.Request.Payload = []byte(`{"questions":[]}`) },
		"driver":         func(value *localResolvedAssembly) { value.DriverIdentity.DriverDialect = "laya/text-decide/v0" },
	} {
		t.Run(name, func(t *testing.T) {
			changed, err := cloneLocalResolvedAssembly(assembly)
			if err != nil {
				t.Fatal(err)
			}
			mutate(changed)
			if err := validateLocalResolvedAssembly(changed); err == nil {
				t.Fatal("changed captured decision assembly was admitted")
			}
		})
	}
}

func decisionJobFixture(t *testing.T, host *fakeTextDecisionHost, timeoutMS int32) (*Service, *runtimev1.ScenarioJob, *runtimev1.TextDecideScenarioSpec) {
	t.Helper()
	spec := decisionTestSpec()
	assembly, _ := decisionTestAssembly(t, t.TempDir(), spec)
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		t.Fatal(err)
	}
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalTextDecisionExecutionHost(host)
	job := &runtimev1.ScenarioJob{
		JobId: "decision-job", Head: &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", TimeoutMs: timeoutMS},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_DECIDE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, TraceId: "decision-trace", EffectiveInputIdentity: identity,
	}
	stored, created, err := svc.scenarioJobs.createOwnedAndBindAssemblyChecked(job, nil, nil, "", assembly)
	if err != nil || !created {
		t.Fatalf("create decision job: %v %v", created, err)
	}
	if !svc.scenarioJobs.startExecution(stored.GetJobId()) {
		t.Fatal("decision job execution was not admitted")
	}
	return svc, stored, spec
}

func TestLocalDecisionJobPublishesOnlyValidatedCapturedResults(t *testing.T) {
	host := &fakeTextDecisionHost{execute: func(_ context.Context, plan *capabilitydriver.TextDecisionInvocationPlan) (localexecution.TextDecisionResult, error) {
		return localexecution.TextDecisionResult{Result: decisionTestResult(0.25, 0.75, 0.6), InputTokens: 12, ComputeMS: 3}, nil
	}}
	svc, job, _ := decisionJobFixture(t, host, 0)
	result, usage, err := svc.runCapturedLocalDecisionJob(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	if result.GetAnswers()[0].GetChoice().GetSelectedCandidateId() != "week" || usage.GetInputTokens() != 12 || usage.GetComputeMs() != 3 {
		t.Fatalf("result=%v usage=%v", result, usage)
	}
	if len(host.plans) != 1 || host.plans[0].Request.GetQuestions()[1].GetId() != "news" {
		t.Fatal("Host did not receive the rehydrated captured plan")
	}
	stored, _ := svc.scenarioJobs.get(job.GetJobId())
	if stored.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || stored.GetUsage().GetInputTokens() != 12 {
		t.Fatalf("job status=%s usage=%v", stored.GetStatus(), stored.GetUsage())
	}
}

func TestLocalDecisionJobFailsTypedWithoutPublishingSuccess(t *testing.T) {
	limit := grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_LIMIT_EXCEEDED, grpcerr.ReasonOptions{Message: "question 0 requires 9000 encoder positions"})
	for _, test := range []struct {
		name   string
		result localexecution.TextDecisionResult
		err    error
		reason runtimev1.ReasonCode
		code   codes.Code
	}{
		{name: "encoder limit", err: limit, reason: runtimev1.ReasonCode_AI_INPUT_LIMIT_EXCEEDED, code: codes.InvalidArgument},
		{name: "unnormalized", result: localexecution.TextDecisionResult{Result: decisionTestResult(0.2, 0.3, 0.6)}, reason: runtimev1.ReasonCode_AI_OUTPUT_INVALID, code: codes.Internal},
		{name: "load or device", err: &localexecution.ExecutionError{Kind: localexecution.FailureLoad, Err: io.ErrUnexpectedEOF}, reason: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, code: codes.FailedPrecondition},
		{name: "content", err: &localexecution.ExecutionError{Kind: localexecution.FailureContentMismatch, Err: io.EOF}, reason: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CONTENT_MISMATCH, code: codes.FailedPrecondition},
		{name: "memory", err: &localexecution.ExecutionError{Kind: localexecution.FailureOutOfMemory, Err: io.EOF}, reason: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_OUT_OF_MEMORY, code: codes.ResourceExhausted},
	} {
		t.Run(test.name, func(t *testing.T) {
			host := &fakeTextDecisionHost{execute: func(context.Context, *capabilitydriver.TextDecisionInvocationPlan) (localexecution.TextDecisionResult, error) {
				return test.result, test.err
			}}
			svc, job, _ := decisionJobFixture(t, host, 0)
			_, _, err := svc.runCapturedLocalDecisionJob(context.Background(), job)
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != test.reason || status.Code(err) != test.code {
				t.Fatalf("reason=%s code=%s err=%v", reason, status.Code(err), err)
			}
			stored, _ := svc.scenarioJobs.get(job.GetJobId())
			if stored.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || stored.GetReasonCode() != test.reason {
				t.Fatalf("job status=%s reason=%s", stored.GetStatus(), stored.GetReasonCode())
			}
		})
	}
}

func TestLocalDecisionJobDiscardsResultCompletedAfterCancellation(t *testing.T) {
	for _, deadline := range []bool{false, true} {
		entered := make(chan struct{})
		host := &fakeTextDecisionHost{execute: func(ctx context.Context, _ *capabilitydriver.TextDecisionInvocationPlan) (localexecution.TextDecisionResult, error) {
			close(entered)
			<-ctx.Done()
			// The started accelerator computation still finishes.
			return localexecution.TextDecisionResult{Result: decisionTestResult(0.5, 0.5, 0.5)}, nil
		}}
		timeout := int32(0)
		if deadline {
			timeout = 200
		}
		svc, job, _ := decisionJobFixture(t, host, timeout)
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() {
			_, _, err := svc.runCapturedLocalDecisionJob(ctx, job)
			done <- err
		}()
		<-entered
		if !deadline {
			cancel()
		}
		var err error
		select {
		case err = <-done:
		case <-time.After(10 * time.Second):
			t.Fatal("decision job did not observe cancellation")
		}
		cancel()
		wantReason, wantStatus := runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		if deadline {
			wantReason, wantStatus = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		}
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != wantReason {
			t.Fatalf("deadline=%v reason=%s err=%v", deadline, reason, err)
		}
		stored, _ := svc.scenarioJobs.get(job.GetJobId())
		if stored.GetStatus() != wantStatus {
			t.Fatalf("deadline=%v job status=%s", deadline, stored.GetStatus())
		}
	}
}

func TestTextDecideScenarioExecutesCapturedLocalLoadout(t *testing.T) {
	selected := decisionSelectedExecution(t.TempDir())
	ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
		CapabilityContract: capabilitydriver.TextDecideContract, Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, LocalLoadoutRef: selected.LoadoutID,
	})
	ctx = localexecution.WithSelectedLocalExecution(ctx, selected)
	request := &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_DECIDE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextDecide{TextDecide: decisionTestSpec()}},
	}
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, err := executeTextDecideScenario(ctx, svc, request, nil); status.Code(err) != codes.Unavailable {
		t.Fatalf("missing decision Host must fail before Job capture: %v", err)
	}
	host := &fakeTextDecisionHost{execute: func(_ context.Context, plan *capabilitydriver.TextDecisionInvocationPlan) (localexecution.TextDecisionResult, error) {
		return localexecution.TextDecisionResult{Result: decisionTestResult(0.9, 0.1, 0.2), InputTokens: 30, ComputeMS: 4}, nil
	}}
	svc.SetLocalTextDecisionExecutionHost(host)
	response, err := executeTextDecideScenario(ctx, svc, request, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || response.GetModelResolved() != "Laya multilingual" || response.GetTraceId() == "" ||
		response.GetOutput().GetTextDecision().GetAnswers()[0].GetChoice().GetSelectedCandidateId() != "day" || response.GetUsage().GetInputTokens() != 30 {
		t.Fatalf("response: %v", response)
	}
	if len(host.plans) != 1 || host.plans[0].ModelDir != filepath.Dir(selected.ExactBindings[0].AbsolutePath) {
		t.Fatalf("Host plans: %+v", host.plans)
	}
}

func TestTextDecideScenarioKeepsACallThatEndedBeforeExecutionOutOfIt(t *testing.T) {
	// A caller whose deadline elapsed, or who canceled, before execution began
	// (during admission, say) gets exactly that outcome: the Host never runs and
	// no Job completes after the caller is gone.
	for _, deadline := range []bool{true, false} {
		selected := decisionSelectedExecution(t.TempDir())
		ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
			CapabilityContract: capabilitydriver.TextDecideContract, Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, LocalLoadoutRef: selected.LoadoutID,
		})
		ctx = localexecution.WithSelectedLocalExecution(ctx, selected)
		var cancel context.CancelFunc
		if deadline {
			ctx, cancel = context.WithDeadline(ctx, time.Now().Add(-time.Millisecond))
		} else {
			ctx, cancel = context.WithCancel(ctx)
			cancel()
		}
		request := &runtimev1.ExecuteScenarioRequest{
			Head: &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_DECIDE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextDecide{TextDecide: decisionTestSpec()}},
		}
		svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
		svc.SetLocalTextDecisionExecutionHost(&fakeTextDecisionHost{execute: func(context.Context, *capabilitydriver.TextDecisionInvocationPlan) (localexecution.TextDecisionResult, error) {
			t.Error("a call that already ended reached the decision Host")
			return localexecution.TextDecisionResult{}, nil
		}})
		_, err := executeTextDecideScenario(ctx, svc, request, nil)
		cancel()
		wantCode, wantReason, wantStatus := codes.Canceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		if deadline {
			wantCode, wantReason, wantStatus = codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		}
		if reason, _ := grpcerr.ExtractReasonCode(err); status.Code(err) != wantCode || reason != wantReason {
			t.Fatalf("deadline=%v: code=%v reason=%v err=%v", deadline, status.Code(err), reason, err)
		}
		svc.scenarioJobs.mu.RLock()
		for _, record := range svc.scenarioJobs.jobs {
			if record.job.GetStatus() != wantStatus || record.job.GetReasonCode() != wantReason {
				t.Errorf("deadline=%v: Job %s/%s", deadline, record.job.GetStatus(), record.job.GetReasonCode())
			}
		}
		svc.scenarioJobs.mu.RUnlock()
	}
}
