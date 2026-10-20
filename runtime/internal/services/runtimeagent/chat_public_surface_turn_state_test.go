package runtimeagent

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPublicChatTurnInterruptCancelsActiveTurn(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-interrupt",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			<-ctx.Done()
			return ctx.Err()
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	started := capture.waitForMessageType(t, publicChatTurnStartedType)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := acceptedPayload["turn_id"].(string)
	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnInterruptType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"turn_id":                turnID,
			"reason":                 "user_cancelled",
		}),
	}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for non-canonical interrupt reason, got %v", err)
	}
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnInterruptType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"turn_id":                turnID,
			"reason":                 "user_cancel",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(interrupt): %v", err)
	}
	ack := capture.waitForMessageType(t, publicChatTurnInterruptAckType)
	interrupted := capture.waitForMessageType(t, publicChatTurnInterruptedType)
	_ = started
	ackDetail := publicChatTurnDetail(t, ack)
	if got := ackDetail["interrupted_turn_id"]; got != turnID {
		t.Fatalf("expected interrupt_ack.detail.interrupted_turn_id=%q, got=%v", turnID, ackDetail)
	}
	interruptedDetail := publicChatTurnDetail(t, interrupted)
	if got := interruptedDetail["reason"]; got != "user_cancel" {
		t.Fatalf("unexpected interrupted.detail.reason: %v", got)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}

func TestPublicChatExecutorDeadlineIsFailedNotInterrupted(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-timeout",
				Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "qwen3-chat", RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				}},
			}); err != nil {
				return err
			}
			return context.DeadlineExceeded
		},
	})
	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref": testRuntimeAgentLocalRef("agent-alpha"), "owner_user_id": "user-1",
			"runtime_source_ref": testRuntimeAgentSourceRef("agent-alpha"), "conversation_anchor_id": anchorID,
			"messages": []any{map[string]any{"role": "user", "content": "timeout"}},
		}),
	}); err != nil {
		t.Fatal(err)
	}
	failed := capture.waitForMessageType(t, publicChatTurnFailedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	if got := publicChatTurnDetail(t, failed)["reason_code"]; got != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String() {
		t.Fatalf("timeout failure reason = %v", got)
	}
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatTurnInterruptedType || messageType == publicChatTurnCompletedType {
			t.Fatalf("execution timeout published wrong terminal: %v", capture.messageTypes())
		}
	}
}

func TestPublicChatSessionSnapshotReportsLiveAndTerminalState(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	release := make(chan struct{})
	firstDeltaApplied := make(chan struct{})
	svc.SetPublicChatAppEmitter(capture.emit)

	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeAPML("message-snapshot", "snapshot complete")
			splitAt := len(envelope) / 2
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-session-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-session-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: runtimeAgentTextStreamDeltaAt(
						0, false, envelope[:splitAt]),
				},
			}); err != nil {
				return err
			}
			close(firstDeltaApplied)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-release:
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-session-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: runtimeAgentTextStreamDeltaAt(
						0, true, envelope[splitAt:]),
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-session-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	select {
	case <-firstDeltaApplied:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for first live turn delta to be applied")
	}
	if got := publicChatPayloadMap(t, accepted)["conversation_anchor_id"].(string); got != anchorID {
		t.Fatalf("expected accepted conversation_anchor_id=%s, got=%s", anchorID, got)
	}
	liveSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-live-1")
	liveSnap := publicChatSessionSnapshotDetail(t, liveSnapshot)
	if got := liveSnap["request_id"]; got != "snapshot-live-1" {
		t.Fatalf("expected snapshot.detail.snapshot.request_id, got=%v", liveSnap)
	}
	if got := liveSnap["session_status"]; got != "turn_active" {
		t.Fatalf("expected live session_status turn_active, got=%v", liveSnap)
	}
	activeTurn := liveSnap["active_turn"].(map[string]any)
	if got := activeTurn["status"]; got != publicChatTurnStatusStreaming {
		t.Fatalf("expected active turn status streaming, got=%v", activeTurn)
	}
	if got := activeTurn["trace_id"]; got != "trace-session-snapshot" {
		t.Fatalf("expected active turn trace_id, got=%v", activeTurn)
	}
	if got := activeTurn["stream_sequence"]; got != float64(2) {
		t.Fatalf("expected active turn stream_sequence 2, got=%v", activeTurn)
	}
	if got := activeTurn["output_observed"]; got != true {
		t.Fatalf("expected active turn output_observed=true, got=%v", activeTurn)
	}
	close(release)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	terminalSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-live-2")
	terminalSnap := publicChatSessionSnapshotDetail(t, terminalSnapshot)
	if got := terminalSnap["request_id"]; got != "snapshot-live-2" {
		t.Fatalf("expected terminal snapshot request_id, got=%v", terminalSnap)
	}
	if got := terminalSnap["session_status"]; got != "idle" {
		t.Fatalf("expected terminal session_status idle, got=%v", terminalSnap)
	}
	if _, ok := terminalSnap["active_turn"]; ok {
		t.Fatalf("expected no active_turn after completion, got=%v", terminalSnap)
	}
	lastTurn := terminalSnap["last_turn"].(map[string]any)
	if got := lastTurn["status"]; got != publicChatTurnStatusCompleted {
		t.Fatalf("expected last turn completed, got=%v", lastTurn)
	}
	if got := lastTurn["message_id"]; got == "message-snapshot" || got != publicChatPayloadMap(t, committed)["message_id"] {
		t.Fatalf("expected last turn message_id, got=%v", lastTurn)
	}
	if got := lastTurn["text"]; got != "snapshot complete" {
		t.Fatalf("expected last turn text, got=%v", lastTurn)
	}
	structured := lastTurn["structured"].(map[string]any)
	if got := structured["schema_id"]; got != publicChatStructuredSchemaID {
		t.Fatalf("expected structured schema id, got=%v", structured)
	}
	if _, present := lastTurn["assistant_memory"]; present {
		t.Fatalf("retired assistant memory projection persisted in last_turn: %v", lastTurn)
	}
	if _, present := lastTurn["chat_sidecar"]; present {
		t.Fatalf("retired sidecar projection persisted in last_turn: %v", lastTurn)
	}
	followUp := lastTurn["follow_up"].(map[string]any)
	if got := followUp["status"]; got != "skipped" {
		t.Fatalf("expected last turn follow_up skipped, got=%v", followUp)
	}
	if got := terminalSnap["transcript_message_count"]; got != float64(2) {
		t.Fatalf("expected transcript count 2, got=%v", terminalSnap)
	}
	transcript, ok := terminalSnap["transcript"].([]any)
	if !ok || len(transcript) != 2 {
		t.Fatalf("expected transcript payload with 2 messages, got=%v", terminalSnap["transcript"])
	}
	firstMessage, ok := transcript[0].(map[string]any)
	if !ok || firstMessage["role"] != "user" || firstMessage["content"] != "hello" {
		t.Fatalf("expected first transcript message to preserve user hello, got=%v", transcript[0])
	}
	secondMessage, ok := transcript[1].(map[string]any)
	if !ok || secondMessage["role"] != "assistant" || secondMessage["content"] != "snapshot complete" {
		t.Fatalf("expected second transcript message to preserve assistant completion, got=%v", transcript[1])
	}
}

func TestPublicChatMediaTailDoesNotHoldTextOrClobberNextTurn(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	media := &interruptiblePublicChatActionExecutor{entered: make(chan struct{})}
	svc.SetPublicChatActionExecutor(media)
	nextEntered := make(chan struct{})
	nextRelease := make(chan struct{})
	nextCanceled := make(chan struct{}, 1)
	var calls uint32
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(ctx context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		if atomic.AddUint32(&calls, 1) == 1 {
			return emitPublicChatImageActionStream("old-media", publicChatImageActionAPML("unused", "saved first answer", "unused-action", "draw"))(ctx, req, emit)
		}
		close(nextEntered)
		select {
		case <-nextRelease:
			return emitPublicChatImageActionStream("new-text", `<message intent="reply">new answer</message>`)(ctx, req, emit)
		case <-ctx.Done():
			nextCanceled <- struct{}{}
			return ctx.Err()
		}
	}})
	submitPublicChatImageActionTurn(t, svc, anchorID, true)
	first := publicChatPayloadMap(t, capture.waitForMessageType(t, publicChatTurnAcceptedType))["turn_id"].(string)
	select {
	case <-media.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("media did not start")
	}
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	slot := anchor.ActiveTurnID
	oldAlive := svc.chatTurns[first] != nil
	svc.chatSurfaceMu.Unlock()
	if slot != "" || !oldAlive {
		t.Fatalf("text slot=%q old tail alive=%v", slot, oldAlive)
	}
	req := publicChatTurnRequestPayload{LocalAgentRef: testRuntimeAgentLocalRef("agent-alpha"), OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchorID, RequestID: "next-text", Messages: []publicChatMessagePayload{{Role: "user", Content: "a new question"}}}
	second, err := svc.publicChatRuntime().handleTurnRequestWithID(context.Background(), &runtimev1.AppMessageEvent{FromAppId: "desktop.app", SubjectUserId: "user-1"}, req)
	if err != nil {
		t.Fatalf("new text rejected while old media runs: %v", err)
	}
	select {
	case <-nextEntered:
	case <-time.After(3 * time.Second):
		t.Fatal("new text did not start")
	}
	decision := localAppConversationDecision(accountservice.LocalAppOperationInterruptConversation, 0x51, "user-1")
	interrupted, err := svc.InterruptLocalAppConversationTurn(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.InterruptLocalAppConversationTurnRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchorID, ExpectedTurnId: &first})
	if err != nil || interrupted.GetTurnId() != first {
		t.Fatalf("old media stop=%+v err=%v", interrupted, err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnInterruptedType)
	svc.chatSurfaceMu.Lock()
	anchor = svc.chatAnchors[anchorID]
	active := anchor.ActiveTurnID
	firstSaved := publicChatHasCompleteAnswer(anchor, first)
	newLive := svc.chatTurns[second]
	clobbered := newLive == nil || newLive.Interrupted
	svc.chatSurfaceMu.Unlock()
	if active != second || !firstSaved || clobbered {
		t.Fatalf("old tail damaged new turn or saved reply: active=%s new=%s saved=%v clobbered=%v", active, second, firstSaved, clobbered)
	}
	select {
	case <-nextCanceled:
		t.Fatal("next input canceled old media or old media canceled next input")
	default:
	}
	close(nextRelease)
	waitForPublicChatAsyncDrain(t, svc)
}

func TestStopCancelsEvenWhenAcknowledgementCannotPublish(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	turnID := reserveConversationPublicationTestTurn(t, svc, anchorID)
	canceled := false
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turnID].Cancel = func() { canceled = true }
	svc.chatSurfaceMu.Unlock()
	svc.chatSurfaceMu.Lock()
	// Exhausted publication sequence makes acknowledgement fail after Stop is accepted.
	svc.chatAnchors[anchorID].LocalAppSequence = ^uint64(0)
	svc.chatSurfaceMu.Unlock()
	_, err := (publicChatRuntime{svc: svc}).handleTurnInterruptWithID(&runtimev1.AppMessageEvent{FromAppId: "desktop.app", SubjectUserId: "user-1"}, publicChatTurnInterruptPayload{ConversationAnchorID: anchorID, ExpectedTurnID: turnID, Reason: "user_cancel"})
	if err == nil || !canceled {
		t.Fatalf("stop must cancel and report save failure: canceled=%v err=%v", canceled, err)
	}
}

func TestProtectedStopAcknowledgesCapturedTurnAfterSynchronousRelease(t *testing.T) {
	for _, replace := range []bool{false, true} {
		name := "released"
		if replace {
			name = "released and replaced"
		}
		t.Run(name, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			turnID := reserveConversationPublicationTestTurn(t, svc, anchorID)
			capture := newPublicChatEmitCapture()
			svc.SetPublicChatAppEmitter(capture.emit)
			var nextID string
			canceled := false
			svc.chatSurfaceMu.Lock()
			streamID := svc.chatTurns[turnID].StreamID
			svc.chatTurns[turnID].Cancel = func() {
				canceled = true
				// Deterministically win the race: real owner release before ACK dispatch.
				svc.publicChatRuntime().releaseTurn(anchorID, turnID)
				if replace {
					nextID = reserveConversationPublicationTestTurn(t, svc, anchorID)
				}
			}
			svc.chatSurfaceMu.Unlock()
			decision := localAppConversationDecision(accountservice.LocalAppOperationInterruptConversation, 0x51, "user-1")
			response, err := svc.InterruptLocalAppConversationTurn(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.InterruptLocalAppConversationTurnRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchorID, ExpectedTurnId: &turnID})
			if err != nil || response.GetTurnId() != turnID || !canceled {
				t.Fatalf("stop=%v err=%v canceled=%v", response, err, canceled)
			}
			ack := publicChatPayloadMap(t, capture.waitForMessageType(t, publicChatTurnInterruptAckType))
			if ack["stream_id"] != streamID || ack["turn_id"] != turnID {
				t.Fatalf("ACK lost original owner identity: %+v", ack)
			}
			timeline := ack["timeline"].(map[string]any)
			if timeline["stream_id"] != streamID || timeline["turn_id"] != turnID {
				t.Fatal("timeline used a fabricated or replacement identity")
			}
			svc.chatSurfaceMu.Lock()
			if svc.chatTurns[turnID] != nil {
				t.Error("ACK recreated the released turn")
			}
			if replace && (svc.chatTurns[nextID] == nil || svc.chatTurns[nextID].Interrupted || svc.chatAnchors[anchorID].ActiveTurnID != nextID) {
				t.Error("late ACK altered the next turn")
			}
			svc.chatSurfaceMu.Unlock()
		})
	}
}
