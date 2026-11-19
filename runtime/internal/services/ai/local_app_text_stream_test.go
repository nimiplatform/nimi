package ai

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

type mockLocalAppTextTurnStream struct {
	ctx    context.Context
	events []*runtimev1.StreamLocalAppTextTurnEvent
}

func TestLocalAppTextTurnUsagePreservesAbsenceAndReportedZero(t *testing.T) {
	for _, usage := range []*runtimev1.UsageStats{nil, {}, {InputTokens: 7, OutputTokens: 2, ComputeMs: 99, CachedInputTokens: 3}} {
		mock := &mockLocalAppTextTurnStream{ctx: context.Background()}
		bridge := &localAppTextTurnStreamBridge{ServerStreamingServer: mock}
		if err := bridge.Send(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Delta{
			Delta: textOutputDelta(0, "answer", true),
		}}); err != nil {
			t.Fatal(err)
		}
		if err := bridge.Send(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Completed{
			Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: usage},
		}}); err != nil {
			t.Fatal(err)
		}
		got := mock.events[1].GetCompleted().GetUsage()
		if usage == nil {
			if got != nil {
				t.Fatal("missing usage became reported zero")
			}
			continue
		}
		if got == nil || got == usage || got.InputTokens != usage.InputTokens || got.OutputTokens != usage.OutputTokens || got.ComputeMs != 0 || got.CachedInputTokens != 0 {
			t.Fatalf("aggregate usage projection = %v from %v", got, usage)
		}
	}
}

func TestProtectedLocalTextResponsesSeparateTokenCountsFromTiming(t *testing.T) {
	for _, tc := range []struct {
		name   string
		result localexecution.TextResult
	}{
		{name: "timing-only", result: localexecution.TextResult{ComputeMS: 7}},
		{name: "reported-zero", result: localexecution.TextResult{TokenUsage: &runtimev1.UsageStats{}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestService(nil)
			if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "account-1", appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent("text.generate"))); err != nil {
				t.Fatal(err)
			}
			svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-usage", "app.gguf")})
			tc.result.Text = "answer"
			tc.result.FinishReason = runtimev1.FinishReason_FINISH_REASON_STOP
			svc.SetLocalTextExecutionHost(&localTextHostStub{result: tc.result})
			request := validLocalAppTextTurnRequest()

			response, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), &runtimev1.ExecuteLocalAppScenarioRequest{
				Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: request},
			})
			if err != nil || response.GetTextGenerate() == nil || !proto.Equal(response.GetTextGenerate().GetUsage(), tc.result.TokenUsage) {
				t.Fatalf("protected sync response = %v, err = %v", response, err)
			}

			stream := &mockLocalAppTextTurnStream{ctx: localAppTextTurnContext()}
			if err := svc.StreamLocalAppTextTurn(request, stream); err != nil {
				t.Fatal(err)
			}
			completed := stream.events[len(stream.events)-1].GetCompleted()
			if completed == nil || !proto.Equal(completed.GetUsage(), tc.result.TokenUsage) {
				t.Fatalf("protected stream completion = %v", completed)
			}

			svc.scenarioJobs.mu.RLock()
			defer svc.scenarioJobs.mu.RUnlock()
			for _, record := range svc.scenarioJobs.jobs {
				if record.job.GetUsage() == nil || record.job.GetUsage().GetComputeMs() != tc.result.ComputeMS {
					t.Fatalf("job lost observed usage: %v", record.job.GetUsage())
				}
			}
		})
	}
}

func TestLocalAppSummaryEmptySealAndHiddenRefusal(t *testing.T) {
	mock := &mockLocalAppTextTurnStream{ctx: context.Background()}
	bridge := &localAppTextTurnStreamBridge{ServerStreamingServer: mock, allowSummary: true}
	delta := func(text string, complete bool) *runtimev1.StreamScenarioEvent {
		item := &runtimev1.TextOutputItemDelta{ItemIndex: 0, ItemCompleted: complete}
		if text != "" {
			item.Delta = &runtimev1.TextOutputItemDelta_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummaryDelta{Text: text}}
		}
		return &runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: item}}}}
	}
	if err := bridge.Send(delta("Authorized", false)); err != nil {
		t.Fatal(err)
	}
	if err := bridge.Send(delta("", true)); err != nil {
		t.Fatal(err)
	}
	if len(mock.events) != 2 || mock.events[1].GetReasoningSummary().GetText() != "" || !mock.events[1].GetReasoningSummary().GetItemCompleted() || bridge.nextItemIndex != 1 || bridge.hasOutput {
		t.Fatalf("summary seal=%v", mock.events)
	}
	hidden := &localAppTextTurnStreamBridge{ServerStreamingServer: &mockLocalAppTextTurnStream{ctx: context.Background()}}
	if err := hidden.Send(delta("Unrequested", false)); err == nil {
		t.Fatal("hidden summary emitted")
	}
}

func (m *mockLocalAppTextTurnStream) Send(event *runtimev1.StreamLocalAppTextTurnEvent) error {
	m.events = append(m.events, event)
	return nil
}

func (m *mockLocalAppTextTurnStream) Context() context.Context     { return m.ctx }
func (m *mockLocalAppTextTurnStream) SendHeader(metadata.MD) error { return nil }
func (m *mockLocalAppTextTurnStream) SetHeader(metadata.MD) error  { return nil }
func (m *mockLocalAppTextTurnStream) SetTrailer(metadata.MD)       {}
func (m *mockLocalAppTextTurnStream) RecvMsg(any) error            { return nil }
func (m *mockLocalAppTextTurnStream) SendMsg(any) error            { return nil }

func localAppTextTurnContext() context.Context {
	return localAppScenarioDecisionContext(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)
}

func validLocalAppTextTurnRequest() *runtimev1.StreamLocalAppTextTurnRequest {
	return &runtimev1.StreamLocalAppTextTurnRequest{
		Messages:         []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Create a persona."}},
		Temperature:      testFloat32(0.7),
		TopP:             testFloat32(0.95),
		MaxTokens:        testInt32(512),
		TopK:             testInt32(17),
		PresencePenalty:  testFloat32(0.5),
		FrequencyPenalty: testFloat32(-0.25),
		Stop:             []string{"END"},
		Seed:             testInt64(-7),
	}
}

func TestStreamLocalAppTextTurnRequiresExactDecision(t *testing.T) {
	svc := &Service{}
	stream := &mockLocalAppTextTurnStream{ctx: context.Background()}
	err := svc.StreamLocalAppTextTurn(validLocalAppTextTurnRequest(), stream)
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}

func TestStreamLocalAppTextTurnRejectsInvalidInput(t *testing.T) {
	svc := &Service{}
	stream := &mockLocalAppTextTurnStream{ctx: localAppTextTurnContext()}
	err := svc.StreamLocalAppTextTurn(&runtimev1.StreamLocalAppTextTurnRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "assistant", Text: " \n "}}, MaxTokens: testInt32(1),
	}, stream)
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	if len(stream.events) != 0 {
		t.Fatalf("invalid input produced events = %+v", stream.events)
	}
}

func TestStreamLocalAppTextTurnProjectsTypedDeltasAndTerminal(t *testing.T) {
	svc := newTestService(nil)
	if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "account-1", &runtimev1.AIConfig{
		Owner: derivedAppAIConfigOwner("nimi.realm-persona-studio"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{{
			CapabilityContract: "text.generate",
			Route:              &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}},
		}},
	}); err != nil {
		t.Fatalf("install App AIConfig: %v", err)
	}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-app", "app.gguf")})
	svc.SetLocalTextExecutionHost(&localTextHostStub{
		streamDeltas: []localexecution.TextDelta{{Text: "hello"}, {Text: " stream"}},
		result: localexecution.TextResult{
			Text: "hello stream", FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		},
	})
	stream := &mockLocalAppTextTurnStream{ctx: localAppTextTurnContext()}
	if err := svc.StreamLocalAppTextTurn(validLocalAppTextTurnRequest(), stream); err != nil {
		t.Fatalf("StreamLocalAppTextTurn: %v", err)
	}
	var text strings.Builder
	var completed *runtimev1.LocalAppTextTurnCompleted
	for _, event := range stream.events {
		if delta := event.GetDelta(); delta != nil {
			text.WriteString(delta.GetText())
		}
		if event.GetCompleted() != nil {
			completed = event.GetCompleted()
		}
		if event.GetFailed() != nil {
			t.Fatalf("unexpected failed event = %+v", event.GetFailed())
		}
	}
	if text.String() != "hello stream" || completed == nil ||
		completed.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("stream text=%q completed=%+v events=%+v", text.String(), completed, stream.events)
	}
}

func TestLocalAppTextTurnStreamBridgeFailsClosedOnOwnerOnlyEvents(t *testing.T) {
	bridge := &localAppTextTurnStreamBridge{ServerStreamingServer: &mockLocalAppTextTurnStream{ctx: context.Background()}}
	ownerOnly := []*runtimev1.StreamScenarioEvent{
		{Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
			Delta: &runtimev1.ScenarioStreamDelta_Raw{Raw: &runtimev1.RawChunk{}},
		}}},
		{Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
			Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: &runtimev1.TextOutputItemDelta{
				ItemIndex: 0,
				Delta: &runtimev1.TextOutputItemDelta_ReasoningSummary{
					ReasoningSummary: &runtimev1.ReasoningSummaryDelta{Text: "thinking"},
				},
			}},
		}}},
		{Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
			FinishReason: runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED,
		}}},
		{Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{}}},
	}
	for index, event := range ownerOnly {
		err := bridge.Send(event)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("owner-only event %d error = %v", index, err)
		}
	}
}

func TestLocalAppTextTurnStreamBridgeDropsStartedAndUsage(t *testing.T) {
	mock := &mockLocalAppTextTurnStream{ctx: context.Background()}
	bridge := &localAppTextTurnStreamBridge{ServerStreamingServer: mock}
	if err := bridge.Send(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Started{
		Started: &runtimev1.ScenarioStreamStarted{ModelResolved: "private-model", RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
	}}); err != nil {
		t.Fatalf("started event: %v", err)
	}
	if err := bridge.Send(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Usage{
		Usage: &runtimev1.UsageStats{InputTokens: 1},
	}}); err != nil {
		t.Fatalf("usage event: %v", err)
	}
	if len(mock.events) != 0 {
		t.Fatalf("started/usage leaked into trimmed stream = %+v", mock.events)
	}
	for _, event := range []*runtimev1.StreamScenarioEvent{
		{
			Sequence: 41,
			TraceId:  "trace-local-app",
			Payload:  &runtimev1.StreamScenarioEvent_Delta{Delta: textOutputDelta(0, "hello", true)},
		},
		{
			Sequence: 42,
			TraceId:  "trace-local-app",
			Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
				FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
			}},
		},
	} {
		if err := bridge.Send(event); err != nil {
			t.Fatalf("project event: %v", err)
		}
	}
	if len(mock.events) != 2 || mock.events[0].GetSequence() != 1 || mock.events[1].GetSequence() != 2 {
		t.Fatalf("trimmed stream sequence = %+v", mock.events)
	}
}

func TestLocalAppTextRecordGuardPrecedesModelDispatch(t *testing.T) {
	svc := newTestService(nil)
	config := appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent("text.generate"))
	if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "account-1", config); err != nil {
		t.Fatal(err)
	}
	local := selectedTextExecutionForTest(t, "new-loadout", "app.gguf")
	local.LoadoutRevision = "new-revision"
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: local})
	calls := 0
	host := &localTextHostStub{streamFn: func(_ context.Context, emit func(localexecution.TextDelta) error) (localexecution.TextResult, error) {
		calls++
		if e := emit(localexecution.TextDelta{Text: "ok"}); e != nil {
			return localexecution.TextResult{}, e
		}
		return localexecution.TextResult{Text: "ok", FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}, nil
	}}
	svc.SetLocalTextExecutionHost(host)
	for _, sel := range []*runtimev1.AppTextConfigSelection{
		{ConfigRef: "main", ExpectedRevision: "2"},
		{ConfigRef: "main", ExpectedRevision: "1", ExpectedLocalLoadoutRef: "old-loadout", ExpectedLocalLoadoutRevision: "old-revision"},
		{ConfigRef: "main", ExpectedRevision: "1", ExpectedLocalLoadoutRef: local.LoadoutID, ExpectedLocalLoadoutRevision: "old-revision"},
	} {
		req := validLocalAppTextTurnRequest()
		req.Configuration = sel
		err := svc.StreamLocalAppTextTurn(req, &mockLocalAppTextTurnStream{ctx: localAppTextTurnContext()})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONFIG_REVISION_CONFLICT {
			t.Fatalf("wrong admission for %v: %v", sel, err)
		}
	}
	if calls != 0 {
		t.Fatal("stale selection reached model")
	}
	req := validLocalAppTextTurnRequest()
	req.Configuration = &runtimev1.AppTextConfigSelection{ConfigRef: "main", ExpectedRevision: "1", ExpectedLocalLoadoutRef: local.LoadoutID, ExpectedLocalLoadoutRevision: local.LoadoutRevision}
	stream := &mockLocalAppTextTurnStream{ctx: localAppTextTurnContext()}
	if err := svc.StreamLocalAppTextTurn(req, stream); err != nil {
		t.Fatal(err)
	}
	actual := stream.events[len(stream.events)-1].GetCompleted().GetConfiguration()
	if calls != 1 || actual.GetConfigRef() != "main" || actual.GetRevision() != "1" || actual.GetLocalLoadoutRevision() != local.LoadoutRevision {
		t.Fatalf("bad capture: %v calls=%d", actual, calls)
	}
}
