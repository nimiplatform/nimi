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
)

type mockLocalAppTextTurnStream struct {
	ctx    context.Context
	events []*runtimev1.StreamLocalAppTextTurnEvent
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
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "assistant", Text: "not admitted"}}, MaxTokens: testInt32(1),
	}, stream)
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	if len(stream.events) != 0 {
		t.Fatalf("invalid input produced events = %+v", stream.events)
	}
}

func TestStreamLocalAppTextTurnProjectsTypedDeltasAndTerminal(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1", &runtimev1.AIConfig{
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
			Delta: &runtimev1.ScenarioStreamDelta_Reasoning{Reasoning: &runtimev1.ReasoningStreamDelta{Text: "thinking"}},
		}}},
		{Payload: &runtimev1.StreamScenarioEvent_ToolCall{ToolCall: &runtimev1.ToolCall{Name: "tool"}}},
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
			Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
				Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{Text: "hello"}},
			}},
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
