package ai

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
)

func TestExecuteScenarioRuntimeRestartFailsTypedAndTerminalizesCustody(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "restart-sync", "restart-sync.gguf")})
	host := &localTextHostStub{started: make(chan struct{}), release: make(chan struct{})}
	svc.SetLocalTextExecutionHost(host)

	shutdownCtx, shutdownSignal := rpcctx.WithShutdownSignal(localTextIntentContext(context.Background(), nil))
	requestCtx, cancel := context.WithCancel(shutdownCtx)
	result := make(chan error, 1)
	go func() {
		_, err := svc.ExecuteScenario(requestCtx, localTextExecuteRequestForTest())
		result <- err
	}()
	waitForRestartTestSignal(t, host.started, "synchronous execution did not start")
	svc.BeginRuntimeRestart()
	shutdownSignal.MarkServerShutdown()
	cancel()

	var err error
	select {
	case err = <-result:
	case <-time.After(3 * time.Second):
		t.Fatal("synchronous execution did not stop for Runtime restart")
	}
	assertRuntimeRestartExecutionError(t, err)
	job := onlyScenarioJobForRestartTest(t, svc)
	assertRuntimeRestartJob(t, job)
}

func TestStreamScenarioRuntimeRestartEmitsOneTypedTerminalFailure(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "restart-stream", "restart-stream.gguf")})
	host := &localTextHostStub{started: make(chan struct{}), release: make(chan struct{})}
	svc.SetLocalTextExecutionHost(host)

	shutdownCtx, shutdownSignal := rpcctx.WithShutdownSignal(localTextIntentContext(context.Background(), nil))
	requestCtx, cancel := context.WithCancel(shutdownCtx)
	executeRequest := localTextExecuteRequestForTest()
	stream := &mockScenarioEventStream{ctx: requestCtx}
	result := make(chan error, 1)
	go func() {
		result <- svc.StreamScenario(&runtimev1.StreamScenarioRequest{
			Head: executeRequest.GetHead(), ScenarioType: executeRequest.GetScenarioType(),
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, Spec: executeRequest.GetSpec(),
		}, stream)
	}()
	waitForRestartTestSignal(t, host.started, "stream execution did not start")
	svc.BeginRuntimeRestart()
	shutdownSignal.MarkServerShutdown()
	cancel()

	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("typed terminal stream failure returned transport error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("stream execution did not stop for Runtime restart")
	}
	if len(stream.events) < 2 {
		t.Fatalf("stream events = %v, want STARTED then FAILED", stream.events)
	}
	terminalCount := 0
	for index, event := range stream.events {
		switch event.GetEventType() {
		case runtimev1.StreamEventType_STREAM_EVENT_COMPLETED:
			t.Fatalf("restart stream fabricated completion at event %d", index)
		case runtimev1.StreamEventType_STREAM_EVENT_FAILED:
			terminalCount++
			failed := event.GetFailed()
			if failed.GetReasonCode() != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED {
				t.Fatalf("stream terminal reason = %v", failed.GetReasonCode())
			}
			assertRuntimeRestartInterruption(t, failed.GetInterruption())
			if index != len(stream.events)-1 {
				t.Fatalf("stream emitted %d events after terminal failure", len(stream.events)-index-1)
			}
		}
	}
	if terminalCount != 1 {
		t.Fatalf("stream terminal failure count = %d, want 1", terminalCount)
	}
	assertRuntimeRestartJob(t, onlyScenarioJobForRestartTest(t, svc))
}

func TestClientCancellationIsNotRuntimeRestartInterruption(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "client-cancel", "client-cancel.gguf")})
	host := &localTextHostStub{started: make(chan struct{}), release: make(chan struct{})}
	svc.SetLocalTextExecutionHost(host)
	requestCtx, cancel := context.WithCancel(localTextIntentContext(context.Background(), nil))
	result := make(chan error, 1)
	go func() {
		_, err := svc.ExecuteScenario(requestCtx, localTextExecuteRequestForTest())
		result <- err
	}()
	waitForRestartTestSignal(t, host.started, "synchronous execution did not start")
	cancel()
	select {
	case err := <-result:
		if reason, _ := grpcerr.ExtractReasonCode(err); reason == runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED || executionInterruptionFromError(err) != nil {
			t.Fatalf("client cancellation became Runtime restart interruption: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("client-canceled execution did not stop")
	}
	job := onlyScenarioJobForRestartTest(t, svc)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || job.GetInterruption() != nil {
		t.Fatalf("client-canceled Job = %#v", job)
	}
}

func TestScenarioJobInterruptionProjectionFailsClosedOnInconsistentShape(t *testing.T) {
	missingTyped := &runtimev1.ScenarioJob{
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		ReasonCode:   runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED,
		ReasonDetail: "Runtime restarted before execution completed",
	}
	if err := prepareFailedScenarioJobProjection(missingTyped); err == nil {
		t.Fatal("interrupted failure without typed disposition was accepted")
	}
	nonInterrupted := &runtimev1.ScenarioJob{
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		ReasonCode:   runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
		ReasonDetail: "provider request failed",
		Interruption: runtimeRestartExecutionInterruption(),
	}
	if err := prepareFailedScenarioJobProjection(nonInterrupted); err == nil {
		t.Fatal("non-interrupted failure with typed interruption was accepted")
	}
	canceled := &runtimev1.ScenarioJob{
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
		ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
		Interruption: runtimeRestartExecutionInterruption(),
	}
	if err := prepareFailedScenarioJobProjection(canceled); err == nil {
		t.Fatal("canceled Job with typed interruption was accepted")
	}
	canceled.Interruption = nil
	canceled.ReasonCode = runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED
	if err := prepareFailedScenarioJobProjection(canceled); err == nil {
		t.Fatal("canceled Job with interrupted reason was accepted")
	}
}

func waitForRestartTestSignal(t *testing.T, signal <-chan struct{}, failure string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(3 * time.Second):
		t.Fatal(failure)
	}
}

func onlyScenarioJobForRestartTest(t *testing.T, svc *Service) *runtimev1.ScenarioJob {
	t.Helper()
	svc.scenarioJobs.mu.RLock()
	defer svc.scenarioJobs.mu.RUnlock()
	if len(svc.scenarioJobs.jobs) != 1 {
		t.Fatalf("ScenarioJob count = %d, want 1", len(svc.scenarioJobs.jobs))
	}
	for _, record := range svc.scenarioJobs.jobs {
		return cloneScenarioJob(record.job)
	}
	return nil
}

func assertRuntimeRestartExecutionError(t *testing.T, err error) {
	t.Helper()
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED {
		t.Fatalf("restart error reason = %v, present=%v, err=%v", reason, ok, err)
	}
	assertRuntimeRestartInterruption(t, executionInterruptionFromError(err))
}

func assertRuntimeRestartJob(t *testing.T, job *runtimev1.ScenarioJob) {
	t.Helper()
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
		job.GetReasonCode() != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED {
		t.Fatalf("restart Job = %#v", job)
	}
	assertRuntimeRestartInterruption(t, job.GetInterruption())
}

func assertRuntimeRestartInterruption(t *testing.T, interruption *runtimev1.ExecutionInterruption) {
	t.Helper()
	if interruption == nil ||
		interruption.GetCause() != runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART ||
		interruption.GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_CALLER_MAY_RESUBMIT {
		t.Fatalf("Runtime restart interruption = %#v", interruption)
	}
}
