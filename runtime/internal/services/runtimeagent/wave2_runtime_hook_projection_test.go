package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestWave2PublicChatEventHookProjectsRejectedRuntimeHookTruth(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := `<message id="message-wave2-event">I can follow up when you pause.</message><event-hook id="action-wave2-event"><event-user-idle idle-for="120s"/><effect kind="follow-up-turn"><prompt-text>continue after idle</prompt-text></effect></event-hook>`
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-wave2-event-hook",
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
				TraceId:   "trace-wave2-event-hook",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-wave2-event-hook",
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
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "propose idle follow up"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(turn): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	postTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	hookIntent := publicChatPostTurnHookIntent(t, postTurn)
	if got := hookIntent["intent_id"]; got != "action-wave2-event" {
		t.Fatalf("expected event hook intent id action-wave2-event, got=%v", hookIntent)
	}
	if got := hookIntent["trigger_family"]; got != "event" {
		t.Fatalf("expected event trigger family, got=%v", hookIntent)
	}
	if got := hookIntent["admission_state"]; got != "rejected" {
		t.Fatalf("expected rejected event hook indication, got=%v", hookIntent)
	}

	hookStream := newAgentEventCaptureStreamLimit(context.Background(), 2)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId:      "agent-alpha",
		Cursor:       encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK},
	}, hookStream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(hook): %v", err)
	}
	if len(hookStream.events) != 2 {
		t.Fatalf("expected proposed+rejected event hook projections, got %#v", hookStream.events)
	}
	for index, want := range []runtimev1.HookAdmissionState{
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED,
	} {
		detail := hookStream.events[index].GetHook()
		if got := detail.GetFamily(); got != want {
			t.Fatalf("unexpected hook event family at index %d: got %s want %s", index, got, want)
		}
		intent := detail.GetIntent()
		if got := strings.TrimSpace(intent.GetConversationAnchorId()); got != anchorID {
			t.Fatalf("expected projected anchor %s, got %#v", anchorID, intent)
		}
		if got := strings.TrimSpace(intent.GetOriginatingTurnId()); got != turnID {
			t.Fatalf("expected projected turn %s, got %#v", turnID, intent)
		}
		if got := strings.TrimSpace(intent.GetOriginatingStreamId()); got != streamID {
			t.Fatalf("expected projected stream %s, got %#v", streamID, intent)
		}
		if intent.GetTriggerFamily() != runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT || intent.GetTriggerDetail().GetEventUserIdle() == nil {
			t.Fatalf("expected event/user-idle HookIntent projection, got %#v", intent)
		}
	}
	if got := hookStream.events[1].GetHook().GetReasonCode(); got != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("expected rejected event hook reason AI_OUTPUT_INVALID, got %s", got)
	}

	pendingResp, err := svc.ListPendingHooks(context.Background(), &runtimev1.ListPendingHooksRequest{
		AgentId:              "agent-alpha",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 0 {
		t.Fatalf("event hook rejection must not create life-track pending hook truth, got %#v", pendingResp.GetHooks())
	}

	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-wave2-event-hook")
	snapshotDetail := publicChatSessionSnapshotDetail(t, snapshot)
	if _, present := snapshotDetail["pending_follow_up"]; present {
		t.Fatalf("event hook rejection must not create pending_follow_up, got=%v", snapshotDetail["pending_follow_up"])
	}
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	followUp, ok := lastTurn["follow_up"].(map[string]any)
	if !ok {
		t.Fatalf("expected last_turn.follow_up rejection truth, got=%v", lastTurn)
	}
	if got := followUp["status"]; got != "rejected" {
		t.Fatalf("expected rejected follow_up status, got=%v", followUp)
	}
	if got := followUp["reason_code"]; got != runtimev1.ReasonCode_AI_OUTPUT_INVALID.String() {
		t.Fatalf("expected AI_OUTPUT_INVALID follow_up reason, got=%v", followUp)
	}
}
