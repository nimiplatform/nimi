package ai

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
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
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type mutableLocalExecutionResolver struct {
	mu                 sync.Mutex
	projection         *localexecution.SelectedLocalExecution
	capabilityContract string
	err                error
	calls              int
}

func (r *mutableLocalExecutionResolver) ProjectSelectedLocalLoadout(string) (localexecution.LoadoutOption, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return localexecution.LoadoutOption{}, false, r.err
	}
	return selectedLoadoutOptionForTest(r.projection)
}

func (r *mutableLocalExecutionResolver) ResolveSelectedLocalExecution(contract string) (*localexecution.SelectedLocalExecution, error) {
	selected, err := r.ResolveLocalExecution(contract, "")
	if err == nil && selected == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	}
	return selected, err
}

func (r *mutableLocalExecutionResolver) ResolveLocalExecution(string, string) (*localexecution.SelectedLocalExecution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls++
	if r.err != nil {
		return nil, r.err
	}
	return cloneSelectedExecutionForTest(r.projection), nil
}

func (r *mutableLocalExecutionResolver) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls
}

func (r *mutableLocalExecutionResolver) set(projection *localexecution.SelectedLocalExecution) {
	r.mu.Lock()
	r.projection = projection
	r.mu.Unlock()
}

func selectedLoadoutOptionForTest(selected *localexecution.SelectedLocalExecution) (localexecution.LoadoutOption, bool, error) {
	if selected == nil {
		return localexecution.LoadoutOption{}, false, nil
	}
	return localexecution.LoadoutOption{
		LoadoutID: selected.LoadoutID, DisplayName: selected.DisplayName,
		CapabilityContract: selected.CapabilityContract, Implementation: selected.DriverIdentity,
		ImplementationSupportedFeatures: append([]string(nil), selected.ImplementationSupportedFeatures...),
		ConfiguredFeatures:              append([]string(nil), selected.ConfiguredFeatures...),
		TextBehaviors:                   cloneAITextBehaviorCapabilityProjections(selected.TextBehaviors),
		ValidationState:                 runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED,
	}, true, nil
}

type localTextHostStub struct {
	started      chan struct{}
	release      chan struct{}
	canceled     chan struct{}
	err          error
	streamDeltas []localexecution.TextDelta
	streamFn     func(context.Context, func(localexecution.TextDelta) error) (localexecution.TextResult, error)
	result       localexecution.TextResult
	embedResult  localexecution.EmbedResult

	mu                sync.Mutex
	executeCalls      int
	capturedArgs      []string
	capturedBody      []byte
	capturedEmbedPlan *capabilitydriver.EmbedInvocationPlan
}

func (h *localTextHostStub) ExecuteText(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	progress localexecution.TextProgressFunc,
) (localexecution.TextResult, error) {
	h.mu.Lock()
	h.executeCalls++
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

func (h *localTextHostStub) ExecuteEmbed(
	_ context.Context,
	plan *capabilitydriver.EmbedInvocationPlan,
	progress localexecution.TextProgressFunc,
) (localexecution.EmbedResult, error) {
	h.mu.Lock()
	h.capturedEmbedPlan = plan
	h.mu.Unlock()
	if progress != nil {
		progress(localexecution.TextExecutionProgressLoading)
		progress(localexecution.TextExecutionProgressReady)
	}
	if h.err != nil {
		return localexecution.EmbedResult{}, h.err
	}
	return h.embedResult, nil
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
	if h.streamFn != nil {
		return h.streamFn(ctx, onDelta)
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

func TestNormalizeLocalTextRequestExplicitZeroOverridesDefaults(t *testing.T) {
	defaults, _ := structpb.NewStruct(map[string]any{
		"temperature": 0.7, "top_p": 0.9, "max_tokens": 128.0, "top_k": 40.0,
		"presence_penalty": 1.0, "frequency_penalty": -1.0, "seed": 42.0,
	})
	spec := &runtimev1.TextGenerateScenarioSpec{
		Temperature: testFloat32(0), TopP: testFloat32(0), MaxTokens: testInt32(0), TopK: testInt32(0),
		PresencePenalty: testFloat32(0), FrequencyPenalty: testFloat32(0), Seed: testInt64(0),
	}
	got, err := normalizeLocalTextRequest(spec, defaults)
	if err != nil {
		t.Fatalf("normalizeLocalTextRequest: %v", err)
	}
	if got.Temperature == nil || got.TopP == nil || got.MaxTokens == nil || got.TopK == nil ||
		got.PresencePenalty == nil || got.FrequencyPenalty == nil || got.Seed == nil ||
		got.GetTemperature() != 0 || got.GetTopP() != 0 || got.GetMaxTokens() != 0 || got.GetTopK() != 0 ||
		got.GetPresencePenalty() != 0 || got.GetFrequencyPenalty() != 0 || got.GetSeed() != 0 {
		t.Fatalf("explicit zero values were replaced by defaults: %+v", got)
	}
}

func TestSubmitLocalImageCapturesSelectionBeforeRunningJob(t *testing.T) {
	svc := newTestService(nil)
	first := selectedImageExecutionForTest(t, "config-first")
	second := selectedImageExecutionForTest(t, "config-second")
	resolver := &mutableLocalExecutionResolver{
		projection: first, capabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
	}
	host := &localImageHostStub{entered: make(chan struct{}), allowStart: make(chan struct{})}
	svc.SetLocalExecutionResolver(resolver)
	svc.SetLocalImageExecutionHost(host)
	defaults, err := structpb.NewStruct(map[string]any{"size": "64x64"})
	if err != nil {
		t.Fatal(err)
	}
	request := localImageJobRequestForTest(1)
	request.GetSpec().GetImageGenerate().Size = ""

	response, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), defaults), request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	select {
	case <-host.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("captured image job did not enter Host")
	}
	resolver.set(second)
	defaults.Fields["size"] = structpb.NewStringValue("128x128")
	close(host.allowStart)
	job := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("job = %+v", job)
	}
	host.mu.Lock()
	plan := host.plans[0]
	host.mu.Unlock()
	loadPlan, loadOK := plan.LoadPlan().(capabilitydriver.StableDiffusionCPPLoadPlan)
	constraints, constraintsOK := plan.ResultConstraints().(capabilitydriver.StableDiffusionCPPResultConstraints)
	if !loadOK || !constraintsOK ||
		loadPlan.Main().AbsolutePath() != first.ExactBindings[0].AbsolutePath || loadPlan.Main().AbsolutePath() == second.ExactBindings[0].AbsolutePath ||
		constraints.Width() != 64 || constraints.Height() != 64 {
		t.Fatalf("running image job did not retain captured selection/defaults: load=%+v constraints=%+v", plan.LoadPlan(), plan.ResultConstraints())
	}
	if job.GetModelResolved() != "config-first" {
		t.Fatalf("model_resolved = %q", job.GetModelResolved())
	}
}

func TestLocalVideoJobSchedulerQueuedDeadlinePublishesTimeout(t *testing.T) {
	svc := newTestService(nil)
	svc.scheduler = scheduler.New(scheduler.Config{GlobalConcurrency: 1, PerAppConcurrency: 1})
	svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "video-queued-timeout")})
	host := &localVideoHostStub{entered: make(chan struct{}), started: make(chan struct{})}
	svc.SetLocalVideoExecutionHost(host)
	svc.SetLocalVideoMediaPipeline(&videoMediaPipelineStub{})

	blockerRelease, _, err := svc.scheduler.Acquire(context.Background(), "app.scheduler.blocker")
	if err != nil {
		t.Fatalf("acquire scheduler blocker: %v", err)
	}
	released := false
	t.Cleanup(func() {
		if !released {
			blockerRelease()
		}
	})

	request := localVideoJobRequestForTest(64, 64, 5)
	request.Head.AppId = "app.video.queued-timeout"
	request.Head.TimeoutMs = 100
	response, err := svc.SubmitScenarioJob(localVideoIntentContext(context.Background()), request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	select {
	case <-host.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("video job did not reach factual Host admission")
	}
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT || terminal.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("queued local video timeout = %+v", terminal)
	}
	select {
	case <-host.started:
		t.Fatal("scheduler-queued timed-out video job began backend work")
	default:
	}

	blockerRelease()
	released = true
}

func TestSubmitAppLocalImageCapturesAIConfigBeforeRunningJob(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{
		projection: selectedImageExecutionForTest(t, "config-app-job"), capabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
	})
	host := &localImageHostStub{entered: make(chan struct{}), allowStart: make(chan struct{})}
	svc.SetLocalImageExecutionHost(host)
	defaults, err := structpb.NewStruct(map[string]any{"size": "64x64", "n": 2.0})
	if err != nil {
		t.Fatal(err)
	}
	writeConfig := func(value *structpb.Struct) {
		t.Helper()
		if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "account-a", &runtimev1.AIConfig{
			Owner: derivedAppAIConfigOwner("app.local"),
			Capabilities: []*runtimev1.AIConfigCapabilityIntent{{
				CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
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
	request := localImageJobRequestForTest(0)
	request.GetSpec().GetImageGenerate().N = nil
	request.GetSpec().GetImageGenerate().Size = ""
	response, err := svc.SubmitScenarioJob(protectedprincipal.With(context.Background(), principal), request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	select {
	case <-host.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("App image job did not enter Host")
	}
	replacement, _ := structpb.NewStruct(map[string]any{"size": "128x128", "n": 1.0})
	writeConfig(replacement)
	close(host.allowStart)
	job := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("job = %+v", job)
	}
	host.mu.Lock()
	plan := host.plans[0]
	host.mu.Unlock()
	requestPlan := plan.RequestPlan()
	constraints, constraintsOK := plan.ResultConstraints().(capabilitydriver.StableDiffusionCPPResultConstraints)
	if requestPlan == nil || !constraintsOK || requestPlan.ImageCount() != 2 || constraints.Width() != 64 || constraints.Height() != 64 {
		t.Fatalf("App image job did not retain captured AIConfig: request=%+v constraints=%+v", requestPlan, plan.ResultConstraints())
	}
}

func TestLocalTextExecutionFailureReasonsRemainDistinct(t *testing.T) {
	tests := []struct {
		kind   localexecution.FailureKind
		reason runtimev1.ReasonCode
	}{
		{localexecution.FailureLoad, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED},
		{localexecution.FailureInference, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED},
		{localexecution.FailureOutOfMemory, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_OUT_OF_MEMORY},
		{localexecution.FailureProcessCrash, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_PROCESS_CRASHED},
		{localexecution.FailureCanceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED},
		{localexecution.FailureTextOutputIncomplete, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE},
		{localexecution.FailureTextOutputInvalid, runtimev1.ReasonCode_AI_OUTPUT_INVALID},
		{localexecution.FailureToolCallInvalid, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID},
	}
	for _, test := range tests {
		err := localTextExecutionError(&localexecution.ExecutionError{Kind: test.kind, Err: fmt.Errorf("failure")})
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != test.reason {
			t.Fatalf("%s error = %v, reason=%v ok=%v", test.kind, err, reason, ok)
		}
	}
	continuityCause := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID)
	continuityErr := localTextExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureTextOutputInvalid, Err: continuityCause})
	if reason, ok := grpcerr.ExtractReasonCode(continuityErr); !ok || reason != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID {
		t.Fatalf("reasoning continuity error = %v reason=%v present=%v", continuityErr, reason, ok)
	}
	if usage := localTextUsage(localexecution.TextResult{Text: "not measured"}, &runtimev1.TextGenerateScenarioSpec{}); usage != nil {
		t.Fatalf("local execution synthesized usage: %+v", usage)
	}
	if usage := localTextUsage(localexecution.TextResult{ComputeMS: 7}, nil); usage == nil || usage.GetComputeMs() != 7 {
		t.Fatalf("local execution discarded measured compute usage: %+v", usage)
	}
}

func TestLocalTextInvocationFailureSeparatesBehaviorFromModality(t *testing.T) {
	for _, test := range []struct {
		kind   capabilitydriver.InvocationFailureKind
		reason runtimev1.ReasonCode
	}{
		{capabilitydriver.InvocationFailureUnsupported, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED},
		{capabilitydriver.InvocationFailureTextBehaviorUnsupported, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED},
	} {
		err := localTextInvocationError(&capabilitydriver.InvocationError{Kind: test.kind, Err: fmt.Errorf("unsupported")})
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != test.reason {
			t.Fatalf("%s error = %v, reason=%v ok=%v", test.kind, err, reason, ok)
		}
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
	current, resolveErr := resolver.ResolveLocalExecution(capabilitydriver.LlamaCapabilityContract, selected.LoadoutID)
	if resolveErr != nil || current.LoadoutID != selected.LoadoutID || current.ExactBindings[0].AbsolutePath != selected.ExactBindings[0].AbsolutePath {
		t.Fatalf("load failure mutated selection/binding: %+v, %v", current, resolveErr)
	}
}

func TestRequireSelectedRequestFeaturesDistinguishesImplementationAndConditionalConfiguration(t *testing.T) {
	request := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{
		Role: "user", Parts: []*runtimev1.ChatContentPart{imagePart("artifact://image")},
	}}}
	for _, test := range []struct {
		name           string
		implementation []string
		configured     []string
		wantReason     runtimev1.ReasonCode
	}{
		{name: "implementation unsupported", wantReason: runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED},
		{name: "conditional slot missing", implementation: []string{"input.image"}, wantReason: runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING},
		{name: "conditional slot configured", implementation: []string{"input.image"}, configured: []string{"input.image"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := requireSelectedRequestFeatures(request, test.implementation, test.configured)
			if test.wantReason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				if err != nil {
					t.Fatalf("configured feature admission = %v", err)
				}
				return
			}
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != test.wantReason {
				t.Fatalf("feature admission reason = %v ok=%v err=%v, want %v", reason, ok, err, test.wantReason)
			}
		})
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
	captured := localexecution.WithSelectedLocalExecution(context.Background(), selected)
	window, catalogRevision, modelRevision, provider, targetRef, release, err := svc.ResolvePublicChatTextContextMetadataLease(
		captured, runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, "display-only", nil,
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextContextMetadataLease: %v", err)
	}
	if release == nil {
		t.Fatal("metadata ownership release is nil")
	}
	release()
	if window != 8192 || catalogRevision != "machine-loadout/v1" || modelRevision == "" || provider != "local" || targetRef != nil {
		t.Fatalf("metadata = window=%d catalog=%q revision=%q provider=%q target=%+v", window, catalogRevision, modelRevision, provider, targetRef)
	}
}

func TestLocalTextConsumersReuseAdmissionCapturedSelection(t *testing.T) {
	svc := newTestService(nil)
	selected := selectedTextExecutionForTest(t, "config-captured", "captured.gguf")
	portable, err := structpb.NewStruct(map[string]any{"contextSize": 8192})
	if err != nil {
		t.Fatal(err)
	}
	selected.PortableConfig = portable
	resolver := &mutableLocalExecutionResolver{err: errors.New("current selection must not be re-resolved")}
	svc.SetLocalExecutionResolver(resolver)
	ctx := localTextIntentContext(context.Background(), nil)
	ctx = localexecution.WithSelectedLocalExecution(ctx, selected)

	route, model, err := svc.ResolvePublicChatTextBinding(ctx, runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, "display-only")
	if err != nil {
		t.Fatalf("ResolvePublicChatTextBinding: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || model != "config-captured" {
		t.Fatalf("resolved binding = route=%v model=%q", route, model)
	}
	window, _, _, _, targetRef, release, err := svc.ResolvePublicChatTextContextMetadataLease(
		ctx, runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, model, nil,
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextContextMetadataLease: %v", err)
	}
	if release != nil {
		release()
	}
	if window != 8192 || targetRef != nil {
		t.Fatalf("captured metadata = window=%d target=%+v", window, targetRef)
	}
	request := localTextExecuteRequestForTest()
	effective, err := svc.captureLocalTextEffectiveInputs(ctx, request.GetHead(), request.GetSpec().GetTextGenerate(), true)
	if err != nil {
		t.Fatalf("captureLocalTextEffectiveInputs: %v", err)
	}
	effective.release()
	if calls := resolver.callCount(); calls != 0 {
		t.Fatalf("current selection resolver calls = %d, want 0", calls)
	}
}

func TestLocalTextCapturePreservesCompleteBundleInvocationIdentity(t *testing.T) {
	svc := newTestService(nil)
	selected := selectedTextExecutionForTest(t, "bundle-identity", "model.gguf")
	selected.ExactBindings[0].ModelAssetID = "model-bundle-identity"
	selected.ExactBindings[0].BundleDir = filepath.Dir(selected.ExactBindings[0].AbsolutePath)
	selected.ExactBindings[0].DeclaredFiles = []string{"model.gguf", "tokenizer.json"}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selected})
	request := localTextExecuteRequestForTest()
	effective, err := svc.captureLocalTextEffectiveInputs(localTextIntentContext(context.Background(), nil), request.GetHead(), request.GetSpec().GetTextGenerate(), false)
	if err != nil {
		t.Fatalf("capture local text bundle: %v", err)
	}
	defer effective.release()
	files := effective.plan.ModelFiles()
	if len(files) != 1 || files[0].ModelAssetID != selected.ExactBindings[0].ModelAssetID ||
		files[0].BundleDir != selected.ExactBindings[0].BundleDir || !slices.Equal(files[0].DeclaredFiles, selected.ExactBindings[0].DeclaredFiles) {
		t.Fatalf("captured invocation bundle identity = %+v, want %+v", files, selected.ExactBindings[0])
	}
}

func TestUnsupportedLocalSpeechFailsClosedWithoutLlamaInference(t *testing.T) {
	tests := []struct {
		name         string
		scenarioType runtimev1.ScenarioType
		spec         *runtimev1.ScenarioSpec
	}{
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
	svc.scenarioJobs.mu.RLock()
	if len(svc.scenarioJobs.jobs) != 1 {
		jobCount := len(svc.scenarioJobs.jobs)
		svc.scenarioJobs.mu.RUnlock()
		t.Fatalf("local stream persisted jobs = %d, want 1", jobCount)
	}
	for _, record := range svc.scenarioJobs.jobs {
		if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || record.resolvedAssembly == nil || !record.resolvedAssembly.LoadPlan.Text.Stream {
			svc.scenarioJobs.mu.RUnlock()
			t.Fatalf("local stream durable capture = %+v assembly=%+v", record.job, record.resolvedAssembly)
		}
	}
	svc.scenarioJobs.mu.RUnlock()
	if len(stream.events) < 3 || stream.events[0].GetStarted() == nil ||
		stream.events[0].GetStarted().GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_UNSPECIFIED {
		t.Fatalf("stream start events = %+v", stream.events)
	}
	var text strings.Builder
	var completed *runtimev1.ScenarioStreamCompleted
	for _, event := range stream.events {
		if delta := event.GetDelta().GetTextOutputItem().GetText(); delta != nil {
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

func TestLocalTextResolvedAssemblyRehydratesPublicChatShapedRequest(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-public-chat", "public-chat.gguf")})
	svc.SetLocalTextExecutionHost(&localTextHostStub{
		streamDeltas: []localexecution.TextDelta{{Text: "public chat reply"}},
		result: localexecution.TextResult{
			Text: "public chat reply", FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		},
	})
	executeRequest := localTextExecuteRequestForTest()
	spec := executeRequest.GetSpec().GetTextGenerate()
	spec.SystemPrompt = "<runtime-agent-context>You are the selected Runtime Agent.</runtime-agent-context> Reply concisely."
	spec.MaxTokens = proto.Int32(512)
	spec.Reasoning = &runtimev1.ReasoningConfig{
		Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED,
		Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
	}
	stream := &mockScenarioEventStream{ctx: localTextIntentContext(context.Background(), nil)}
	request := &runtimev1.StreamScenarioRequest{
		Head: executeRequest.GetHead(), ScenarioType: executeRequest.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, Spec: executeRequest.GetSpec(),
	}
	if err := svc.StreamScenario(request, stream); err != nil {
		t.Fatalf("StreamScenario public-chat request: %v", err)
	}
	if completed := stream.events[len(stream.events)-1].GetCompleted(); completed == nil {
		t.Fatalf("public-chat shaped stream did not complete: %+v", stream.events)
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

func TestLocalTextStreamSendFailurePersistsFailedCause(t *testing.T) {
	for _, test := range []struct {
		name         string
		failSendAt   int
		streamDeltas []localexecution.TextDelta
	}{
		{name: "started", failSendAt: 1},
		{name: "buffered delta flush", failSendAt: 2, streamDeltas: []localexecution.TextDelta{{Text: "short"}}},
		{name: "host delta delivery", failSendAt: 2, streamDeltas: []localexecution.TextDelta{{Text: strings.Repeat("x", minStreamChunkBytes)}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-stream-send-failure", "stream-send-failure.gguf")})
			host := &localTextHostStub{started: make(chan struct{}), streamDeltas: test.streamDeltas}
			svc.SetLocalTextExecutionHost(host)
			executeRequest := localTextExecuteRequestForTest()
			sendErr := status.Error(codes.Unavailable, "stream transport unavailable")
			stream := &mockScenarioEventStream{
				ctx: localTextIntentContext(context.Background(), nil), failSendAt: test.failSendAt, sendErr: sendErr,
			}
			err := svc.StreamScenario(&runtimev1.StreamScenarioRequest{
				Head: executeRequest.GetHead(), ScenarioType: executeRequest.GetScenarioType(),
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, Spec: executeRequest.GetSpec(),
			}, stream)
			if status.Code(err) != codes.Unavailable {
				t.Fatalf("StreamScenario status=%s err=%v", status.Code(err), err)
			}
			if status.Convert(err).Message() != "stream transport unavailable" {
				t.Fatalf("StreamScenario replaced transport detail: %v", err)
			}
			hostStarted := false
			select {
			case <-host.started:
				hostStarted = true
			default:
			}
			if test.failSendAt == 1 && hostStarted {
				t.Fatal("STARTED delivery failure invoked the local execution Host")
			}
			if test.failSendAt > 1 && !hostStarted {
				t.Fatal("buffered delivery failure did not reach the local execution Host")
			}
			svc.scenarioJobs.mu.RLock()
			defer svc.scenarioJobs.mu.RUnlock()
			if len(svc.scenarioJobs.jobs) != 1 {
				t.Fatalf("persisted stream Jobs=%d, want 1", len(svc.scenarioJobs.jobs))
			}
			for _, record := range svc.scenarioJobs.jobs {
				if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
					record.job.GetReasonCode() != runtimev1.ReasonCode_AI_STREAM_BROKEN {
					t.Fatalf("stream Send terminal status=%s reason=%s", record.job.GetStatus(), record.job.GetReasonCode())
				}
				if record.job.GetReasonDetail() != "stream delivery failed" {
					t.Fatalf("stream Send terminal detail=%q", record.job.GetReasonDetail())
				}
				metadata := record.job.GetReasonMetadata().AsMap()
				if metadata["action_hint"] != "retry_or_reopen_stream" || metadata["retryable"] != true {
					t.Fatalf("stream Send terminal metadata=%v", metadata)
				}
			}
		})
	}
}

func TestLocalTextStreamFirstPacketTimeoutEmitsTypedTerminalEvent(t *testing.T) {
	svc := newTestService(nil)
	svc.streamFirstPacketTimeout = 10 * time.Millisecond
	svc.streamIdleTimeout = time.Second
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-stream-first-timeout", "stream-first-timeout.gguf")})
	svc.SetLocalTextExecutionHost(&localTextHostStub{streamFn: func(ctx context.Context, _ func(localexecution.TextDelta) error) (localexecution.TextResult, error) {
		<-ctx.Done()
		return localexecution.TextResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
	}})
	executeRequest := localTextExecuteRequestForTest()
	executeRequest.Head.TimeoutMs = 150
	stream := &mockScenarioEventStream{ctx: localTextIntentContext(context.Background(), nil)}
	request := &runtimev1.StreamScenarioRequest{
		Head: executeRequest.GetHead(), ScenarioType: executeRequest.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, Spec: executeRequest.GetSpec(),
	}
	startedAt := time.Now()
	if err := svc.StreamScenario(request, stream); err != nil {
		t.Fatalf("StreamScenario: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed >= 100*time.Millisecond {
		t.Fatalf("first-packet timeout elapsed = %s, want before absolute cap", elapsed)
	}
	failed := stream.events[len(stream.events)-1].GetFailed()
	if failed == nil || failed.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("terminal event = %+v", stream.events[len(stream.events)-1])
	}
}

func TestLocalTextStreamIdleTimeoutRefreshesFromProviderDelta(t *testing.T) {
	svc := newTestService(nil)
	svc.streamFirstPacketTimeout = 100 * time.Millisecond
	svc.streamIdleTimeout = 10 * time.Millisecond
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-stream-idle-timeout", "stream-idle-timeout.gguf")})
	svc.SetLocalTextExecutionHost(&localTextHostStub{streamFn: func(ctx context.Context, onDelta func(localexecution.TextDelta) error) (localexecution.TextResult, error) {
		if err := onDelta(localexecution.TextDelta{Text: "activity"}); err != nil {
			return localexecution.TextResult{}, err
		}
		<-ctx.Done()
		return localexecution.TextResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
	}})
	executeRequest := localTextExecuteRequestForTest()
	executeRequest.Head.TimeoutMs = 150
	stream := &mockScenarioEventStream{ctx: localTextIntentContext(context.Background(), nil)}
	request := &runtimev1.StreamScenarioRequest{
		Head: executeRequest.GetHead(), ScenarioType: executeRequest.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, Spec: executeRequest.GetSpec(),
	}
	startedAt := time.Now()
	if err := svc.StreamScenario(request, stream); err != nil {
		t.Fatalf("StreamScenario: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed >= 100*time.Millisecond {
		t.Fatalf("idle timeout elapsed = %s, want before absolute cap", elapsed)
	}
	failed := stream.events[len(stream.events)-1].GetFailed()
	if failed == nil || failed.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
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
	svc.scenarioJobs.mu.RLock()
	defer svc.scenarioJobs.mu.RUnlock()
	for _, record := range svc.scenarioJobs.jobs {
		if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || record.job.GetReasonMetadata() != nil {
			t.Fatalf("canceled stream terminal status=%s metadata=%v", record.job.GetStatus(), record.job.GetReasonMetadata())
		}
	}
}

func selectedTextExecutionForTest(t *testing.T, configurationID string, filename string) *localexecution.SelectedLocalExecution {
	t.Helper()
	path := filepath.Join(t.TempDir(), filename)
	return &localexecution.SelectedLocalExecution{
		LoadoutID:          configurationID,
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		DisplayName:        configurationID,
		RecipeID:           capabilitydriver.LlamaGemma4RecipeID,
		RecipeRevision:     "1",
		DriverIdentity: (&capabilitydriver.Identity{
			ImplementationID: capabilitydriver.LlamaImplementationID,
			DriverID:         capabilitydriver.LlamaDriverID,
			DriverDialect:    capabilitydriver.LlamaDriverDialect,
		}).Proto(),
		ModelContextWindowTokens: 32768,
		Requirements:             []*runtimev1.LocalCapabilityRequirement{{RequirementId: capabilitydriver.MainGGUFRequirementID}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID:     capabilitydriver.MainGGUFRequirementID,
			ModelAssetID:      "asset-" + configurationID,
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
	out.ImplementationSupportedFeatures = append([]string(nil), input.ImplementationSupportedFeatures...)
	out.ConfiguredFeatures = append([]string(nil), input.ConfiguredFeatures...)
	out.TextBehaviors = cloneAITextBehaviorCapabilityProjections(input.TextBehaviors)
	return &out
}

func localTextIntentContext(parent context.Context, defaults *structpb.Struct) context.Context {
	return executionintent.WithIntent(parent, executionintent.Intent{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		LocalLoadoutRef:    "test-loadout:text.generate",
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
