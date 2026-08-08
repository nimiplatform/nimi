package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
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

func (h *localImageHostStub) ExecuteImage(ctx context.Context, plan *capabilitydriver.ImageInvocationPlan, onArtifact localexecution.ImageArtifactFunc, progress localexecution.ImageProgressFunc) (localexecution.ImageResult, error) {
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

func TestLocalImageRejectsNonDefaultResponseFormatBeforeHostDispatch(t *testing.T) {
	svc := newTestService(nil)
	host := &localImageHostStub{}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-format")})
	svc.SetLocalImageExecutionHost(host)
	request := localImageExecuteRequestForTest(1)
	request.Spec.GetImageGenerate().ResponseFormat = "url"
	_, err := svc.ExecuteScenario(localImageIntentContext(context.Background(), nil), request)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("response_format error=%v reason=%v present=%v", err, reason, ok)
	}
	host.mu.Lock()
	defer host.mu.Unlock()
	if len(host.plans) != 0 {
		t.Fatalf("unsupported response_format dispatched %d plans", len(host.plans))
	}
}

func TestLocalImageWithoutSelectionFailsClosed(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{err: grpcerr.WithReasonCode(
		codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND,
	)})
	_, err := svc.ExecuteScenario(localImageIntentContext(context.Background(), nil), localImageExecuteRequestForTest(1))
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND {
		t.Fatalf("missing image selection = %v reason=%v ok=%v", err, reason, ok)
	}
}

func TestLocalImageSyncExecutesCapturedDriverPlan(t *testing.T) {
	svc := newTestService(nil)
	selected := selectedImageExecutionForTest(t, "image-sync")
	host := &localImageHostStub{}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selected})
	svc.SetLocalImageExecutionHost(host)
	response, err := svc.ExecuteScenario(localImageIntentContext(context.Background(), nil), localImageExecuteRequestForTest(1))
	if err != nil {
		t.Fatalf("ExecuteScenario: %v", err)
	}
	artifacts := response.GetOutput().GetImageGenerate().GetArtifacts()
	if response.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || response.GetModelResolved() != "image-sync" ||
		len(artifacts) != 1 || !strings.HasPrefix(artifacts[0].GetMimeType(), "image/png") || !reflect.DeepEqual(artifacts[0].GetBytes()[:8], serviceTestPNGBytes()[:8]) {
		t.Fatalf("local image response = %+v", response)
	}
	record, ok := svc.runtimeArtifacts.Get(artifacts[0].GetArtifactId())
	if !ok || record.ProducerJobID != "" || record.Owner == nil || record.Owner.SubjectUserID != "anonymous" || record.Owner.AppID != "app.local" {
		t.Fatalf("sync local image artifact custody = %+v present=%v", record, ok)
	}
	host.mu.Lock()
	plans := append([]*capabilitydriver.ImageInvocationPlan(nil), host.plans...)
	host.mu.Unlock()
	if len(plans) != 1 || plans[0].MainModelPath() != selected.ExactBindings[0].AbsolutePath {
		t.Fatalf("captured host plans = %+v", plans)
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

func TestLocalImageArtifactAttachFailureDeletesExactCandidate(t *testing.T) {
	svc := newTestService(nil)
	artifact := &runtimev1.ScenarioArtifact{ArtifactId: "candidate-local-image", MimeType: "image/png", Bytes: serviceTestPNGBytes()}
	_, err := svc.storeAndAttachRuntimeJobArtifact(
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
	_, err = svc.storeAndAttachRuntimeJobArtifact(
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

func TestLocalImageSyncMapsTypedHostFailuresWithoutFallback(t *testing.T) {
	tests := []struct {
		name   string
		kind   localexecution.FailureKind
		reason runtimev1.ReasonCode
	}{
		{name: "load", kind: localexecution.FailureLoad, reason: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED},
		{name: "inference", kind: localexecution.FailureInference, reason: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED},
		{name: "content", kind: localexecution.FailureContentMismatch, reason: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CONTENT_MISMATCH},
		{name: "process", kind: localexecution.FailureProcessCrash, reason: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_PROCESS_CRASHED},
		{name: "canceled", kind: localexecution.FailureCanceled, reason: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			selected := selectedImageExecutionForTest(t, "image-"+test.name)
			resolver := &mutableLocalExecutionResolver{projection: selected}
			host := &localImageHostStub{failBeforeIndex: 1, failureKind: test.kind, failure: errors.New(test.name)}
			svc.SetLocalExecutionResolver(resolver)
			svc.SetLocalImageExecutionHost(host)
			_, err := svc.ExecuteScenario(localImageIntentContext(context.Background(), nil), localImageExecuteRequestForTest(1))
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != test.reason {
				t.Fatalf("Host error = %v reason=%v ok=%v", err, reason, ok)
			}
			current, resolveErr := resolver.ResolveSelectedLocalExecution(capabilitydriver.StableDiffusionCapabilityContract)
			if resolveErr != nil || current.ConfigurationID != selected.ConfigurationID {
				t.Fatalf("failure mutated Local selection: %+v error=%v", current, resolveErr)
			}
		})
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
	if err != nil || len(artifactsResponse.GetArtifacts()) != 1 || len(artifactsResponse.GetArtifacts()[0].GetBytes()) == 0 {
		t.Fatalf("partial artifact retrieval = response=%+v error=%v", artifactsResponse, err)
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
	request := localImageExecuteRequestForTest(1)
	request.Spec.GetImageGenerate().ReferenceImages = []string{"artifact-input"}
	_, err := svc.ExecuteScenario(localImageIntentContext(context.Background(), nil), request)
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
