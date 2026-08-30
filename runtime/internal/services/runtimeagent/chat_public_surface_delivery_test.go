package runtimeagent

import (
	"context"
	"fmt"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func assertPublicChatDeltaPrecedesCommit(t *testing.T, capture *publicChatEmitCapture) {
	t.Helper()
	emittedTypes := capture.messageTypes()
	deltaIndex, committedIndex := -1, -1
	for index, messageType := range emittedTypes {
		switch messageType {
		case publicChatTurnTextDeltaType:
			deltaIndex = index
		case publicChatTurnMessageCommittedType:
			committedIndex = index
		}
	}
	if deltaIndex < 0 || committedIndex < 0 || deltaIndex >= committedIndex {
		t.Fatalf("text_delta must precede message_committed for the same turn; emitted=%v", emittedTypes)
	}
}

func TestPublicChatTurnMessageCommitDeliveryFailurePreservesDurableCommit(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(func(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		if req.GetMessageType() == publicChatTurnMessageCommittedType {
			return nil, fmt.Errorf("message commit delivery rejected")
		}
		return capture.emit(ctx, req)
	})
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-commit-failure",
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
				TraceId:   "trace-commit-failure",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: runtimeAgentTextStreamDelta(

						publicChatStructuredEnvelopeAPML("message-commit-failure", "must not complete")),
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-commit-failure",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
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
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	for _, messageType := range capture.messageTypes() {
		switch messageType {
		case publicChatTurnFailedType,
			publicChatTurnInterruptedType:
			t.Fatalf("legacy sideband failure emitted canonical failure %s; emitted=%v", messageType, capture.messageTypes())
		}
	}
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-commit-failure")
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if got := lastTurn["status"]; got != publicChatTurnStatusCompleted {
		t.Fatalf("durably committed turn must remain completed after delivery failure, got=%v", lastTurn)
	}
	if got := publicChatSessionSnapshotDetail(t, snapshot)["transcript_message_count"]; got != float64(2) {
		t.Fatalf("message delivery failure must not erase durable transcript, got snapshot=%v", publicChatSessionSnapshotDetail(t, snapshot))
	}
}
