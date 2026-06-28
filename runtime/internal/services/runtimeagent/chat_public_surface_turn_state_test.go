package runtimeagent

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"testing"
	"time"
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
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_bindings": map[string]any{"text.generate": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			}},
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
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope[:splitAt]},
						},
					},
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
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope[splitAt:]},
						},
					},
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
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-session-snapshot",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_bindings": map[string]any{"text.generate": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			}},
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
	assistantMemory := lastTurn["assistant_memory"].(map[string]any)
	if got := assistantMemory["status"]; got != "skipped" {
		t.Fatalf("expected assistant memory skipped without committed verdict evidence, got=%v", assistantMemory)
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
