package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type mutableLocalExecutionResolver struct {
	mu         sync.Mutex
	projection *localexecution.SelectedLocalExecution
	err        error
}

func (r *mutableLocalExecutionResolver) SelectedLocalCapabilityContracts() []string {
	return []string{capabilitydriver.LlamaCapabilityContract}
}

func (r *mutableLocalExecutionResolver) ResolveSelectedLocalExecution(string) (*localexecution.SelectedLocalExecution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return nil, r.err
	}
	return cloneSelectedExecutionForTest(r.projection), nil
}

func (r *mutableLocalExecutionResolver) set(projection *localexecution.SelectedLocalExecution) {
	r.mu.Lock()
	r.projection = projection
	r.mu.Unlock()
}

type localTextHostStub struct {
	started      chan struct{}
	release      chan struct{}
	canceled     chan struct{}
	err          error
	streamDeltas []localexecution.TextDelta
	result       localexecution.TextResult

	mu           sync.Mutex
	capturedArgs []string
	capturedBody []byte
}

func (h *localTextHostStub) ExecuteText(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	progress localexecution.TextProgressFunc,
) (localexecution.TextResult, error) {
	h.mu.Lock()
	h.capturedArgs = plan.ProcessArgs()
	h.capturedBody = plan.RequestBody()
	h.mu.Unlock()
	if progress != nil {
		progress(localexecution.TextExecutionProgressLoading)
		progress(localexecution.TextExecutionProgressReady)
	}
	if h.started != nil {
		select {
		case <-h.started:
		default:
			close(h.started)
		}
	}
	if h.release != nil {
		select {
		case <-h.release:
		case <-ctx.Done():
			return localexecution.TextResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
		}
	}
	if h.err != nil {
		return localexecution.TextResult{}, h.err
	}
	if h.result.Text != "" || h.result.FinishReason != runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
		return h.result, nil
	}
	return localexecution.TextResult{Text: "captured response", FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}, nil
}

func (h *localTextHostStub) StreamText(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	onDelta func(localexecution.TextDelta) error,
	progress localexecution.TextProgressFunc,
) (localexecution.TextResult, error) {
	h.mu.Lock()
	h.capturedArgs = plan.ProcessArgs()
	h.capturedBody = plan.RequestBody()
	h.mu.Unlock()
	if progress != nil {
		progress(localexecution.TextExecutionProgressLoading)
		progress(localexecution.TextExecutionProgressReady)
	}
	if h.started != nil {
		select {
		case <-h.started:
		default:
			close(h.started)
		}
	}
	if h.canceled != nil {
		<-ctx.Done()
		close(h.canceled)
		return localexecution.TextResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
	}
	if h.release != nil {
		select {
		case <-h.release:
		case <-ctx.Done():
			return localexecution.TextResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
		}
	}
	if h.err != nil {
		return localexecution.TextResult{}, h.err
	}
	for _, delta := range h.streamDeltas {
		if err := onDelta(delta); err != nil {
			return localexecution.TextResult{}, err
		}
	}
	if h.result.Text != "" || h.result.FinishReason != runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
		return h.result, nil
	}
	return localexecution.TextResult{Text: "captured response", FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}, nil
}

func TestSubmitLocalTextCapturesSelectionBeforeRunningJob(t *testing.T) {
	svc := newTestService(nil)
	resolver := &mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-first", "first.gguf")}
	host := &localTextHostStub{started: make(chan struct{}), release: make(chan struct{})}
	svc.SetLocalExecutionResolver(resolver)
	svc.SetLocalTextExecutionHost(host)
	defaults, err := structpb.NewStruct(map[string]any{"temperature": 0.2})
	if err != nil {
		t.Fatal(err)
	}
	ctx := localTextIntentContext(context.Background(), defaults)

	response, err := svc.SubmitScenarioJob(ctx, localTextJobRequestForTest())
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	select {
	case <-host.started:
	case <-time.After(2 * time.Second):
		t.Fatal("captured job did not start")
	}
	resolver.set(selectedTextExecutionForTest(t, "config-second", "second.gguf"))
	defaults.Fields["temperature"] = structpb.NewNumberValue(0.9)
	close(host.release)
	job := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("job = %+v", job)
	}
	host.mu.Lock()
	args := strings.Join(host.capturedArgs, " ")
	body := append([]byte(nil), host.capturedBody...)
	host.mu.Unlock()
	if !strings.Contains(args, "first.gguf") || strings.Contains(args, "second.gguf") {
		t.Fatalf("running job did not retain captured selection: %s", args)
	}
	var requestBody map[string]any
	if err := json.Unmarshal(body, &requestBody); err != nil || requestBody["temperature"] != 0.2 {
		t.Fatalf("running job did not retain captured AIConfig defaults: body=%s err=%v", body, err)
	}
	if job.GetModelResolved() != "config-first" {
		t.Fatalf("model_resolved = %q", job.GetModelResolved())
	}
}

func TestSubmitAppLocalTextCapturesAIConfigBeforeRunningJob(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-app-job", "app-job.gguf")})
	host := &localTextHostStub{started: make(chan struct{}), release: make(chan struct{})}
	svc.SetLocalTextExecutionHost(host)
	defaults, err := structpb.NewStruct(map[string]any{"temperature": 0.3})
	if err != nil {
		t.Fatal(err)
	}
	writeConfig := func(value *structpb.Struct) {
		t.Helper()
		if err := svc.aiConfigStore.Overwrite(context.Background(), "account-a", &runtimev1.AIConfig{
			Owner: derivedAppAIConfigOwner("app.local"),
			Capabilities: []*runtimev1.AIConfigCapabilityIntent{{
				CapabilityContract: capabilitydriver.LlamaCapabilityContract,
				Defaults:           value,
				Route:              &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}},
			}},
		}); err != nil {
			t.Fatalf("write App AIConfig: %v", err)
		}
	}
	writeConfig(defaults)
	principal := protectedprincipal.New(
		"app.local", "desktop-account-product.v1", "desktop-account-product.v1",
		&runtimev1.AccountProjection{AccountId: "account-a", RealmEnvironmentId: "realm-a"},
		1, [32]byte{1}, make(chan struct{}),
	)
	request := localTextJobRequestForTest()
	response, err := svc.SubmitScenarioJob(protectedprincipal.With(context.Background(), principal), request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	select {
	case <-host.started:
	case <-time.After(2 * time.Second):
		t.Fatal("App job did not start")
	}
	replacement, _ := structpb.NewStruct(map[string]any{"temperature": 0.8})
	writeConfig(replacement)
	close(host.release)
	job := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("job = %+v", job)
	}
	host.mu.Lock()
	body := append([]byte(nil), host.capturedBody...)
	host.mu.Unlock()
	var requestBody map[string]any
	if err := json.Unmarshal(body, &requestBody); err != nil || requestBody["temperature"] != 0.3 {
		t.Fatalf("App job did not retain captured AIConfig: body=%s err=%v", body, err)
	}
}

func TestLocalTextExecutionFailureReasonsRemainDistinct(t *testing.T) {
	tests := []struct {
		kind   localexecution.FailureKind
		reason runtimev1.ReasonCode
	}{
		{localexecution.FailureLoad, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED},
		{localexecution.FailureInference, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED},
		{localexecution.FailureProcessCrash, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_PROCESS_CRASHED},
		{localexecution.FailureCanceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED},
	}
	for _, test := range tests {
		err := localTextExecutionError(&localexecution.ExecutionError{Kind: test.kind, Err: fmt.Errorf("failure")})
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != test.reason {
			t.Fatalf("%s error = %v, reason=%v ok=%v", test.kind, err, reason, ok)
		}
	}
	if usage := localTextUsage(localexecution.TextResult{Text: "not measured"}, &runtimev1.TextGenerateScenarioSpec{}); usage != nil {
		t.Fatalf("local execution synthesized usage: %+v", usage)
	}
	if usage := localTextUsage(localexecution.TextResult{ComputeMS: 7}, nil); usage == nil || usage.GetComputeMs() != 7 {
		t.Fatalf("local execution discarded measured compute usage: %+v", usage)
	}
}

func TestLocalTextLoadFailureIsTypedAndDoesNotMutateSelection(t *testing.T) {
	svc := newTestService(nil)
	selected := selectedTextExecutionForTest(t, "config-stable", "stable.gguf")
	resolver := &mutableLocalExecutionResolver{projection: selected}
	host := &localTextHostStub{err: &localexecution.ExecutionError{Kind: localexecution.FailureLoad, Err: fmt.Errorf("mmap failed")}}
	svc.SetLocalExecutionResolver(resolver)
	svc.SetLocalTextExecutionHost(host)
	ctx := localTextIntentContext(context.Background(), nil)
	_, err := svc.ExecuteScenario(ctx, localTextExecuteRequestForTest())
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED {
		t.Fatalf("load error = %v, reason=%v ok=%v", err, reason, ok)
	}
	current, resolveErr := resolver.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
	if resolveErr != nil || current.ConfigurationID != selected.ConfigurationID || current.ExactBindings[0].AbsolutePath != selected.ExactBindings[0].AbsolutePath {
		t.Fatalf("load failure mutated selection/binding: %+v, %v", current, resolveErr)
	}
}

func TestSelectedLocalTextContextMetadataHasNoResidentOrDurableTarget(t *testing.T) {
	svc := newTestService(nil)
	selected := selectedTextExecutionForTest(t, "config-context", "context.gguf")
	portable, err := structpb.NewStruct(map[string]any{"contextSize": 8192})
	if err != nil {
		t.Fatal(err)
	}
	selected.PortableConfig = portable
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selected})
	window, catalogRevision, modelRevision, provider, targetRef, release, err := svc.ResolvePublicChatTextContextMetadataLease(
		context.Background(), runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, "display-only", nil,
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextContextMetadataLease: %v", err)
	}
	if release == nil {
		t.Fatal("metadata ownership release is nil")
	}
	release()
	if window != 8192 || catalogRevision != "local-capability-configuration/v1" || modelRevision == "" || provider != "local" || targetRef != nil {
		t.Fatalf("metadata = window=%d catalog=%q revision=%q provider=%q target=%+v", window, catalogRevision, modelRevision, provider, targetRef)
	}
}

func TestUnsupportedLocalMediaFailsClosedWithoutLlamaInference(t *testing.T) {
	tests := []struct {
		name         string
		scenarioType runtimev1.ScenarioType
		spec         *runtimev1.ScenarioSpec
	}{
		{name: "image", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cat", N: 1, Size: "1024x1024"}},
		}},
		{name: "speech", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello"}},
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := newTestService(nil)
			ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
				CapabilityContract: scenarioTargetCapability(tt.scenarioType),
				Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			})
			_, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
				Head:         &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "account-a"},
				ScenarioType: tt.scenarioType, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: tt.spec,
			})
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
				t.Fatalf("error = %v, reason=%v ok=%v", err, reason, ok)
			}
		})
	}
}

func TestLocalTextWithoutMachineSelectionFailsClosed(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{err: grpcerr.WithReasonCode(
		codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND,
	)})
	ctx := localTextIntentContext(context.Background(), nil)
	_, err := svc.ExecuteScenario(ctx, localTextExecuteRequestForTest())
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND {
		t.Fatalf("missing selection error = %v, reason=%v ok=%v", err, reason, ok)
	}
}

func TestLocalTextWithoutAIConfigIntentFailsClosed(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config", "main.gguf")})
	principal := protectedprincipal.New(
		"app.local", "desktop-account-product.v1", "desktop-account-product.v1",
		&runtimev1.AccountProjection{AccountId: "account-a", RealmEnvironmentId: "realm-a"},
		1, [32]byte{1}, make(chan struct{}),
	)
	ctx := protectedprincipal.With(context.Background(), principal)
	req := localTextExecuteRequestForTest()
	req.Head.AppId = "app.local"
	_, err := svc.ExecuteScenario(ctx, req)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("status = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND {
		t.Fatalf("reason = %v ok=%v, err=%v", reason, ok, err)
	}
}

func TestLocalTextStreamEmitsStartedDeltasAndRealUsage(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-stream", "stream.gguf")})
	svc.SetLocalTextExecutionHost(&localTextHostStub{
		streamDeltas: []localexecution.TextDelta{{Text: "hello from local stream"}},
		result: localexecution.TextResult{
			Text: "hello from local stream", InputTokens: 5, OutputTokens: 8, ComputeMS: 12,
			FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		},
	})
	executeRequest := localTextExecuteRequestForTest()
	stream := &mockScenarioEventStream{ctx: localTextIntentContext(context.Background(), nil)}
	request := &runtimev1.StreamScenarioRequest{
		Head: executeRequest.GetHead(), ScenarioType: executeRequest.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, Spec: executeRequest.GetSpec(),
	}
	if err := svc.StreamScenario(request, stream); err != nil {
		t.Fatalf("StreamScenario: %v", err)
	}
	if len(stream.events) < 3 || stream.events[0].GetStarted() == nil ||
		stream.events[0].GetStarted().GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_UNSPECIFIED {
		t.Fatalf("stream start events = %+v", stream.events)
	}
	var text strings.Builder
	var completed *runtimev1.ScenarioStreamCompleted
	for _, event := range stream.events {
		if delta := event.GetDelta().GetText(); delta != nil {
			text.WriteString(delta.GetText())
		}
		if event.GetCompleted() != nil {
			completed = event.GetCompleted()
		}
	}
	if text.String() != "hello from local stream" || completed == nil || completed.GetUsage().GetInputTokens() != 5 ||
		completed.GetUsage().GetOutputTokens() != 8 || completed.GetUsage().GetComputeMs() != 12 {
		t.Fatalf("stream text=%q completed=%+v", text.String(), completed)
	}
}

func TestLocalTextStreamFailureEmitsTypedTerminalEvent(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-stream-failure", "stream-failure.gguf")})
	svc.SetLocalTextExecutionHost(&localTextHostStub{err: &localexecution.ExecutionError{
		Kind: localexecution.FailureInference, Err: errors.New("inference failed"),
	}})
	executeRequest := localTextExecuteRequestForTest()
	stream := &mockScenarioEventStream{ctx: localTextIntentContext(context.Background(), nil)}
	request := &runtimev1.StreamScenarioRequest{
		Head: executeRequest.GetHead(), ScenarioType: executeRequest.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, Spec: executeRequest.GetSpec(),
	}
	if err := svc.StreamScenario(request, stream); err != nil {
		t.Fatalf("StreamScenario: %v", err)
	}
	failed := stream.events[len(stream.events)-1].GetFailed()
	if failed == nil || failed.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED ||
		failed.GetActionHint() != "retry_or_adjust_request" {
		t.Fatalf("terminal event = %+v", stream.events[len(stream.events)-1])
	}
}

func TestLocalTextStreamCancelTerminatesHostRequest(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config", "stream.gguf")})
	host := &localTextHostStub{started: make(chan struct{}), canceled: make(chan struct{})}
	svc.SetLocalTextExecutionHost(host)
	baseCtx, cancel := context.WithCancel(context.Background())
	ctx := localTextIntentContext(baseCtx, nil)
	stream := &mockScenarioEventStream{ctx: ctx}
	errCh := make(chan error, 1)
	go func() {
		errCh <- svc.StreamScenario(&runtimev1.StreamScenarioRequest{
			Head:          localTextExecuteRequestForTest().GetHead(),
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
			Spec:          localTextExecuteRequestForTest().GetSpec(),
		}, stream)
	}()
	select {
	case <-host.started:
	case <-time.After(2 * time.Second):
		t.Fatal("stream host did not start")
	}
	cancel()
	select {
	case <-host.canceled:
	case <-time.After(2 * time.Second):
		t.Fatal("stream cancel did not reach execution host")
	}
	select {
	case err := <-errCh:
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED {
			t.Fatalf("stream cancel error = %v, reason=%v ok=%v", err, reason, ok)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("StreamScenario did not return")
	}
}

func selectedTextExecutionForTest(t *testing.T, configurationID string, filename string) *localexecution.SelectedLocalExecution {
	t.Helper()
	path := filepath.Join(t.TempDir(), filename)
	return &localexecution.SelectedLocalExecution{
		ConfigurationID:    configurationID,
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		DisplayName:        configurationID,
		DriverIdentity: (&capabilitydriver.Identity{
			ImplementationID: capabilitydriver.LlamaImplementationID,
			DriverID:         capabilitydriver.LlamaDriverID,
			DriverDialect:    capabilitydriver.LlamaDriverDialect,
		}).Proto(),
		Requirements: []*runtimev1.LocalCapabilityRequirement{{RequirementId: capabilitydriver.MainGGUFRequirementID}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID:     capabilitydriver.MainGGUFRequirementID,
			LocalAssetID:      "asset-" + configurationID,
			AbsolutePath:      path,
			VerifiedContentID: "sha256:" + strings.Repeat("a", 64),
			EntrySHA256:       strings.Repeat("b", 64),
		}},
		Configured: true,
	}
}

func cloneSelectedExecutionForTest(input *localexecution.SelectedLocalExecution) *localexecution.SelectedLocalExecution {
	if input == nil {
		return nil
	}
	out := *input
	out.DriverIdentity, _ = proto.Clone(input.DriverIdentity).(*runtimev1.CapabilityImplementationIdentity)
	out.Requirements = make([]*runtimev1.LocalCapabilityRequirement, 0, len(input.Requirements))
	for _, requirement := range input.Requirements {
		cloned, _ := proto.Clone(requirement).(*runtimev1.LocalCapabilityRequirement)
		out.Requirements = append(out.Requirements, cloned)
	}
	out.ExactBindings = append([]localexecution.ExactBinding(nil), input.ExactBindings...)
	out.SupportedFeatures = append([]string(nil), input.SupportedFeatures...)
	return &out
}

func localTextIntentContext(parent context.Context, defaults *structpb.Struct) context.Context {
	return executionintent.WithIntent(parent, executionintent.Intent{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		Defaults:           defaults,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
}

func localTextExecuteRequestForTest() *runtimev1.ExecuteScenarioRequest {
	return &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app.local",
			SubjectUserId: "account-a",
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		}}},
	}
}

func localTextJobRequestForTest() *runtimev1.SubmitScenarioJobRequest {
	execute := localTextExecuteRequestForTest()
	return &runtimev1.SubmitScenarioJobRequest{
		Head:          execute.GetHead(),
		ScenarioType:  execute.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec:          execute.GetSpec(),
	}
}

func waitForScenarioJobTerminalForLocalTextTest(t *testing.T, svc *Service, jobID string) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job, ok := svc.scenarioJobs.get(jobID)
		if ok && isTerminalScenarioJobStatus(job.GetStatus()) {
			return job
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("job %s did not become terminal", jobID)
	return nil
}
