package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
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
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

type localImageHostStub struct {
	mu              sync.Mutex
	plans           []*capabilitydriver.ImageInvocationPlan
	entered         chan struct{}
	allowStart      chan struct{}
	firstCommitted  chan struct{}
	allowSecond     chan struct{}
	cancelObserved  chan struct{}
	allowCancelExit chan struct{}
	failBeforeIndex int32
	failureKind     localexecution.FailureKind
	failure         error
}

type capabilityLocalExecutionResolver struct {
	selections map[string]*localexecution.SelectedLocalExecution
}

func (r *capabilityLocalExecutionResolver) SelectedLocalCapabilityContracts() []string {
	contracts := make([]string, 0, len(r.selections))
	for contract := range r.selections {
		contracts = append(contracts, contract)
	}
	return contracts
}

func (r *capabilityLocalExecutionResolver) ResolveSelectedLocalExecution(contract string) (*localexecution.SelectedLocalExecution, error) {
	selected := r.selections[contract]
	if selected == nil {
		return nil, fmt.Errorf("no Local execution for %s", contract)
	}
	return cloneSelectedExecutionForTest(selected), nil
}

type serialBlockingLocalImageHostStub struct {
	lease        chan struct{}
	firstEntered chan struct{}
	releaseFirst chan struct{}
	mu           sync.Mutex
	calls        int
}

func newSerialBlockingLocalImageHostStub() *serialBlockingLocalImageHostStub {
	return &serialBlockingLocalImageHostStub{
		lease:        make(chan struct{}, 1),
		firstEntered: make(chan struct{}),
		releaseFirst: make(chan struct{}),
	}
}

func (h *serialBlockingLocalImageHostStub) ExecuteImage(
	ctx context.Context,
	plan *capabilitydriver.ImageInvocationPlan,
	onStart localexecution.ImageExecutionStartFunc,
	onArtifact localexecution.ImageArtifactFunc,
	progress localexecution.ImageProgressFunc,
) (localexecution.ImageResult, error) {
	select {
	case h.lease <- struct{}{}:
		defer func() { <-h.lease }()
	case <-ctx.Done():
		return localexecution.ImageResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
	}
	if onStart != nil {
		if err := onStart(); err != nil {
			return localexecution.ImageResult{}, err
		}
	}
	h.mu.Lock()
	h.calls++
	call := h.calls
	h.mu.Unlock()
	if call == 1 {
		close(h.firstEntered)
		select {
		case <-h.releaseFirst:
		case <-ctx.Done():
			return localexecution.ImageResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
		}
	}
	if progress != nil {
		progress(localexecution.ImageExecutionProgress{Stage: localexecution.ImageExecutionStageLoading, ArtifactCount: int32(plan.ImageCount())})
	}
	result := localexecution.ImageResult{Artifacts: make([]localexecution.ImageArtifact, 0, plan.ImageCount())}
	for index := int32(1); index <= int32(plan.ImageCount()); index++ {
		artifact := localexecution.ImageArtifact{Index: index, Bytes: serviceTestPNGBytes()}
		result.Artifacts = append(result.Artifacts, artifact)
		if onArtifact != nil {
			if err := onArtifact(artifact); err != nil {
				return result, err
			}
		}
	}
	return result, nil
}

func (h *localImageHostStub) ExecuteImage(ctx context.Context, plan *capabilitydriver.ImageInvocationPlan, onStart localexecution.ImageExecutionStartFunc, onArtifact localexecution.ImageArtifactFunc, progress localexecution.ImageProgressFunc) (localexecution.ImageResult, error) {
	h.mu.Lock()
	h.plans = append(h.plans, plan)
	h.mu.Unlock()
	closeOnce(h.entered)
	if h.allowStart != nil {
		select {
		case <-h.allowStart:
		case <-ctx.Done():
			closeOnce(h.cancelObserved)
			if h.allowCancelExit != nil {
				<-h.allowCancelExit
			}
			return localexecution.ImageResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
		}
	}
	if onStart != nil {
		if err := onStart(); err != nil {
			return localexecution.ImageResult{}, err
		}
	}
	if progress != nil {
		progress(localexecution.ImageExecutionProgress{Stage: localexecution.ImageExecutionStageLoading, ArtifactCount: int32(plan.ImageCount())})
		progress(localexecution.ImageExecutionProgress{Stage: localexecution.ImageExecutionStageReady, ArtifactCount: int32(plan.ImageCount())})
	}
	result := localexecution.ImageResult{Artifacts: make([]localexecution.ImageArtifact, 0, plan.ImageCount()), ComputeMS: 23}
	for index := int32(1); index <= int32(plan.ImageCount()); index++ {
		if h.failBeforeIndex == index {
			failure := h.failure
			if failure == nil {
				failure = errors.New("image inference failed")
			}
			kind := h.failureKind
			if kind == "" {
				kind = localexecution.FailureInference
			}
			return result, &localexecution.ExecutionError{Kind: kind, Err: failure}
		}
		select {
		case <-ctx.Done():
			closeOnce(h.cancelObserved)
			return result, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
		default:
		}
		artifact := localexecution.ImageArtifact{Index: index, Bytes: serviceTestPNGBytes(), ComputeMS: 11}
		result.Artifacts = append(result.Artifacts, artifact)
		if onArtifact != nil {
			if err := onArtifact(artifact); err != nil {
				return result, err
			}
		}
		if progress != nil {
			progress(localexecution.ImageExecutionProgress{Stage: localexecution.ImageExecutionStageProduced, ArtifactIndex: index, ArtifactCount: int32(plan.ImageCount())})
		}
		if index == 1 {
			closeOnce(h.firstCommitted)
			if h.allowSecond != nil {
				select {
				case <-h.allowSecond:
				case <-ctx.Done():
					closeOnce(h.cancelObserved)
					if h.allowCancelExit != nil {
						<-h.allowCancelExit
					}
					return result, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
				}
			}
		}
	}
	return result, nil
}

func TestNormalizeLocalImageRequestExplicitZeroOverridesDefaults(t *testing.T) {
	defaults, _ := structpb.NewStruct(map[string]any{"n": 3.0, "seed": 19.0})
	got, err := normalizeLocalImageRequest(&runtimev1.ImageGenerateScenarioSpec{
		Prompt: "image", N: testInt32(0), Seed: testInt64(0),
	}, defaults)
	if err != nil {
		t.Fatalf("normalizeLocalImageRequest: %v", err)
	}
	if got.N == nil || got.Seed == nil || got.GetN() != 0 || got.GetSeed() != 0 {
		t.Fatalf("explicit zero values were replaced by defaults: %+v", got)
	}
}

func TestNormalizeLocalImageRequestRejectsOutOfCarrierRangeSeed(t *testing.T) {
	for _, seed := range []int64{int64(math.MinInt32) - 1, int64(math.MaxInt32) + 1} {
		got, err := normalizeLocalImageRequest(&runtimev1.ImageGenerateScenarioSpec{
			Prompt: "image", Seed: testInt64(seed),
		}, nil)
		if got != nil {
			t.Fatalf("seed %d returned request %+v", seed, got)
		}
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
			t.Fatalf("seed %d error=%v code=%v reason=%v present=%v", seed, err, statusCode(err), reason, ok)
		}
	}
}

func TestNormalizeLocalImageRequestRejectsInvalidAIConfigImageOptions(t *testing.T) {
	for _, test := range []struct {
		name     string
		defaults map[string]any
	}{
		{name: "count", defaults: map[string]any{"n": 5.0}},
		{name: "size", defaults: map[string]any{"size": "65x64"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			defaults, err := structpb.NewStruct(test.defaults)
			if err != nil {
				t.Fatal(err)
			}
			got, err := normalizeLocalImageRequest(&runtimev1.ImageGenerateScenarioSpec{Prompt: "image"}, defaults)
			if got != nil {
				t.Fatalf("invalid defaults returned request: %+v", got)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_INVALID || statusCode(err) != codes.InvalidArgument {
				t.Fatalf("defaults error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
			}
		})
	}
}

func TestLocalImageRejectsNonDefaultResponseFormatBeforeHostDispatch(t *testing.T) {
	svc := newTestService(nil)
	host := &localImageHostStub{}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-format")})
	svc.SetLocalImageExecutionHost(host)
	request := localImageJobRequestForTest(1)
	request.Spec.GetImageGenerate().ResponseFormat = "url"
	_, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), request)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("response_format error=%v reason=%v present=%v", err, reason, ok)
	}
	host.mu.Lock()
	defer host.mu.Unlock()
	if len(host.plans) != 0 {
		t.Fatalf("unsupported response_format dispatched %d plans", len(host.plans))
	}
}

func TestLocalImageRejectsUnsupportedCountAndSizeBeforeHostDispatch(t *testing.T) {
	tests := []struct {
		name string
		n    *int32
		size string
	}{
		{name: "explicit zero count", n: testInt32(0), size: "64x64"},
		{name: "count above local maximum", n: testInt32(5), size: "64x64"},
		{name: "invalid size", n: testInt32(1), size: "65x64"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			host := &localImageHostStub{}
			svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-option-"+test.name)})
			svc.SetLocalImageExecutionHost(host)
			request := localImageJobRequestForTest(1)
			request.Spec.GetImageGenerate().N = test.n
			request.Spec.GetImageGenerate().Size = test.size

			response, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), request)
			if response != nil {
				t.Fatalf("unsupported image option returned response: %+v", response)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
				t.Fatalf("option error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
			}
			host.mu.Lock()
			planCount := len(host.plans)
			host.mu.Unlock()
			if planCount != 0 {
				t.Fatalf("unsupported image option dispatched %d plans", planCount)
			}
		})
	}
}

func TestLocalImageJobRejectsUnsupportedCountAndSizeBeforePublicationOrHost(t *testing.T) {
	tests := []struct {
		name string
		n    *int32
		size string
	}{
		{name: "explicit zero count", n: testInt32(0), size: "64x64"},
		{name: "count above local maximum", n: testInt32(5), size: "64x64"},
		{name: "invalid size", n: testInt32(1), size: "65x64"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			host := &localImageHostStub{}
			svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-job-option-"+test.name)})
			svc.SetLocalImageExecutionHost(host)
			request := localImageJobRequestForTest(1)
			request.Spec.GetImageGenerate().N = test.n
			request.Spec.GetImageGenerate().Size = test.size

			response, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), request)
			if response != nil {
				t.Fatalf("unsupported image option returned Job: %+v", response)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
				t.Fatalf("option error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
			}
			host.mu.Lock()
			planCount := len(host.plans)
			host.mu.Unlock()
			svc.scenarioJobs.mu.RLock()
			jobCount := len(svc.scenarioJobs.jobs)
			svc.scenarioJobs.mu.RUnlock()
			if planCount != 0 || jobCount != 0 {
				t.Fatalf("unsupported image option created work: host_plans=%d jobs=%d", planCount, jobCount)
			}
		})
	}
}

func TestLocalImageJobRejectsOutOfRangeTimeoutBeforeCaptureOrHost(t *testing.T) {
	tests := []struct {
		name    string
		timeout time.Duration
	}{
		{name: "below minimum", timeout: 10 * time.Minute},
		{name: "above maximum", timeout: 90 * time.Minute},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			resolver := &mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-timeout-"+test.name)}
			host := &localImageHostStub{}
			svc.SetLocalExecutionResolver(resolver)
			svc.SetLocalImageExecutionHost(host)
			request := localImageJobRequestForTest(1)
			request.Head.TimeoutMs = int32(test.timeout.Milliseconds())

			response, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), request)
			if err == nil {
				t.Fatalf("out-of-range timeout accepted Job: %+v", response)
			}
			if response != nil {
				t.Fatalf("out-of-range timeout returned a partial Job: %+v", response)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
				t.Fatalf("timeout error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
			}
			if resolver.callCount() != 0 {
				t.Fatalf("out-of-range timeout reached Local Image capture %d times", resolver.callCount())
			}
			host.mu.Lock()
			planCount := len(host.plans)
			host.mu.Unlock()
			svc.scenarioJobs.mu.RLock()
			jobCount := len(svc.scenarioJobs.jobs)
			svc.scenarioJobs.mu.RUnlock()
			if planCount != 0 || jobCount != 0 {
				t.Fatalf("out-of-range timeout created work: host_plans=%d jobs=%d", planCount, jobCount)
			}
		})
	}
}

func TestLocalImageJobRejectsOutOfCarrierRangeSeedBeforePublicationOrHost(t *testing.T) {
	for _, seed := range []int64{int64(math.MinInt32) - 1, int64(math.MaxInt32) + 1} {
		t.Run(fmt.Sprintf("seed_%d", seed), func(t *testing.T) {
			svc := newTestService(nil)
			host := &localImageHostStub{}
			svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, fmt.Sprintf("image-seed-%d", seed))})
			svc.SetLocalImageExecutionHost(host)
			request := localImageJobRequestForTest(1)
			request.Spec.GetImageGenerate().Seed = testInt64(seed)

			response, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), request)
			if err == nil {
				t.Fatalf("out-of-carrier seed accepted Job: %+v", response)
			}
			if response != nil {
				t.Fatalf("out-of-carrier seed returned partial Job: %+v", response)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
				t.Fatalf("seed error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
			}
			host.mu.Lock()
			planCount := len(host.plans)
			host.mu.Unlock()
			svc.scenarioJobs.mu.RLock()
			jobCount := len(svc.scenarioJobs.jobs)
			svc.scenarioJobs.mu.RUnlock()
			if planCount != 0 || jobCount != 0 {
				t.Fatalf("out-of-carrier seed created work: host_plans=%d jobs=%d", planCount, jobCount)
			}
		})
	}
}

func TestLocalImageWithoutSelectionFailsClosed(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{err: grpcerr.WithReasonCode(
		codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND,
	)})
	_, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), localImageJobRequestForTest(1))
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND {
		t.Fatalf("missing image selection = %v reason=%v ok=%v", err, reason, ok)
	}
}

func TestLocalImageSyncFailsClosedBeforeHostDispatch(t *testing.T) {
	svc := newTestService(nil)
	host := &localImageHostStub{}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-sync-rejected")})
	svc.SetLocalImageExecutionHost(host)
	response, err := svc.ExecuteScenario(localImageIntentContext(context.Background(), nil), localImageExecuteRequestForTest(1))
	if response != nil {
		t.Fatalf("sync image request returned response: %+v", response)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("sync image rejection = %v reason=%v ok=%v", err, reason, ok)
	}
	host.mu.Lock()
	defer host.mu.Unlock()
	if len(host.plans) != 0 {
		t.Fatalf("sync image rejection dispatched %d plans", len(host.plans))
	}
}

func TestLocalImageJobStaysQueuedThenCommitsArtifactsIncrementallyFromImmutableCapture(t *testing.T) {
	svc := newTestService(nil)
	first := selectedImageExecutionForTest(t, "image-first")
	second := selectedImageExecutionForTest(t, "image-second")
	resolver := &mutableLocalExecutionResolver{projection: first}
	host := &localImageHostStub{
		entered: make(chan struct{}), allowStart: make(chan struct{}),
		firstCommitted: make(chan struct{}), allowSecond: make(chan struct{}),
	}
	svc.SetLocalExecutionResolver(resolver)
	svc.SetLocalImageExecutionHost(host)
	defaults, err := structpb.NewStruct(map[string]any{"size": "64x64", "n": 2.0, "seed": 19.0})
	if err != nil {
		t.Fatal(err)
	}
	principal := protectedprincipal.New(
		"app.local", "desktop-account-product.v1", "desktop-account-product.v1",
		&runtimev1.AccountProjection{AccountId: "account-a", RealmEnvironmentId: "realm-a"},
		1, [32]byte{1}, make(chan struct{}),
	)
	ownerCtx := protectedprincipal.With(context.Background(), principal)
	initialIntent := localAppAIConfigIntent(capabilitydriver.StableDiffusionCapabilityContract)
	initialIntent.Defaults = defaults
	if _, err := svc.OverwriteAppAIConfig(ownerCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.local", initialIntent)}); err != nil {
		t.Fatalf("OverwriteAppAIConfig(initial): %v", err)
	}
	request := localImageJobRequestForTest(0)
	request.Spec.GetImageGenerate().N = nil
	request.Spec.GetImageGenerate().Size = ""
	request.Spec.GetImageGenerate().Seed = nil
	response, err := svc.SubmitScenarioJob(ownerCtx, request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	jobID := response.GetJob().GetJobId()
	select {
	case <-host.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("job did not enter the image Host")
	}
	queued := waitForImageJobStatus(t, svc, jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)
	if len(queued.GetArtifacts()) != 0 || queued.GetProgressPercent() != 0 {
		t.Fatalf("queued job exposed execution work: %+v", queued)
	}
	resolver.set(second)
	replacementDefaults, _ := structpb.NewStruct(map[string]any{"size": "128x128", "n": 1.0, "seed": 99.0})
	replacementIntent := localAppAIConfigIntent(capabilitydriver.StableDiffusionCapabilityContract)
	replacementIntent.Defaults = replacementDefaults
	if _, err := svc.OverwriteAppAIConfig(ownerCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.local", replacementIntent)}); err != nil {
		t.Fatalf("OverwriteAppAIConfig(replacement): %v", err)
	}
	close(host.allowStart)
	select {
	case <-host.firstCommitted:
	case <-time.After(2 * time.Second):
		t.Fatal("first image artifact was not committed")
	}
	running := waitForImageArtifactCount(t, svc, jobID, 1)
	if running.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || running.GetProgressPercent() >= 100 {
		t.Fatalf("incremental job snapshot = %+v", running)
	}
	if !scenarioJobEventsContainArtifactCount(svc, jobID, 1) {
		t.Fatal("running event backlog did not enumerate the first produced artifact")
	}
	close(host.allowSecond)
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, jobID)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(terminal.GetArtifacts()) != 2 || terminal.GetProgressPercent() != 100 {
		t.Fatalf("terminal image job = %+v", terminal)
	}
	if terminal.GetArtifacts()[0].GetArtifactId() == terminal.GetArtifacts()[1].GetArtifactId() {
		t.Fatal("image artifacts did not receive distinct identities")
	}
	firstArtifact := terminal.GetArtifacts()[0]
	record, ok := svc.runtimeArtifacts.Get(firstArtifact.GetArtifactId())
	if !ok || record.ProducerJobID != jobID || record.Owner == nil || record.Owner.SubjectUserID != "account-a" || record.Owner.AppID != "app.local" {
		t.Fatalf("local image artifact custody = %+v present=%v", record, ok)
	}
	if got := firstArtifact.GetMetadata().GetFields()["producer_job_id"].GetStringValue(); got != jobID {
		t.Fatalf("local image producer_job_id = %q, want %q", got, jobID)
	}
	artifactService := runtimeartifact.New(svc.runtimeArtifacts, nil)
	read, err := artifactService.ReadArtifactBytes(ownerCtx, &runtimev1.ReadArtifactBytesRequest{ArtifactId: firstArtifact.GetArtifactId()})
	if err != nil || len(read.GetBytes()) == 0 {
		t.Fatalf("owner-authorized local image artifact read = %+v error=%v", read, err)
	}
	host.mu.Lock()
	captured := host.plans[0]
	host.mu.Unlock()
	width, height := captured.Size()
	if captured.MainModelPath() != first.ExactBindings[0].AbsolutePath || captured.MainModelPath() == second.ExactBindings[0].AbsolutePath ||
		captured.ImageCount() != 2 || width != 64 || height != 64 || captured.Seed() != 19 {
		t.Fatalf("background execution did not use immutable capture: path=%q count=%d size=%dx%d seed=%d", captured.MainModelPath(), captured.ImageCount(), width, height, captured.Seed())
	}
}

func TestLocalImageJobSchedulerLeaseCoversHostLifetime(t *testing.T) {
	svc := newTestService(nil)
	svc.scheduler = scheduler.New(scheduler.Config{GlobalConcurrency: 1, PerAppConcurrency: 1})
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-scheduler")})
	host := &localImageHostStub{
		entered: make(chan struct{}), allowStart: make(chan struct{}),
		firstCommitted: make(chan struct{}), allowSecond: make(chan struct{}),
	}
	svc.SetLocalImageExecutionHost(host)
	ctx := localImageIntentContext(context.Background(), nil)

	first, err := svc.SubmitScenarioJob(ctx, localImageJobRequestForTest(1))
	if err != nil {
		t.Fatalf("SubmitScenarioJob(first): %v", err)
	}
	select {
	case <-host.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first job did not enter the image Host")
	}

	second, err := svc.SubmitScenarioJob(ctx, localImageJobRequestForTest(1))
	if err != nil {
		t.Fatalf("SubmitScenarioJob(second): %v", err)
	}
	waitForImageJobStatus(t, svc, second.GetJob().GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)

	close(host.allowStart)
	select {
	case <-host.firstCommitted:
	case <-time.After(2 * time.Second):
		t.Fatal("first image Host execution did not start")
	}
	probeCtx, probeCancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer probeCancel()
	probeRelease, _, probeErr := svc.scheduler.Acquire(probeCtx, "other.app")
	if probeErr == nil {
		probeRelease()
		t.Fatal("scheduler lease was released before the active image Host execution completed")
	}
	close(host.allowSecond)
	if terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, first.GetJob().GetJobId()); terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("first image job terminal = %+v", terminal)
	}
	if terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, second.GetJob().GetJobId()); terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("second image job terminal = %+v", terminal)
	}
}

func TestLocalImageJobsPreserveAcceptedOrderAcrossSchedulerReadiness(t *testing.T) {
	svc := newTestService(nil)
	svc.scheduler = scheduler.New(scheduler.Config{GlobalConcurrency: 3, PerAppConcurrency: 1})
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-accepted-order")})
	host := &localImageHostStub{entered: make(chan struct{})}
	svc.SetLocalImageExecutionHost(host)

	blockerRelease, _, err := svc.scheduler.Acquire(context.Background(), "app.image.first")
	if err != nil {
		t.Fatalf("acquire first-app blocker: %v", err)
	}
	released := false
	t.Cleanup(func() {
		if !released {
			blockerRelease()
		}
	})

	firstRequest := localImageJobRequestForTest(1)
	firstRequest.Head.AppId = "app.image.first"
	firstRequest.GetSpec().GetImageGenerate().Prompt = "accepted-first-image"
	first, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), firstRequest)
	if err != nil {
		t.Fatalf("SubmitScenarioJob(first): %v", err)
	}
	waitForImageJobStatus(t, svc, first.GetJob().GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)
	select {
	case <-host.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first accepted image job did not enter the Host before scheduler admission")
	}

	secondRequest := localImageJobRequestForTest(1)
	secondRequest.Head.AppId = "app.image.second"
	secondRequest.GetSpec().GetImageGenerate().Prompt = "accepted-second-image"
	second, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), secondRequest)
	if err != nil {
		t.Fatalf("SubmitScenarioJob(second): %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	host.mu.Lock()
	queuedPlans := append([]*capabilitydriver.ImageInvocationPlan(nil), host.plans...)
	host.mu.Unlock()
	if len(queuedPlans) != 1 || queuedPlans[0].Prompt() != "accepted-first-image" {
		t.Fatalf("image Host admission before first scheduler lease = %v", func() []string {
			out := make([]string, 0, len(queuedPlans))
			for _, plan := range queuedPlans {
				out = append(out, plan.Prompt())
			}
			return out
		}())
	}

	blockerRelease()
	released = true
	for _, response := range []*runtimev1.SubmitScenarioJobResponse{first, second} {
		if terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId()); terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			t.Fatalf("image job terminal = %+v", terminal)
		}
	}
	host.mu.Lock()
	plans := append([]*capabilitydriver.ImageInvocationPlan(nil), host.plans...)
	host.mu.Unlock()
	if len(plans) != 2 || plans[0].Prompt() != "accepted-first-image" || plans[1].Prompt() != "accepted-second-image" {
		t.Fatalf("image Host order = %v", func() []string {
			out := make([]string, 0, len(plans))
			for _, plan := range plans {
				out = append(out, plan.Prompt())
			}
			return out
		}())
	}
}

func TestLocalImageHostWaitDoesNotBlockLocalVideoSchedulerAdmission(t *testing.T) {
	svc := newTestService(nil)
	svc.scheduler = scheduler.New(scheduler.Config{GlobalConcurrency: 2, PerAppConcurrency: 2})
	svc.SetLocalExecutionResolver(&capabilityLocalExecutionResolver{selections: map[string]*localexecution.SelectedLocalExecution{
		capabilitydriver.StableDiffusionCapabilityContract:      selectedImageExecutionForTest(t, "image-host-wait"),
		capabilitydriver.StableDiffusionVideoCapabilityContract: selectedVideoExecutionForTest(t, "video-cross-media"),
	}})
	imageHost := newSerialBlockingLocalImageHostStub()
	videoHost := &localVideoHostStub{entered: make(chan struct{})}
	svc.SetLocalImageExecutionHost(imageHost)
	svc.SetLocalVideoExecutionHost(videoHost)
	svc.SetLocalVideoMediaPipeline(&videoMediaPipelineStub{})

	firstImage, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), localImageJobRequestForTest(1))
	if err != nil {
		t.Fatalf("SubmitScenarioJob(first image): %v", err)
	}
	select {
	case <-imageHost.firstEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("first image did not enter the serial Host")
	}
	secondImage, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), localImageJobRequestForTest(1))
	if err != nil {
		t.Fatalf("SubmitScenarioJob(second image): %v", err)
	}
	waitForImageJobStatus(t, svc, secondImage.GetJob().GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)
	// Give the second worker enough time to expose an incorrect scheduler-first
	// acquisition by blocking inside the serial Host.
	time.Sleep(50 * time.Millisecond)

	videoRequest := localVideoJobRequestForTest(64, 64, 5)
	videoRequest.Head.AppId = "app.video.cross-media"
	video, err := svc.SubmitScenarioJob(localVideoIntentContext(context.Background()), videoRequest)
	if err != nil {
		t.Fatalf("SubmitScenarioJob(video): %v", err)
	}
	select {
	case <-videoHost.entered:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("queued image Host wait consumed the scheduler slot needed by local video")
	}

	close(imageHost.releaseFirst)
	for _, response := range []*runtimev1.SubmitScenarioJobResponse{firstImage, secondImage, video} {
		if terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId()); terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			t.Fatalf("cross-media job terminal = %+v", terminal)
		}
	}
}

func TestLocalImageJobSchedulerQueuedCancellationSkipsHost(t *testing.T) {
	svc := newTestService(nil)
	svc.scheduler = scheduler.New(scheduler.Config{GlobalConcurrency: 1, PerAppConcurrency: 1})
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-scheduler-cancel")})
	host := &localImageHostStub{entered: make(chan struct{}), allowStart: make(chan struct{})}
	svc.SetLocalImageExecutionHost(host)
	ctx := localImageIntentContext(context.Background(), nil)

	first, err := svc.SubmitScenarioJob(ctx, localImageJobRequestForTest(1))
	if err != nil {
		t.Fatalf("SubmitScenarioJob(first): %v", err)
	}
	select {
	case <-host.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first job did not enter the image Host")
	}
	second, err := svc.SubmitScenarioJob(ctx, localImageJobRequestForTest(1))
	if err != nil {
		t.Fatalf("SubmitScenarioJob(second): %v", err)
	}
	secondID := second.GetJob().GetJobId()
	waitForImageJobStatus(t, svc, secondID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)
	cancelCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app.local"))
	if _, err := svc.CancelScenarioJob(cancelCtx, &runtimev1.CancelScenarioJobRequest{JobId: secondID, Reason: "owner canceled while queued"}); err != nil {
		t.Fatalf("CancelScenarioJob(second): %v", err)
	}
	if terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, secondID); terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("queued second image job terminal = %+v", terminal)
	}
	host.mu.Lock()
	enteredPlans := len(host.plans)
	host.mu.Unlock()
	if enteredPlans != 1 {
		t.Fatalf("scheduler-queued canceled job entered Host: plans=%d", enteredPlans)
	}

	close(host.allowStart)
	if terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, first.GetJob().GetJobId()); terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("first image job terminal = %+v", terminal)
	}
}

func TestLocalImageArtifactAttachFailureDeletesExactCandidate(t *testing.T) {
	svc := newTestService(nil)
	artifact := &runtimev1.ScenarioArtifact{ArtifactId: "candidate-local-image", MimeType: "image/png", Bytes: serviceTestPNGBytes()}
	_, err := svc.storeAndAttachRuntimeJobArtifact(context.Background(),
		"job-attach-failure",
		&runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "account-a"},
		artifact,
		func(*runtimev1.ScenarioArtifact) bool { return false },
	)
	if err == nil {
		t.Fatal("storeAndAttachRuntimeJobArtifact accepted failed attach")
	}
	if _, ok := svc.runtimeArtifacts.Get(artifact.GetArtifactId()); ok {
		t.Fatal("failed attach retained candidate Runtime artifact")
	}

	const existingID = "existing-local-image"
	if err := svc.runtimeArtifacts.Put(existingID, runtimeartifact.ArtifactRecord{Bytes: []byte("existing"), MimeType: "image/png"}); err != nil {
		t.Fatalf("seed existing artifact: %v", err)
	}
	_, err = svc.storeAndAttachRuntimeJobArtifact(context.Background(),
		"job-attach-collision",
		&runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "account-a"},
		&runtimev1.ScenarioArtifact{ArtifactId: existingID, MimeType: "image/png", Bytes: []byte("replacement")},
		func(*runtimev1.ScenarioArtifact) bool { return false },
	)
	if err == nil {
		t.Fatal("storeAndAttachRuntimeJobArtifact accepted an existing candidate id")
	}
	if existing, ok := svc.runtimeArtifacts.Get(existingID); !ok || string(existing.Bytes) != "existing" {
		t.Fatalf("candidate compensation touched pre-existing artifact: %+v present=%v", existing, ok)
	}
}

func TestLocalImageJobPartialFailurePreservesProducedArtifactAndTypedFailure(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-partial")})
	host := &localImageHostStub{failBeforeIndex: 2, failure: errors.New("sampler exploded")}
	svc.SetLocalImageExecutionHost(host)
	response, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), localImageJobRequestForTest(2))
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	job := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
		job.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED || len(job.GetArtifacts()) != 1 || job.GetProgressPercent() >= 100 {
		t.Fatalf("partial failure job = %+v", job)
	}
	artifactCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app.local"))
	artifactsResponse, err := svc.GetScenarioArtifacts(artifactCtx, &runtimev1.GetScenarioArtifactsRequest{JobId: job.GetJobId()})
	if err != nil || len(artifactsResponse.GetArtifacts()) != 1 || len(artifactsResponse.GetArtifacts()[0].GetBytes()) != 0 || artifactsResponse.GetArtifacts()[0].GetSizeBytes() == 0 {
		t.Fatalf("partial artifact retrieval = response=%+v error=%v", artifactsResponse, err)
	}
	if record, ok := svc.runtimeArtifacts.Get(artifactsResponse.GetArtifacts()[0].GetArtifactId()); !ok || len(record.Bytes) == 0 {
		t.Fatalf("partial artifact custody = %+v present=%v", record, ok)
	}
}

func TestLocalImageJobQueuedCancellationReachesHost(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-cancel")})
	host := &localImageHostStub{entered: make(chan struct{}), allowStart: make(chan struct{}), cancelObserved: make(chan struct{}), allowCancelExit: make(chan struct{})}
	svc.SetLocalImageExecutionHost(host)
	ctx := localImageIntentContext(context.Background(), nil)
	response, err := svc.SubmitScenarioJob(ctx, localImageJobRequestForTest(1))
	if err != nil {
		t.Fatal(err)
	}
	<-host.entered
	cancelCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app.local"))
	canceled, err := svc.CancelScenarioJob(cancelCtx, &runtimev1.CancelScenarioJobRequest{JobId: response.GetJob().GetJobId(), Reason: "owner canceled"})
	if err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}
	if canceled.GetJob().GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("cancel response became terminal before Host stop = %+v", canceled)
	}
	select {
	case <-host.cancelObserved:
	case <-time.After(2 * time.Second):
		t.Fatal("job cancellation did not reach image Host context")
	}
	if current, _ := svc.scenarioJobs.get(response.GetJob().GetJobId()); current.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("queued job published CANCELED before Host exit: %+v", current)
	}
	close(host.allowCancelExit)
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("queued cancel terminal = %+v", terminal)
	}
}

func TestLocalImageJobRunningCancellationPreservesCommittedArtifact(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-running-cancel")})
	host := &localImageHostStub{firstCommitted: make(chan struct{}), allowSecond: make(chan struct{}), cancelObserved: make(chan struct{}), allowCancelExit: make(chan struct{})}
	svc.SetLocalImageExecutionHost(host)
	response, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), localImageJobRequestForTest(2))
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-host.firstCommitted:
	case <-time.After(2 * time.Second):
		t.Fatal("running image job did not commit its first artifact")
	}
	jobID := response.GetJob().GetJobId()
	running := waitForImageArtifactCount(t, svc, jobID, 1)
	if running.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
		t.Fatalf("pre-cancel job = %+v", running)
	}
	cancelCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app.local"))
	canceled, err := svc.CancelScenarioJob(cancelCtx, &runtimev1.CancelScenarioJobRequest{JobId: jobID, Reason: "stop running image"})
	if err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}
	if canceled.GetJob().GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || len(canceled.GetJob().GetArtifacts()) != 1 {
		t.Fatalf("running cancel response = %+v", canceled)
	}
	select {
	case <-host.cancelObserved:
	case <-time.After(2 * time.Second):
		t.Fatal("running cancellation did not reach Host context")
	}
	if current, _ := svc.scenarioJobs.get(jobID); current.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("running job published CANCELED before Host exit: %+v", current)
	}
	close(host.allowCancelExit)
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, jobID)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || len(terminal.GetArtifacts()) != 1 {
		t.Fatalf("running cancel terminal = %+v", terminal)
	}
}

func TestLocalImageRequestFeatureMismatchFailsBeforeHost(t *testing.T) {
	svc := newTestService(nil)
	selected := selectedImageExecutionForTest(t, "image-feature")
	host := &localImageHostStub{}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selected})
	svc.SetLocalImageExecutionHost(host)
	request := localImageJobRequestForTest(1)
	request.Spec.GetImageGenerate().ReferenceImages = []string{"artifact-input"}
	_, err := svc.SubmitScenarioJob(localImageIntentContext(context.Background(), nil), request)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("feature mismatch = %v reason=%v ok=%v", err, reason, ok)
	}
	host.mu.Lock()
	calls := len(host.plans)
	host.mu.Unlock()
	if calls != 0 {
		t.Fatalf("feature mismatch reached image Host %d times", calls)
	}
}

func TestLocalVideoExecutionWithoutSelectionFailsClosed(t *testing.T) {
	svc := newTestService(nil)
	ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
		CapabilityContract: scenarioTargetCapability(runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE),
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	_, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "app.local"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
			Mode:    runtimev1.VideoMode_VIDEO_MODE_T2V,
			Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Text: "clip"}},
			Options: &runtimev1.VideoGenerationOptions{},
		}}},
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND {
		t.Fatalf("local video no-selection error = %v reason=%v ok=%v", err, reason, ok)
	}
}

func selectedImageExecutionForTest(t *testing.T, configurationID string) *localexecution.SelectedLocalExecution {
	t.Helper()
	portable, err := structpb.NewStruct(map[string]any{
		"modelFamily":      "z-image",
		"executionOptions": map[string]any{"steps": 2.0, "cfgScale": 1.0, "width": 64.0, "height": 64.0, "seed": 7.0, "threads": 1.0},
	})
	if err != nil {
		t.Fatal(err)
	}
	driver := capabilitydriver.StableDiffusionImageDriver{}
	requirements, reason := driver.Interpret(capabilitydriver.InterpretInput{PortableConfig: portable})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("Interpret: %v", reason)
	}
	root := t.TempDir()
	bindings := make([]localexecution.ExactBinding, 0, len(requirements))
	for index, requirement := range requirements {
		path := filepath.Join(root, fmt.Sprintf("%s-%d.bin", configurationID, index))
		payload := []byte(configurationID + requirement.GetRequirementId())
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		digestBytes := sha256.Sum256(payload)
		digest := hex.EncodeToString(digestBytes[:])
		bindings = append(bindings, localexecution.ExactBinding{
			RequirementID: requirement.GetRequirementId(), LocalAssetID: fmt.Sprintf("%s-asset-%d", configurationID, index),
			AbsolutePath: path, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
		})
	}
	return &localexecution.SelectedLocalExecution{
		ConfigurationID: configurationID, CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		DisplayName: configurationID, DriverIdentity: (&capabilitydriver.Identity{
			ImplementationID: capabilitydriver.StableDiffusionImplementationID,
			DriverID:         capabilitydriver.StableDiffusionDriverID, DriverDialect: capabilitydriver.StableDiffusionDriverDialect,
		}).Proto(),
		PortableConfig: portable, Requirements: requirements, ExactBindings: bindings, Configured: true,
	}
}

func localImageIntentContext(parent context.Context, defaults *structpb.Struct) context.Context {
	return executionintent.WithIntent(parent, executionintent.Intent{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		Defaults:           defaults, Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
}

func localImageExecuteRequestForTest(count int32) *runtimev1.ExecuteScenarioRequest {
	return &runtimev1.ExecuteScenarioRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: "a copper robot", N: testInt32(count), Size: "64x64", Seed: testInt64(7),
		}}},
	}
}

func localImageJobRequestForTest(count int32) *runtimev1.SubmitScenarioJobRequest {
	execute := localImageExecuteRequestForTest(count)
	return &runtimev1.SubmitScenarioJobRequest{
		Head: execute.GetHead(), ScenarioType: execute.GetScenarioType(), ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, Spec: execute.GetSpec(),
	}
}

func waitForImageJobStatus(t *testing.T, svc *Service, jobID string, status runtimev1.ScenarioJobStatus) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := svc.scenarioJobs.get(jobID); ok && job.GetStatus() == status {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("job %s did not reach %s", jobID, status)
	return nil
}

func waitForImageArtifactCount(t *testing.T, svc *Service, jobID string, count int) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := svc.scenarioJobs.get(jobID); ok && len(job.GetArtifacts()) == count {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("job %s did not expose %d artifacts", jobID, count)
	return nil
}

func scenarioJobEventsContainArtifactCount(svc *Service, jobID string, count int) bool {
	svc.scenarioJobs.mu.RLock()
	defer svc.scenarioJobs.mu.RUnlock()
	record := svc.scenarioJobs.jobs[jobID]
	if record == nil {
		return false
	}
	for _, event := range record.events {
		if event.GetEventType() == runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING && len(event.GetJob().GetArtifacts()) == count {
			return true
		}
	}
	return false
}

func closeOnce(ch chan struct{}) {
	if ch == nil {
		return
	}
	select {
	case <-ch:
	default:
		close(ch)
	}
}

func serviceTestPNGBytes() []byte {
	return []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0, 'I', 'H', 'D', 'R'}
}
