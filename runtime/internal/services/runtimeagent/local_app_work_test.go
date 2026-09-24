package runtimeagent

import (
	"context"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAppAgentBindingRestoresByScopeWithoutReusingSessionHandle(t *testing.T) {
	a := localAppReferenceDecision(1, "one")
	b := localAppReferenceDecision(2, "one")
	if mintLocalAppAgentBinding(a, "agent-one") != mintLocalAppAgentBinding(b, "agent-one") || mintLocalAppAgentHandle(a, "agent-one") == mintLocalAppAgentHandle(b, "agent-one") {
		t.Fatal("binding/handle lifetime mismatch")
	}
	b.RegisteredAppSubject = "other-app"
	if mintLocalAppAgentBinding(a, "agent-one") == mintLocalAppAgentBinding(b, "agent-one") {
		t.Fatal("binding crosses App scope")
	}
	b = a
	b.AccountID = "other"
	if mintLocalAppAgentBinding(a, "agent-one") == mintLocalAppAgentBinding(b, "agent-one") {
		t.Fatal("binding crosses account scope")
	}
}

func TestLocalAppWorkExecutesSameAgentAndRejectsForeignAndDuplicateResults(t *testing.T) {
	testAppWorkJourney(t, nil, false)
}
func TestLocalAppRoutinePersistsAppOriginInsteadOfUserSpeech(t *testing.T) {
	name := "Morning brief"
	testAppWorkJourney(t, &name, false)
}
func TestLocalAppWorkInterruptRejectsLateResult(t *testing.T) { testAppWorkJourney(t, nil, true) }
func testAppWorkJourney(t *testing.T, routineName *string, interrupt bool) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetPublicChatAppEmitter(newPublicChatEmitCapture().emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	var steps atomic.Int32
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		step := steps.Add(1)
		if len(req.Tools) != 1 || req.Tools[0].Name != "save_document" {
			t.Error("Agent did not receive its App tool")
		}
		if step == 1 {
			if !strings.Contains(fmt.Sprint(req.Messages), "Native App function save_document") {
				t.Error("App function was absent from Runtime-authorized capability context")
			}
			if !strings.Contains(fmt.Sprint(req.Messages), "App-authored work context") {
				t.Error("missing attributed work lane")
			}
			if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: &runtimev1.TextOutputItemDelta{ItemIndex: 0, ItemCompleted: true, Delta: &runtimev1.TextOutputItemDelta_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "model-call", Name: "save_document", ArgumentsJson: `{"title":"Brief"}`}}}}}}}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED, Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_TOOL_CALL}}})
		}
		last := req.Messages[len(req.Messages)-1]
		if last.GetRole() != "tool" || last.GetTurnItems()[0].GetToolResult().GetResult().GetStructValue().GetFields()["documentId"].GetStringValue() != "saved-real-result" {
			t.Error("Agent did not receive App result")
		}
		if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDeltaAt(0, false, publicChatStructuredEnvelopeAPML("message-work", "Saved the brief."))}}); err != nil {
			return err
		}
		if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: &runtimev1.TextOutputItemDelta{ItemIndex: 0, ItemCompleted: true}}}}}); err != nil {
			return err
		}
		return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED, Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}}})
	}})
	decision := localAppConversationDecision(accountservice.LocalAppOperationReferenceList, 0x39, "user-1")
	callCtx := func(op localappop.Operation) context.Context {
		d := decision
		d.Operation = op
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), d)
	}
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		d := decision
		d.Operation = localappop.OperationConversationTurnSend
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d), nil
	}))
	refs, err := svc.ListLocalAppAgentReferences(callCtx(localappop.OperationAgentReferenceList), &runtimev1.ListLocalAppAgentReferencesRequest{})
	if err != nil {
		t.Fatal(err)
	}
	handle := refs.References[0].AgentHandle
	opened, err := svc.OpenLocalAppConversation(callCtx(localappop.OperationConversationOpen), &runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle})
	if err != nil {
		t.Fatal(err)
	}
	anchor := opened.ConversationAnchorId
	sent, err := svc.SendLocalAppConversationTurn(callCtx(localappop.OperationConversationTurnSend), &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: handle, ConversationAnchorId: anchor, RequestId: "work-request", Parts: []*runtimev1.LocalAppConversationInputPart{{Part: &runtimev1.LocalAppConversationInputPart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: "Save a brief"}}}}, Work: &runtimev1.LocalAppConversationWork{WorkId: "work-1", RoutineName: routineName, Instructions: "Produce the requested document", Tools: []*runtimev1.LocalAppConversationWorkTool{{Name: "save_document", Description: "Save a document", InputSchemaJson: `{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}`}}}})
	if err != nil {
		t.Fatal(err)
	}
	var pending *runtimev1.LocalAppConversationToolCall
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		listed, err := svc.ListLocalAppConversationToolCalls(callCtx(localappop.OperationConversationToolCallsList), &runtimev1.ListLocalAppConversationToolCallsRequest{AgentHandle: handle, ConversationAnchorId: anchor, TurnId: sent.TurnId})
		if err != nil {
			t.Fatal(err)
		}
		if len(listed.Calls) > 0 {
			pending = listed.Calls[0]
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if pending == nil {
		t.Fatal("Agent never requested its App skill")
	}
	result := &runtimev1.SubmitLocalAppConversationToolResultRequest{AgentHandle: handle, ConversationAnchorId: anchor, TurnId: sent.TurnId, CallId: pending.CallId, ResultJson: `{"documentId":"saved-real-result"}`}
	if interrupt {
		stale := "agent_turn_prior"
		if _, err := svc.InterruptLocalAppConversationTurn(callCtx(localappop.OperationConversationTurnInterrupt), &runtimev1.InterruptLocalAppConversationTurnRequest{AgentHandle: handle, ConversationAnchorId: anchor, ExpectedTurnId: &stale}); status.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "AGENT_TURN_NOT_ACTIVE") {
			t.Fatalf("stale work interruption: %v", err)
		}
		interrupted, _, _ := svc.publicChatInterruptStatus(sent.TurnId)
		if interrupted {
			t.Fatal("stale work interrupted the current turn")
		}
		if _, err := svc.InterruptLocalAppConversationTurn(callCtx(localappop.OperationConversationTurnInterrupt), &runtimev1.InterruptLocalAppConversationTurnRequest{AgentHandle: handle, ConversationAnchorId: anchor, ExpectedTurnId: &sent.TurnId}); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.SubmitLocalAppConversationToolResult(callCtx(localappop.OperationConversationToolResultSubmit), result); status.Code(err) != codes.PermissionDenied {
			t.Fatalf("late tool result: %v", err)
		}
		if steps.Load() != 1 {
			t.Fatal("interrupted execution resumed")
		}
		return
	}
	foreign := decision
	foreign.Operation = localappop.OperationConversationToolResultSubmit
	foreign.RegisteredAppSubject = "another-app"
	if _, err := svc.SubmitLocalAppConversationToolResult(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), foreign), result); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign result: %v", err)
	}
	if _, err := svc.SubmitLocalAppConversationToolResult(callCtx(localappop.OperationConversationToolResultSubmit), result); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitLocalAppConversationToolResult(callCtx(localappop.OperationConversationToolResultSubmit), result); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("duplicate result: %v", err)
	}
	for time.Now().Before(deadline) {
		snapshot, err := svc.GetLocalAppConversationSnapshot(callCtx(localappop.OperationConversationSnapshotGet), &runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchor})
		if err != nil {
			t.Fatal(err)
		}
		for _, turn := range snapshot.GetSnapshot().GetTurns() {
			if turn.TurnId == sent.TurnId && turn.Status == runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_COMPLETED {
				foundOrigin := false
				for _, message := range snapshot.GetSnapshot().GetMessages() {
					if message.TurnId != sent.TurnId || message.Role == runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT {
						continue
					}
					expected := runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER
					if routineName != nil {
						expected = runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_APP
					}
					if message.Role != expected {
						t.Fatalf("origin role = %v, expected %v", message.Role, expected)
					}
					if routineName != nil && !strings.Contains(message.Parts[0].GetText().GetText(), "nimi.thirdparty.fixture") {
						t.Fatal("routine source was not derived from the caller")
					}
					foundOrigin = true
				}
				if !foundOrigin {
					t.Fatal("missing initiating message")
				}
				if steps.Load() != 2 {
					t.Fatal("unexpected model steps")
				}
				return
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("work did not commit its final Conversation result")
}
