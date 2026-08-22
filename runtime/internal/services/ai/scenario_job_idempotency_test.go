package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/proto"
)

type concurrentCaptureLocalExecutionResolver struct {
	selection *localexecution.SelectedLocalExecution
	callers   int
	entered   chan struct{}
	release   chan struct{}
	mu        sync.Mutex
	calls     int
}

func newConcurrentCaptureLocalExecutionResolver(selection *localexecution.SelectedLocalExecution, callers int) *concurrentCaptureLocalExecutionResolver {
	return &concurrentCaptureLocalExecutionResolver{
		selection: selection,
		callers:   callers,
		entered:   make(chan struct{}),
		release:   make(chan struct{}),
	}
}

func (r *concurrentCaptureLocalExecutionResolver) ListLocalLoadouts(string, string, int) ([]localexecution.LoadoutOption, bool, error) {
	return nil, false, nil
}

func (r *concurrentCaptureLocalExecutionResolver) ResolveLocalExecution(contract string, _ string) (*localexecution.SelectedLocalExecution, error) {
	if r == nil || r.selection == nil || contract != r.selection.CapabilityContract {
		return nil, fmt.Errorf("no Local execution for %s", contract)
	}
	r.mu.Lock()
	r.calls++
	if r.calls == r.callers {
		close(r.entered)
	}
	r.mu.Unlock()
	select {
	case <-r.release:
		return cloneSelectedExecutionForTest(r.selection), nil
	case <-time.After(3 * time.Second):
		return nil, fmt.Errorf("concurrent Local execution captures did not rendezvous")
	}
}

func TestConcurrentLocalImageIdempotentSubmissionsUseOneJobAndWorker(t *testing.T) {
	const callers = 2
	svc := newTestService(nil)
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	svc.scenarioJobs = store
	resolver := newConcurrentCaptureLocalExecutionResolver(selectedImageExecutionForTest(t, "image-idempotent"), callers)
	host := &localImageHostStub{}
	svc.SetLocalExecutionResolver(resolver)
	svc.SetLocalImageExecutionHost(host)

	ctx := localImageIntentContext(context.Background(), nil)
	request := localImageJobRequestForTest(1)
	request.IdempotencyKey = "concurrent-local-image"
	responses, submitErrors, done := submitScenarioJobsConcurrently(svc, ctx, request, callers)
	select {
	case <-resolver.entered:
		close(resolver.release)
	case <-time.After(3 * time.Second):
		close(resolver.release)
		t.Fatal("Local image submissions did not reach concurrent capture")
	}
	<-done
	canonicalID := requireCanonicalConcurrentScenarioJobs(t, svc, responses, submitErrors)

	host.mu.Lock()
	executions := len(host.plans)
	host.mu.Unlock()
	if executions != 1 {
		t.Fatalf("Local image worker executions=%d, want 1", executions)
	}
	assertSingleDurableScenarioJobBinding(t, store, localStatePath, canonicalID)
}

func TestConcurrentCloudMediaIdempotentSubmissionsUseOneJobAndProviderCall(t *testing.T) {
	const callers = 16
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	secrets := installCustodyTrackingConnectorStore(t, &fixture)
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	fixture.service.scenarioJobs = store
	host := newControlledRemoteMediaHost(false)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.StableDiffusionCapabilityContract, fixture.targetRef)
	request := &runtimev1.SubmitScenarioJobRequest{
		Head:           &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType:   runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode:  runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		IdempotencyKey: "concurrent-cloud-media",
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{
			ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "one provider dispatch"},
		}},
	}
	responses, submitErrors, done := submitScenarioJobsConcurrently(fixture.service, ctx, request, callers)
	<-done
	close(host.release)
	canonicalID := requireCanonicalConcurrentScenarioJobs(t, fixture.service, responses, submitErrors)

	host.mu.Lock()
	executions := host.executions
	host.mu.Unlock()
	if executions != 1 {
		t.Fatalf("Cloud media provider executions=%d, want 1", executions)
	}
	assertSingleDurableScenarioJobBinding(t, store, localStatePath, canonicalID)
	assertOnlyLiveConnectorCredential(t, secrets, fixture.connectorID)
}

func TestConcurrentCloudVoiceIdempotentSubmissionsUseOnePrimaryJobAndProviderCall(t *testing.T) {
	const callers = 16
	var providerCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output":{"voice":"voice-concurrent"}}`))
	}))
	defer server.Close()
	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vd-2026-01-26", server.URL, Config{AllowLoopbackEndpoint: true})
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	fixture.service.scenarioJobs = store
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.VoiceCreateContract, fixture.targetRef)
	request := &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		IdempotencyKey: "concurrent-cloud-voice",
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			TargetModelId: "qwen3-tts-vd",
			Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{
				InstructionText: "warm narrator", PreviewText: "hello",
			}},
		}}},
	}
	responses, submitErrors, done := submitScenarioJobsConcurrently(fixture.service, ctx, request, callers)
	<-done
	canonicalID := requireCanonicalConcurrentScenarioJobs(t, fixture.service, responses, submitErrors)
	if providerCalls.Load() != 1 {
		t.Fatalf("Cloud voice provider calls=%d, want 1", providerCalls.Load())
	}
	assertSingleDurableScenarioJobBinding(t, store, localStatePath, canonicalID)
}

func submitScenarioJobsConcurrently(
	svc *Service,
	ctx context.Context,
	request *runtimev1.SubmitScenarioJobRequest,
	callers int,
) ([]*runtimev1.SubmitScenarioJobResponse, []error, <-chan struct{}) {
	responses := make([]*runtimev1.SubmitScenarioJobResponse, callers)
	errs := make([]error, callers)
	start := make(chan struct{})
	done := make(chan struct{})
	var wait sync.WaitGroup
	for index := 0; index < callers; index++ {
		index := index
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			cloned, _ := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
			responses[index], errs[index] = svc.SubmitScenarioJob(ctx, cloned)
		}()
	}
	go func() {
		wait.Wait()
		close(done)
	}()
	close(start)
	return responses, errs, done
}

func requireCanonicalConcurrentScenarioJobs(
	t *testing.T,
	svc *Service,
	responses []*runtimev1.SubmitScenarioJobResponse,
	errs []error,
) string {
	t.Helper()
	jobIDs := make(map[string]struct{})
	for index, err := range errs {
		if err != nil {
			t.Fatalf("concurrent submission %d: %v", index, err)
		}
		jobID := responses[index].GetJob().GetJobId()
		if jobID == "" {
			t.Fatalf("concurrent submission %d returned no Job ID", index)
		}
		jobIDs[jobID] = struct{}{}
	}
	for jobID := range jobIDs {
		terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, jobID)
		if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			t.Fatalf("concurrent Job %q terminal status=%s, want COMPLETED", jobID, terminal.GetStatus())
		}
	}
	if len(jobIDs) != 1 {
		t.Fatalf("concurrent submissions returned %d Job IDs, want 1: %v", len(jobIDs), jobIDs)
	}
	for jobID := range jobIDs {
		return jobID
	}
	return ""
}

func assertSingleDurableScenarioJobBinding(
	t *testing.T,
	store *scenarioJobStore,
	localStatePath string,
	canonicalID string,
) {
	t.Helper()
	store.mu.RLock()
	jobCount := len(store.jobs)
	bindings := make([]scenarioIdempotencyBinding, 0, len(store.idempotency))
	for _, binding := range store.idempotency {
		bindings = append(bindings, binding)
	}
	store.mu.RUnlock()
	if jobCount != 1 || len(bindings) != 1 || bindings[0].jobID != canonicalID {
		t.Fatalf("in-memory idempotency state: jobs=%d bindings=%v canonical=%q", jobCount, bindings, canonicalID)
	}

	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatalf("reopen durable ScenarioJob store: %v", err)
	}
	reopened.mu.RLock()
	durableJobCount := len(reopened.jobs)
	durableBindings := make([]scenarioIdempotencyBinding, 0, len(reopened.idempotency))
	for _, binding := range reopened.idempotency {
		durableBindings = append(durableBindings, binding)
	}
	reopened.mu.RUnlock()
	if durableJobCount != 1 || len(durableBindings) != 1 || durableBindings[0].jobID != canonicalID {
		t.Fatalf("durable idempotency state: jobs=%d bindings=%v canonical=%q", durableJobCount, durableBindings, canonicalID)
	}
}
