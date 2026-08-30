package runtimeagent

import (
	"context"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type blockingFirstChatTrackSidecarExecutor struct {
	entered     chan struct{}
	release     <-chan struct{}
	callerAppID chan string
	once        sync.Once
}

func (e *blockingFirstChatTrackSidecarExecutor) ExecuteChatTrackSidecar(_ context.Context, req *ChatTrackSidecarExecutorRequest) (*ChatTrackSidecarResult, error) {
	e.once.Do(func() {
		if e.callerAppID != nil {
			e.callerAppID <- req.CallerAppID
		}
		close(e.entered)
		<-e.release
	})
	return &ChatTrackSidecarResult{}, nil
}

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
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
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
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
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
	if got := lastTurn["message_id"]; got != "message-snapshot" {
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
	chatSidecar := lastTurn["chat_sidecar"].(map[string]any)
	if _, present := chatSidecar["accepted_memory_count"]; present {
		t.Fatalf("retired sidecar Memory count persisted in last_turn: %v", chatSidecar)
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

func TestPublicChatCommittedSnapshotRemainsActiveUntilTerminalDeliveryReleasesReservation(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	sidecarEntered := make(chan struct{})
	sidecarRelease := make(chan struct{})
	sidecarCallerAppID := make(chan string, 1)
	svc.SetChatTrackSidecarExecutor(&blockingFirstChatTrackSidecarExecutor{
		entered:     sidecarEntered,
		release:     sidecarRelease,
		callerAppID: sidecarCallerAppID,
	})

	var executionIndex uint32
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			index := atomic.AddUint32(&executionIndex, 1)
			envelope := publicChatStructuredEnvelopeAPML("message-terminal-boundary-"+strconv.FormatUint(uint64(index), 10), "terminal boundary reply")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-terminal-boundary",
				Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "qwen3-chat",
					RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				}},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-terminal-boundary",
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDelta(
					envelope)},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-terminal-boundary",
				Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				}},
			})
		},
	})

	request := func(requestID string, content string) *runtimev1.AppMessageEvent {
		return &runtimev1.AppMessageEvent{
			ToAppId:       publicChatRuntimeAppID,
			FromAppId:     "desktop.app",
			SubjectUserId: "user-1",
			MessageId:     requestID,
			MessageType:   publicChatTurnRequestType,
			Payload: publicChatStructPayload(t, map[string]any{
				"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
				"owner_user_id":          "user-1",
				"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
				"conversation_anchor_id": anchorID,
				"request_id":             requestID,
				"messages": []any{map[string]any{
					"role": "user", "content": content,
				}},
			}),
		}
	}
	immediateNextRequest := request("request-immediate-next", "start immediately after terminal")
	immediateNextResult := make(chan error, 1)
	var terminalCallbackOnce sync.Once
	svc.SetPublicChatAppEmitter(func(ctx context.Context, emitted *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		response, err := capture.emit(ctx, emitted)
		if err == nil && emitted.GetMessageType() == publicChatTurnCompletedType {
			terminalCallbackOnce.Do(func() {
				immediateNextResult <- svc.ConsumePublicChatAppMessage(context.Background(), immediateNextRequest)
			})
		}
		return response, err
	})

	if err := svc.ConsumePublicChatAppMessage(context.Background(), request("request-first", "finish with a blocking sidecar")); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	select {
	case <-sidecarEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for post-turn sidecar")
	}
	select {
	case callerAppID := <-sidecarCallerAppID:
		if callerAppID != "desktop.app" {
			t.Fatalf("post-turn sidecar caller app id = %q", callerAppID)
		}
	default:
		t.Fatal("post-turn sidecar did not receive the canonical Conversation caller App identity")
	}

	committedSnapshot := publicChatSessionSnapshotDetail(t, requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-committed"))
	if got := committedSnapshot["session_status"]; got != "turn_active" {
		t.Fatalf("committed message must remain turn_active until terminal delivery, got=%v", committedSnapshot)
	}
	activeTurn, ok := committedSnapshot["active_turn"].(map[string]any)
	if !ok || activeTurn["status"] != publicChatTurnStatusCommitted {
		t.Fatalf("expected active committed turn while sidecar runs, got=%v", committedSnapshot)
	}
	if _, exists := committedSnapshot["last_turn"]; exists {
		t.Fatalf("committed message must not fabricate terminal last_turn before post-turn completion: %v", committedSnapshot)
	}
	if err := svc.ConsumePublicChatAppMessage(context.Background(), request("request-blocked", "must remain blocked before terminal")); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected pre-terminal request to remain blocked, got %v", err)
	}

	close(sidecarRelease)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	select {
	case err := <-immediateNextResult:
		if err != nil {
			t.Fatalf("terminal callback observed unreleased reservation: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for immediate post-terminal request")
	}
}
