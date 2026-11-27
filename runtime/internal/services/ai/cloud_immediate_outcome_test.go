package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func setupManagedCloudTextOutcomeFixture(t *testing.T, handler http.HandlerFunc) (*managedCloudScenarioTestFixture, *runtimev1.ExecuteScenarioRequest, *runtimev1.StreamScenarioRequest) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{},
		AllowLoopbackEndpoint: true,
	})
	cloudTarget, _ := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      fixture.descriptor.GetProviderModelId(),
		"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
	})
	config := appAIConfig("app.cloud.outcome", &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate",
		Defaults:           mustCloudDefaults(t, map[string]any{"maxTokens": 32}),
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			ConnectorRef: fixture.connectorID,
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.text.openai",
				DriverId:         "nimi.runtime.driver.openai",
				DriverDialect:    "openai/chat-completions/v1",
			},
			ProviderModelTarget: cloudTarget,
		}},
	})
	if err := overwriteAIConfigStoreForTest(scenarioJobUserContext("app.cloud.outcome", "user-001"), fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatalf("store AIConfig: %v", err)
	}
	spec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "check cloud outcome"}},
	}}}
	execReq := &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.cloud.outcome", SubjectUserId: "user-001", TimeoutMs: 10_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec:          spec,
	}
	streamReq := &runtimev1.StreamScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.cloud.outcome", SubjectUserId: "user-001", TimeoutMs: 10_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec:          spec,
	}
	return &fixture, execReq, streamReq
}

func assertOutcomeUncertainError(t *testing.T, err error, wantCause runtimev1.ExecutionInterruptionCause, wantReason runtimev1.ReasonCode) {
	t.Helper()
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if wantReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != wantReason {
			t.Fatalf("reason = %v (present=%v), want %v; err=%v", reason, ok, wantReason, err)
		}
	}
	interruption := executionInterruptionFromError(err)
	if interruption == nil ||
		interruption.GetCause() != wantCause ||
		interruption.GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN {
		t.Fatalf("interruption = %#v, want cause=%v disposition=OUTCOME_UNCERTAIN; err=%v", interruption, wantCause, err)
	}
	meta, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok {
		t.Fatalf("expected structured ErrorInfo metadata on err=%v", err)
	}
	if meta["retryable"] != "false" {
		t.Fatalf("retryable metadata = %q, want false", meta["retryable"])
	}
	if meta["action_hint"] != outcomeUncertainActionHint {
		t.Fatalf("action_hint = %q, want %q", meta["action_hint"], outcomeUncertainActionHint)
	}
	msg := strings.ToLower(status.Convert(err).Message())
	if !strings.Contains(msg, "unknown") || !strings.Contains(msg, "charges") {
		t.Fatalf("error message must disclose unknown outcome and possible charges, got %q", msg)
	}
}

func TestCloudImmediateTrustworthySuccessAnd4xxRejectionAreNotOutcomeUncertain(t *testing.T) {
	var failAuth atomic.Bool
	var calls atomic.Int32
	fixture, execReq, _ := setupManagedCloudTextOutcomeFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		if failAuth.Load() {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid key"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"confirmed result"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}`))
	})
	ctx := scenarioJobUserContext("app.cloud.outcome", "user-001")
	resp, err := fixture.service.ExecuteScenario(ctx, execReq)
	if err != nil || outputText(resp.GetOutput()) != "confirmed result" {
		t.Fatalf("ExecuteScenario success = %+v, %v", resp, err)
	}
	if resp.GetUsage().GetInputTokens() != 3 || resp.GetUsage().GetOutputTokens() != 2 {
		t.Fatalf("unexpected usage: %+v", resp.GetUsage())
	}

	failAuth.Store(true)
	_, err = fixture.service.ExecuteScenario(ctx, execReq)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("401 reason = %v (present=%v), err=%v", reason, ok, err)
	}
	if interruption := executionInterruptionFromError(err); interruption != nil {
		t.Fatalf("trustworthy 4xx rejection must not carry interruption: %#v", interruption)
	}
	if calls.Load() != 2 {
		t.Fatalf("provider hits = %d, want 2", calls.Load())
	}
}

func TestCloudImmediateRuntimeRestartAfterDispatchReportsOutcomeUncertainWithoutReplay(t *testing.T) {
	dispatched := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32

	fixture, execReq, _ := setupManagedCloudTextOutcomeFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		select {
		case <-dispatched:
		default:
			close(dispatched)
		}
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})
	t.Cleanup(func() { close(release) })

	shutdownCtx, shutdownSignal := rpcctx.WithShutdownSignal(scenarioJobUserContext("app.cloud.outcome", "user-001"))
	requestCtx, cancel := context.WithCancel(shutdownCtx)
	result := make(chan error, 1)
	go func() {
		_, err := fixture.service.ExecuteScenario(requestCtx, execReq)
		result <- err
	}()
	waitForRestartTestSignal(t, dispatched, "cloud request did not reach provider")
	fixture.service.BeginRuntimeRestart()
	shutdownSignal.MarkServerShutdown()
	cancel()

	select {
	case err := <-result:
		assertOutcomeUncertainError(t, err, runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART, runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED)
	case <-time.After(3 * time.Second):
		t.Fatal("cloud restart execution did not stop")
	}
	if calls.Load() != 1 {
		t.Fatalf("provider hits = %d, want 1 (no auto-replay)", calls.Load())
	}
	job := onlyScenarioJobForRestartTest(t, fixture.service)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
		job.GetReasonCode() != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED ||
		job.GetInterruption().GetCause() != runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART ||
		job.GetInterruption().GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN {
		t.Fatalf("unexpected cloud restart job = %#v", job)
	}
}

func TestCloudImmediateRuntimeRunningTimeoutReportsActualCauseAndOutcomeUncertain(t *testing.T) {
	dispatched := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32

	fixture, execReq, _ := setupManagedCloudTextOutcomeFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		select {
		case <-dispatched:
		default:
			close(dispatched)
		}
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})
	t.Cleanup(func() { close(release) })
	execReq.Head.TimeoutMs = 150

	_, err := fixture.service.ExecuteScenario(scenarioJobUserContext("app.cloud.outcome", "user-001"), execReq)
	waitForRestartTestSignal(t, dispatched, "cloud request did not reach provider")
	assertOutcomeUncertainError(t, err, runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_UNSPECIFIED, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	if status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("grpc code = %v, want DeadlineExceeded", status.Code(err))
	}
	if calls.Load() != 1 {
		t.Fatalf("provider hits = %d, want 1 (no auto-replay)", calls.Load())
	}
}

func TestCloudImmediateRuntimeRunningCancelAfterDispatchPreservesCancelAndOutcomeUncertain(t *testing.T) {
	dispatched := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32

	fixture, execReq, _ := setupManagedCloudTextOutcomeFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		select {
		case <-dispatched:
		default:
			close(dispatched)
		}
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})
	t.Cleanup(func() { close(release) })

	requestCtx, cancel := context.WithCancel(scenarioJobUserContext("app.cloud.outcome", "user-001"))
	result := make(chan error, 1)
	go func() {
		_, err := fixture.service.ExecuteScenario(requestCtx, execReq)
		result <- err
	}()
	waitForRestartTestSignal(t, dispatched, "cloud request did not reach provider")
	cancel()

	select {
	case err := <-result:
		assertOutcomeUncertainError(t, err, runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_UNSPECIFIED, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED)
		if status.Code(err) != codes.Canceled {
			t.Fatalf("grpc code = %v, want Canceled", status.Code(err))
		}
		if reason, _ := grpcerr.ExtractReasonCode(err); reason == runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED {
			t.Fatalf("client cancel must not fabricate AI_EXECUTION_INTERRUPTED: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("canceled cloud execution did not stop")
	}
	if calls.Load() != 1 {
		t.Fatalf("provider hits = %d, want 1 (no auto-replay)", calls.Load())
	}
}

func TestCloudStreamPartialDropAndRestartReportOutcomeUncertainWithoutFabricatedCompletion(t *testing.T) {
	var calls atomic.Int32
	fixture, _, streamReq := setupManagedCloudTextOutcomeFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"partial token \"}}]}\n\n"))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		// Abruptly close connection without [DONE] or finish_reason!
		if hj, ok := w.(http.Hijacker); ok {
			if conn, _, err := hj.Hijack(); err == nil {
				_ = conn.Close()
			}
		}
	})

	stream := &mockScenarioEventStream{ctx: scenarioJobUserContext("app.cloud.outcome", "user-001")}
	err := fixture.service.StreamScenario(streamReq, stream)
	if err != nil {
		t.Fatalf("partial stream failure on open client channel should emit terminal FAILED event, got err=%v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("provider hits = %d, want 1", calls.Load())
	}
	var failed *runtimev1.ScenarioStreamFailed
	for i, ev := range stream.events {
		if ev.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
			t.Fatalf("partial broken cloud stream fabricated COMPLETED at %d", i)
		}
		if ev.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_FAILED {
			failed = ev.GetFailed()
			if i != len(stream.events)-1 {
				t.Fatalf("emitted events after terminal FAILED")
			}
		}
	}
	if failed == nil {
		t.Fatalf("expected terminal FAILED event, got events=%v", stream.events)
	}
	if failed.GetActionHint() != outcomeUncertainActionHint {
		t.Fatalf("failed action_hint = %q, want %q", failed.GetActionHint(), outcomeUncertainActionHint)
	}
	if failed.GetInterruption() == nil ||
		failed.GetInterruption().GetCause() != runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_UNSPECIFIED ||
		failed.GetInterruption().GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN {
		t.Fatalf("partial stream interruption = %#v, want UNSPECIFIED+OUTCOME_UNCERTAIN", failed.GetInterruption())
	}
}
