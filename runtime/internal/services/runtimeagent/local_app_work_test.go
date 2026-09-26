package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

func TestAppAgentBindingRestoresByScopeWithoutReusingSessionHandle(t *testing.T) {
	a, b := localAppReferenceDecision(1, "one"), localAppReferenceDecision(2, "one")
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

type appWorkFixture struct {
	svc      *Service
	decision accountservice.LocalAppCallerDecision
	handle   string
}

func newAppWorkFixture(t *testing.T) appWorkFixture {
	t.Helper()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	decision := localAppConversationDecision(localappop.OperationAgentWorkReferenceList, 0x39, "user-1")
	decision.OperationCapability = "agent.work"
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
		d, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
		if !ok {
			return nil, localAppAgentAccessDenied()
		}
		select {
		case <-d.SessionInvalidated:
			return nil, localAppAgentAccessDenied()
		default:
		}
		c, err := localappop.ClassifyIngress(ingress)
		if err != nil {
			return nil, err
		}
		d.Operation, d.OperationCapability = c.Operation, string(c.Domain)
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d), nil
	}))
	f := appWorkFixture{svc: svc, decision: decision}
	refs, err := svc.ListLocalAppAgentWorkReferences(f.ctx(localappop.OperationAgentWorkReferenceList), &runtimev1.ListLocalAppAgentWorkReferencesRequest{})
	if err != nil || len(refs.GetReferences()) != 1 {
		t.Fatalf("work references: %v %v", refs, err)
	}
	f.handle = refs.References[0].AgentHandle
	return f
}
func (f appWorkFixture) ctx(op localappop.Operation) context.Context {
	d := f.decision
	c, _ := localappop.ClassifyOperation(op)
	d.Operation, d.OperationCapability = op, string(c.Domain)
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), d)
}
func (f appWorkFixture) request() *runtimev1.StartLocalAppAgentWorkRequest {
	return &runtimev1.StartLocalAppAgentWorkRequest{AgentHandle: f.handle, RequestId: "work-request", Prompt: "Save a brief", Work: &runtimev1.LocalAppAgentWorkInput{WorkId: "work-1", Instructions: "Produce the requested document", Tools: []*runtimev1.LocalAppAgentWorkTool{{Name: "save_document", Description: "Save a document", InputSchemaJson: `{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}`}}}}
}
func (f appWorkFixture) start(t *testing.T) string {
	t.Helper()
	out, err := f.svc.StartLocalAppAgentWork(f.ctx(localappop.OperationAgentWorkStart), f.request())
	if err != nil {
		t.Fatal(err)
	}
	return out.ExecutionId
}
func (f appWorkFixture) wait(t *testing.T, id string, predicate func(*runtimev1.LocalAppAgentWorkExecution) bool) *runtimev1.LocalAppAgentWorkExecution {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		out, err := f.svc.GetLocalAppAgentWork(f.ctx(localappop.OperationAgentWorkGet), &runtimev1.GetLocalAppAgentWorkRequest{AgentHandle: f.handle, ExecutionId: id})
		if err != nil {
			t.Fatal(err)
		}
		if predicate(out.Execution) {
			return out.Execution
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("execution did not reach expected state")
	return nil
}
func emitWorkText(emit func(*runtimev1.StreamScenarioEvent) error, text string, finish runtimev1.FinishReason) error {
	if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDeltaAt(0, true, text)}}); err != nil {
		return err
	}
	return emitWorkCompleted(emit, finish)
}
func emitWorkCompleted(emit func(*runtimev1.StreamScenarioEvent) error, finish runtimev1.FinishReason) error {
	return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED, Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: finish}}})
}
func emitWorkTool(emit func(*runtimev1.StreamScenarioEvent) error, index uint32, id, name string) error {
	return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: &runtimev1.TextOutputItemDelta{ItemIndex: index, ItemCompleted: true, Delta: &runtimev1.TextOutputItemDelta_ToolCall{ToolCall: &runtimev1.ToolCall{Id: id, Name: name, ArgumentsJson: `{"title":"Brief"}`}}}}}}})
}
func (f appWorkFixture) tool(t *testing.T, id string) *runtimev1.LocalAppAgentWorkToolCall {
	t.Helper()
	f.wait(t, id, func(x *runtimev1.LocalAppAgentWorkExecution) bool {
		return x.State == runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_WAITING_TOOL
	})
	out, err := f.svc.ListLocalAppAgentWorkToolCalls(f.ctx(localappop.OperationAgentWorkToolCallsList), &runtimev1.ListLocalAppAgentWorkToolCallsRequest{AgentHandle: f.handle, ExecutionId: id})
	if err != nil || len(out.GetCalls()) != 1 {
		t.Fatalf("tool calls: %+v %v", out, err)
	}
	return out.Calls[0]
}

func TestLocalAppWorkIsolatedSameAgentToolContinuationAndMemory(t *testing.T) {
	f := newAppWorkFixture(t)
	svc := f.svc
	agentID := testRuntimeAgentLocalRef("agent-alpha")
	anchor := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if err := svc.commitPublicChatTurnTranscript(anchor, &runtimev1.ChatMessage{Role: "user", Content: "CHAT_HISTORY_MUST_STAY_PRIVATE"}, "CHAT_REPLY_MUST_STAY_PRIVATE"); err != nil {
		t.Fatal(err)
	}
	svc.cognitionMemoryWG.Wait()
	seedCognitionMemoryForTerminationTest(t, svc, agentID, "请记住：这轮开发验收项目的代号是银桥青叶。")
	svc.cognitionMemoryWG.Wait()
	var before int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_committed_event`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	_, chatEvents := svc.addLocalAppConversationSubscriber(localAppConversationSubscriber{accountID: "user-1", conversationAnchorID: anchor})
	var steps atomic.Int32
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		n := steps.Add(1)
		messages := fmt.Sprint(req.Messages)
		if strings.Contains(messages, "CHAT_HISTORY_MUST_STAY_PRIVATE") || strings.Contains(messages, "CHAT_REPLY_MUST_STAY_PRIVATE") {
			t.Error("work inherited canonical chat")
		}
		if !strings.Contains(messages, "App-authored work context") || len(req.Tools) != 1 {
			t.Error("App context/tool missing")
		}
		if n == 1 {
			if !strings.Contains(messages, "银桥青叶") || !strings.Contains(messages, "Cognition-owned advisory Memory") {
				t.Error("allowed personal Memory missing from work context")
			}
			if err := emitWorkTool(emit, 0, "call-a", "save_document"); err != nil {
				return err
			}
			if err := emitWorkTool(emit, 1, "call-b", "save_document"); err != nil {
				return err
			}
			return emitWorkCompleted(emit, runtimev1.FinishReason_FINISH_REASON_TOOL_CALL)
		}
		tail := req.Messages[len(req.Messages)-3:]
		if tail[0].GetRole() != "assistant" || len(tail[0].GetTurnItems()) != 2 || tail[1].GetTurnItems()[0].GetToolResult().GetToolCallId() != "call-a" || tail[2].GetTurnItems()[0].GetToolResult().GetToolCallId() != "call-b" {
			t.Errorf("unordered continuation: %v", tail)
		}
		return emitWorkText(emit, "Saved the brief.", runtimev1.FinishReason_FINISH_REASON_STOP)
	}})
	// The consumer's only admitted operation is agent.work; a work reference
	// neither opens nor authorizes a canonical Conversation read.
	if _, err := svc.GetLocalAppConversationSnapshot(f.ctx(localappop.OperationAgentWorkGet), &runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: f.handle, ConversationAnchorId: anchor}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("work scope read chat: %v", err)
	}
	request := f.request()
	request.Prompt = "请从获准的长期记忆中找出本次开发验收项目代号并保存简报，不读取聊天历史，不猜测。"
	started, err := svc.StartLocalAppAgentWork(f.ctx(localappop.OperationAgentWorkStart), request)
	if err != nil {
		t.Fatal(err)
	}
	id := started.ExecutionId
	first := f.tool(t, id)
	submit := func(call *runtimev1.LocalAppAgentWorkToolCall) *runtimev1.SubmitLocalAppAgentWorkToolResultRequest {
		return &runtimev1.SubmitLocalAppAgentWorkToolResultRequest{AgentHandle: f.handle, ExecutionId: id, CallId: call.CallId, ResultJson: `{"documentId":"saved-real-result"}`}
	}
	foreign := f
	foreign.decision.RegisteredAppSubject = "other-app"
	foreign.handle = mintLocalAppAgentHandle(foreign.decision, agentID)
	wrong := submit(first)
	wrong.AgentHandle = foreign.handle
	if _, err := svc.SubmitLocalAppAgentWorkToolResult(foreign.ctx(localappop.OperationAgentWorkToolResultSubmit), wrong); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign result accepted: %v", err)
	}
	if _, err := svc.GetLocalAppAgentWork(foreign.ctx(localappop.OperationAgentWorkGet), &runtimev1.GetLocalAppAgentWorkRequest{AgentHandle: foreign.handle, ExecutionId: id}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign get accepted: %v", err)
	}
	foreignStream := &workEventCapture{ctx: foreign.ctx(localappop.OperationAgentWorkEventsSubscribe)}
	if err := svc.SubscribeLocalAppAgentWorkEvents(&runtimev1.SubscribeLocalAppAgentWorkEventsRequest{AgentHandle: foreign.handle, ExecutionId: id}, foreignStream); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign stream accepted: %v", err)
	}
	if _, err := svc.SubmitLocalAppAgentWorkToolResult(f.ctx(localappop.OperationAgentWorkToolResultSubmit), submit(first)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitLocalAppAgentWorkToolResult(f.ctx(localappop.OperationAgentWorkToolResultSubmit), submit(first)); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("duplicate accepted: %v", err)
	}
	var second *runtimev1.LocalAppAgentWorkToolCall
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		calls, err := svc.ListLocalAppAgentWorkToolCalls(f.ctx(localappop.OperationAgentWorkToolCallsList), &runtimev1.ListLocalAppAgentWorkToolCallsRequest{AgentHandle: f.handle, ExecutionId: id})
		if err != nil {
			t.Fatal(err)
		}
		if len(calls.Calls) == 1 && calls.Calls[0].CallId != first.CallId {
			second = calls.Calls[0]
			break
		}
		time.Sleep(time.Millisecond)
	}
	if second == nil {
		t.Fatal("second ordered tool missing")
	}
	if _, err := svc.SubmitLocalAppAgentWorkToolResult(f.ctx(localappop.OperationAgentWorkToolResultSubmit), submit(second)); err != nil {
		t.Fatal(err)
	}
	terminal := f.wait(t, id, func(x *runtimev1.LocalAppAgentWorkExecution) bool { return localAppWorkTerminal(x.State) })
	if terminal.State != runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_SUCCEEDED || terminal.OutputText != "Saved the brief." || steps.Load() != 2 {
		t.Fatalf("unexpected result: %v steps=%d", terminal, steps.Load())
	}
	stream := &workEventCapture{ctx: f.ctx(localappop.OperationAgentWorkEventsSubscribe)}
	if err := svc.SubscribeLocalAppAgentWorkEvents(&runtimev1.SubscribeLocalAppAgentWorkEventsRequest{AgentHandle: f.handle, ExecutionId: id}, stream); err != nil {
		t.Fatal(err)
	}
	last := uint64(0)
	toolEvents := 0
	for _, e := range stream.events {
		if e.ExecutionId != id || e.Sequence <= last {
			t.Fatalf("bad event order: %v", e)
		}
		last = e.Sequence
		if e.GetToolCall() != nil {
			toolEvents++
		}
	}
	if toolEvents != 2 || last != terminal.Sequence {
		t.Fatalf("incomplete own event stream: %+v", stream.events)
	}
	if len(chatEvents) != 0 || len(capture.messageTypes()) != 0 {
		t.Fatal("work output reached chat event subscribers")
	}
	svc.chatSurfaceMu.Lock()
	transcript := clonePublicChatCommittedTranscript(svc.chatAnchors[anchor].CommittedTranscript)
	svc.chatSurfaceMu.Unlock()
	if len(transcript) != 1 || transcript[0].InputText != "CHAT_HISTORY_MUST_STAY_PRIVATE" {
		t.Fatalf("work committed Conversation: %v", transcript)
	}
	var after int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_committed_event`).Scan(&after); err != nil || after != before {
		t.Fatalf("work committed Memory: before=%d after=%d err=%v", before, after, err)
	}
}

type workEventCapture struct {
	ctx    context.Context
	events []*runtimev1.LocalAppAgentWorkEvent
}

func (s *workEventCapture) Context() context.Context { return s.ctx }
func (s *workEventCapture) Send(e *runtimev1.LocalAppAgentWorkEvent) error {
	s.events = append(s.events, proto.Clone(e).(*runtimev1.LocalAppAgentWorkEvent))
	return nil
}
func (*workEventCapture) SetHeader(metadata.MD) error  { return nil }
func (*workEventCapture) SendHeader(metadata.MD) error { return nil }
func (*workEventCapture) SetTrailer(metadata.MD)       {}
func (*workEventCapture) SendMsg(any) error            { return nil }
func (*workEventCapture) RecvMsg(any) error            { return nil }

func TestLocalAppWorkCancelAndScopeInvalidationRejectLateTools(t *testing.T) {
	for _, invalidate := range []bool{false, true} {
		t.Run(fmt.Sprint(invalidate), func(t *testing.T) {
			f := newAppWorkFixture(t)
			invalidated := make(chan struct{})
			f.decision.SessionInvalidated = invalidated
			var steps atomic.Int32
			f.svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
				steps.Add(1)
				if err := emitWorkTool(emit, 0, "call", "save_document"); err != nil {
					return err
				}
				return emitWorkCompleted(emit, runtimev1.FinishReason_FINISH_REASON_TOOL_CALL)
			}})
			id := f.start(t)
			call := f.tool(t, id)
			if invalidate {
				close(invalidated)
			} else {
				if _, err := f.svc.CancelLocalAppAgentWork(f.ctx(localappop.OperationAgentWorkCancel), &runtimev1.CancelLocalAppAgentWorkRequest{AgentHandle: f.handle, ExecutionId: id}); err != nil {
					t.Fatal(err)
				}
			}
			_, err := f.svc.SubmitLocalAppAgentWorkToolResult(f.ctx(localappop.OperationAgentWorkToolResultSubmit), &runtimev1.SubmitLocalAppAgentWorkToolResultRequest{AgentHandle: f.handle, ExecutionId: id, CallId: call.CallId, ResultJson: `{"late":true}`})
			if status.Code(err) != codes.PermissionDenied {
				t.Fatalf("late result accepted: %v", err)
			}
			f.svc.chatAsyncWG.Wait()
			if steps.Load() != 1 {
				t.Fatal("cancelled execution resumed")
			}
			f.svc.chatSurfaceMu.Lock()
			state := f.svc.localAppWorkExecutions[id].snapshot.State
			busy := f.svc.localAgentExecutionBusyLocked(testRuntimeAgentLocalRef("agent-alpha"))
			f.svc.chatSurfaceMu.Unlock()
			if state != runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_CANCELLED || busy {
				t.Fatalf("cancel did not finish: state=%v busy=%v", state, busy)
			}
		})
	}
}

func TestLocalAppWorkAndChatShareBusyWithoutContentOrCancellation(t *testing.T) {
	f := newAppWorkFixture(t)
	svc := f.svc
	svc.SetPublicChatAppEmitter(newPublicChatEmitCapture().emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, _ func(*runtimev1.StreamScenarioEvent) error) error {
		<-ctx.Done()
		return ctx.Err()
	}})
	anchor := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	id := f.start(t)
	if _, err := svc.SendLocalAppConversationTurn(f.ctx(localappop.OperationConversationTurnSend), &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: f.handle, ConversationAnchorId: anchor, RequestId: "chat", Parts: []*runtimev1.LocalAppConversationInputPart{{Part: &runtimev1.LocalAppConversationInputPart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: "chat text"}}}}}); !strings.Contains(fmt.Sprint(err), "AGENT_BUSY") {
		t.Fatalf("work did not block chat: %v", err)
	}
	foreign := f
	foreign.decision.RegisteredAppSubject = "other-app"
	foreign.handle = mintLocalAppAgentHandle(foreign.decision, testRuntimeAgentLocalRef("agent-alpha"))
	statusOut, err := svc.GetLocalAppAgentWorkStatus(foreign.ctx(localappop.OperationAgentWorkStatusGet), &runtimev1.GetLocalAppAgentWorkStatusRequest{AgentHandle: foreign.handle})
	if err != nil || !statusOut.Busy || statusOut.OwnExecutionId != nil {
		t.Fatalf("busy disclosed work: %v %v", statusOut, err)
	}
	if _, err := svc.CancelLocalAppAgentWork(foreign.ctx(localappop.OperationAgentWorkCancel), &runtimev1.CancelLocalAppAgentWorkRequest{AgentHandle: foreign.handle, ExecutionId: id}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign cancel accepted: %v", err)
	}
	if _, err := svc.InterruptLocalAppConversationTurn(f.ctx(localappop.OperationConversationTurnInterrupt), &runtimev1.InterruptLocalAppConversationTurnRequest{AgentHandle: f.handle, ConversationAnchorId: anchor}); err == nil {
		t.Fatal("chat interruption selected work")
	}
	if _, err := svc.CancelLocalAppAgentWork(f.ctx(localappop.OperationAgentWorkCancel), &runtimev1.CancelLocalAppAgentWorkRequest{AgentHandle: f.handle, ExecutionId: id}); err != nil {
		t.Fatal(err)
	}
	svc.chatAsyncWG.Wait()
	session, turn, _, err := svc.publicChatRuntime().reserveTurn(context.Background(), f.decision.AppID, f.decision.AccountID, publicChatTurnRequestPayload{LocalAgentRef: testRuntimeAgentLocalRef("agent-alpha"), OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchor, Messages: []publicChatMessagePayload{{Role: "user", Content: "chat text"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.publicChatRuntime().releaseTurn(session.ConversationAnchorID, turn.TurnID)
	if _, err := svc.StartLocalAppAgentWork(f.ctx(localappop.OperationAgentWorkStart), f.request()); !strings.Contains(fmt.Sprint(err), "AGENT_BUSY") {
		t.Fatalf("chat did not block work: %v", err)
	}
}

func TestLocalAppWorkRequiresCompleteValidatedFinalAndToolBatch(t *testing.T) {
	for _, mode := range []string{"length", "open_item", "missing_completed", "failed", "invalid_second_tool", "late_event", "unknown_event"} {
		t.Run(mode, func(t *testing.T) {
			f := newAppWorkFixture(t)
			f.svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
				switch mode {
				case "unknown_event":
					return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_TYPE_UNSPECIFIED})
				case "length":
					return emitWorkText(emit, "partial", runtimev1.FinishReason_FINISH_REASON_LENGTH)
				case "failed":
					return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED, Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE}}})
				case "invalid_second_tool":
					if err := emitWorkTool(emit, 0, "first", "save_document"); err != nil {
						return err
					}
					if err := emitWorkTool(emit, 1, "second", "not_declared"); err != nil {
						return err
					}
					return emitWorkCompleted(emit, runtimev1.FinishReason_FINISH_REASON_TOOL_CALL)
				case "late_event":
					if err := emitWorkText(emit, "complete", runtimev1.FinishReason_FINISH_REASON_STOP); err != nil {
						return err
					}
					return emitWorkCompleted(emit, runtimev1.FinishReason_FINISH_REASON_STOP)
				default:
					if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDeltaAt(0, false, "partial")}}); err != nil {
						return err
					}
					if mode == "open_item" {
						return emitWorkCompleted(emit, runtimev1.FinishReason_FINISH_REASON_STOP)
					}
					return nil
				}
			}})
			id := f.start(t)
			out := f.wait(t, id, func(x *runtimev1.LocalAppAgentWorkExecution) bool { return localAppWorkTerminal(x.State) })
			if out.State != runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_FAILED || out.OutputText != "" {
				t.Fatalf("partial/invalid output became success: %v", out)
			}
			f.svc.chatSurfaceMu.Lock()
			for _, e := range f.svc.localAppWorkExecutions[id].events {
				if e.GetToolCall() != nil {
					t.Error("effect issued from invalid batch")
				}
			}
			f.svc.chatSurfaceMu.Unlock()
		})
	}
}

func TestConversationRejectsRetiredWorkWireField(t *testing.T) {
	f := newAppWorkFixture(t)
	req := &runtimev1.SendLocalAppConversationTurnRequest{}
	req.ProtoReflect().SetUnknown(protowire.AppendBytes(protowire.AppendTag(nil, 6, protowire.BytesType), []byte{10, 1, 'x'}))
	if _, err := f.svc.SendLocalAppConversationTurn(f.ctx(localappop.OperationConversationTurnSend), req); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("retired work accepted: %v", err)
	}
	if reason, _ := grpcerr.ExtractReasonCode(localAppAgentAccessDenied()); reason != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatal("unexpected access reason")
	}
}

func TestLocalAppWorkCancellationFencesLateCompleteModelOutput(t *testing.T) {
	f := newAppWorkFixture(t)
	completed, release := make(chan struct{}), make(chan struct{})
	f.svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		if err := emitWorkText(emit, "A result that arrived too late", runtimev1.FinishReason_FINISH_REASON_STOP); err != nil {
			return err
		}
		close(completed)
		<-release
		return nil
	}})
	id := f.start(t)
	select {
	case <-completed:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("model did not produce test output")
	}
	out, err := f.svc.CancelLocalAppAgentWork(f.ctx(localappop.OperationAgentWorkCancel), &runtimev1.CancelLocalAppAgentWorkRequest{AgentHandle: f.handle, ExecutionId: id})
	close(release)
	if err != nil || out.GetExecution().GetState() != runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_CANCELLED {
		t.Fatalf("cancel failed: %v %v", out, err)
	}
	f.svc.chatAsyncWG.Wait()
	result := f.wait(t, id, func(x *runtimev1.LocalAppAgentWorkExecution) bool { return localAppWorkTerminal(x.State) })
	if result.State != runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_CANCELLED || result.OutputText != "" {
		t.Fatalf("late model result overwrote cancel: %v", result)
	}
}
