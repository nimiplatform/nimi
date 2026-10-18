package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestPublicChatEventHookRejectsWithoutHostEventDetector(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := `<message id="message-event-hook">I can follow up when you pause.</message><event-hook id="action-event-hook"><event-user-idle idle-for="120s"/><effect kind="follow-up-turn"><prompt-text>continue after idle</prompt-text></effect></event-hook>`
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-event-hook",
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
				TraceId:   "trace-event-hook",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: runtimeAgentTextStreamDelta(

						envelope),
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-event-hook",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
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
				map[string]any{"role": "user", "content": "propose idle follow up"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(turn): %v", err)
	}

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	postTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	if _, exists := publicChatTurnDetail(t, postTurn)["hook_intent"]; exists {
		t.Fatal("unsupported model control was presented as an admitted intent")
	}
	hookEvents := retainedAgentEventsForTest(t, svc, "agent-alpha", cursor, runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK)
	if len(hookEvents) != 0 {
		t.Fatalf("unsupported control created hook lifecycle: %#v", hookEvents)
	}

	pendingResp, err := svc.ListPendingHooks(context.Background(), &runtimev1.ListPendingHooksRequest{
		Context:              testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId:              "agent-alpha",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 0 {
		t.Fatalf("public chat event hook must not create life-track pending hook truth, got %#v", pendingResp.GetHooks())
	}

	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-event-hook")
	snapshotDetail := publicChatSessionSnapshotDetail(t, snapshot)
	if _, present := snapshotDetail["pending_follow_up"]; present {
		t.Fatalf("rejected event hook must not create pending_follow_up, got=%v", snapshotDetail)
	}
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if lastTurn["status"] != publicChatTurnStatusCompleted || lastTurn["text"] != "I can follow up when you pause." {
		t.Fatalf("unsupported control erased completed body: %#v", lastTurn)
	}
	if lastTurn["reason_code"] != runtimev1.ReasonCode_AI_OUTPUT_INVALID.String() {
		t.Fatalf("control rejection must be reported: %#v", lastTurn)
	}
}
