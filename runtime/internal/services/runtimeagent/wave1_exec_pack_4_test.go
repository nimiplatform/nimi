package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestWave1RemediationAConversationAnchorMetadataCommittedAndRecovered(t *testing.T) {
	t.Parallel()

	localStatePath := t.TempDir() + "/local-state.json"
	svc, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)

	metadata, err := structpb.NewStruct(map[string]any{
		"surface": "desktop.chat",
		"flags": map[string]any{
			"voice_enabled": false,
			"compact_mode":  true,
		},
		"tags": []any{"live2d", "companion"},
	})
	if err != nil {
		t.Fatalf("structpb.NewStruct(metadata): %v", err)
	}

	openResp, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       &runtimev1.AgentRequestContext{AppId: "desktop.app", SubjectUserId: "user-1"},
		AgentId:       "agent-alpha",
		SubjectUserId: "user-1",
		Metadata:      metadata,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor: %v", err)
	}
	anchorID := strings.TrimSpace(openResp.GetSnapshot().GetAnchor().GetConversationAnchorId())
	if anchorID == "" {
		t.Fatal("expected committed conversation_anchor_id")
	}
	if !proto.Equal(openResp.GetSnapshot().GetAnchor().GetMetadata(), metadata) {
		t.Fatalf("open snapshot metadata mismatch: got=%v want=%v", openResp.GetSnapshot().GetAnchor().GetMetadata(), metadata)
	}

	currentResp, err := svc.GetConversationAnchorSnapshot(context.Background(), &runtimev1.GetConversationAnchorSnapshotRequest{
		AgentId:              "agent-alpha",
		ConversationAnchorId: anchorID,
	})
	if err != nil {
		t.Fatalf("GetConversationAnchorSnapshot(current): %v", err)
	}
	if !proto.Equal(currentResp.GetSnapshot().GetAnchor().GetMetadata(), metadata) {
		t.Fatalf("current snapshot metadata mismatch: got=%v want=%v", currentResp.GetSnapshot().GetAnchor().GetMetadata(), metadata)
	}

	closeFirst()

	recoveredSvc, closeRecovered := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	defer closeRecovered()

	recoveredResp, err := recoveredSvc.GetConversationAnchorSnapshot(context.Background(), &runtimev1.GetConversationAnchorSnapshotRequest{
		AgentId:              "agent-alpha",
		ConversationAnchorId: anchorID,
	})
	if err != nil {
		t.Fatalf("GetConversationAnchorSnapshot(recovered): %v", err)
	}
	if !proto.Equal(recoveredResp.GetSnapshot().GetAnchor().GetMetadata(), metadata) {
		t.Fatalf("recovered snapshot metadata mismatch: got=%v want=%v", recoveredResp.GetSnapshot().GetAnchor().GetMetadata(), metadata)
	}
}

func TestWave1ExecPack4ConversationAnchorRecoveryAndIsolation(t *testing.T) {
	t.Parallel()

	localStatePath := t.TempDir() + "/local-state.json"
	svc, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	var err error

	if _, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		AgentId:     "agent-beta",
		DisplayName: "Beta",
	}); err != nil {
		t.Fatalf("InitializeAgent(agent-beta): %v", err)
	}

	anchorA1 := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	anchorA2 := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	anchorB1 := openPublicChatTestAnchor(t, svc, "agent-beta", "desktop.app", "user-1")

	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	release := make(chan struct{})
	callCount := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			callCount++
			currentCall := callCount
			traceID := fmt.Sprintf("trace-exec-pack-4-%d", currentCall)
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   traceID,
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if currentCall == 1 {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-release:
				}
			}
			envelope := publicChatStructuredEnvelopeJSON(
				fmt.Sprintf("message-pack4-%d", currentCall),
				fmt.Sprintf("reply-%d", currentCall),
			)
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   traceID,
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
				TraceId:   traceID,
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorA1,
			"thread_id":              "thread-exec-pack-4-anchor-a1",
			"messages": []any{
				map[string]any{"role": "user", "content": "anchor A1"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(anchor A1): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	activeTurnID := strings.TrimSpace(publicChatPayloadMap(t, accepted)["turn_id"].(string))
	activeStreamID := strings.TrimSpace(publicChatPayloadMap(t, accepted)["stream_id"].(string))

	activeAnchorSnapshot, err := svc.GetConversationAnchorSnapshot(context.Background(), &runtimev1.GetConversationAnchorSnapshotRequest{
		AgentId:              "agent-alpha",
		ConversationAnchorId: anchorA1,
	})
	if err != nil {
		t.Fatalf("GetConversationAnchorSnapshot(active): %v", err)
	}
	if got := activeAnchorSnapshot.GetSnapshot().GetActiveTurnId(); got != activeTurnID {
		t.Fatalf("expected active_turn_id=%s, got %s", activeTurnID, got)
	}
	if got := activeAnchorSnapshot.GetSnapshot().GetActiveStreamId(); got != activeStreamID {
		t.Fatalf("expected active_stream_id=%s, got %s", activeStreamID, got)
	}
	if activeTurnID == activeStreamID {
		t.Fatalf("active_stream_id must stay distinct from turn_id, got turn=%s stream=%s", activeTurnID, activeStreamID)
	}

	close(release)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-beta",
			"conversation_anchor_id": anchorB1,
			"thread_id":              "thread-exec-pack-4-anchor-b1",
			"messages": []any{
				map[string]any{"role": "user", "content": "anchor B1"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(anchor B1): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	anchorA1Snap := requestPublicChatSessionSnapshot(t, svc, capture, anchorA1, "snapshot-pack4-a1")
	anchorA2Snap := requestPublicChatSessionSnapshot(t, svc, capture, anchorA2, "snapshot-pack4-a2")
	anchorB1Snap := requestPublicChatSessionSnapshot(t, svc, capture, anchorB1, "snapshot-pack4-b1")

	if got := publicChatLastTurnSnapshot(t, anchorA1Snap)["text"]; got != "reply-1" {
		t.Fatalf("expected anchor A1 last turn text reply-1, got=%v", publicChatLastTurnSnapshot(t, anchorA1Snap))
	}
	if _, present := publicChatSessionSnapshotDetail(t, anchorA2Snap)["last_turn"]; present {
		t.Fatalf("expected untouched anchor A2 snapshot to remain empty, got=%v", publicChatSessionSnapshotDetail(t, anchorA2Snap))
	}
	if got := publicChatLastTurnSnapshot(t, anchorB1Snap)["text"]; got != "reply-2" {
		t.Fatalf("expected anchor B1 last turn text reply-2, got=%v", publicChatLastTurnSnapshot(t, anchorB1Snap))
	}

	closeFirst()

	recoveredSvc, closeRecovered := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	defer closeRecovered()
	recoveredCapture := newPublicChatEmitCapture()
	recoveredSvc.SetPublicChatAppEmitter(recoveredCapture.emit)

	recoveredA1, err := recoveredSvc.GetConversationAnchorSnapshot(context.Background(), &runtimev1.GetConversationAnchorSnapshotRequest{
		AgentId:              "agent-alpha",
		ConversationAnchorId: anchorA1,
	})
	if err != nil {
		t.Fatalf("GetConversationAnchorSnapshot(recovered A1): %v", err)
	}
	if got := recoveredA1.GetSnapshot().GetAnchor().GetLastTurnId(); got != activeTurnID {
		t.Fatalf("expected recovered last_turn_id=%s, got %s", activeTurnID, got)
	}
	if got := recoveredA1.GetSnapshot().GetAnchor().GetLastMessageId(); got != "message-pack4-1" {
		t.Fatalf("expected recovered last_message_id=message-pack4-1, got %s", got)
	}
	if got := recoveredA1.GetSnapshot().GetActiveTurnId(); got != "" {
		t.Fatalf("expected no active turn after restart, got %s", got)
	}
	if got := recoveredA1.GetSnapshot().GetActiveStreamId(); got != "" {
		t.Fatalf("expected no active stream after restart, got %s", got)
	}

	recoveredA2, err := recoveredSvc.GetConversationAnchorSnapshot(context.Background(), &runtimev1.GetConversationAnchorSnapshotRequest{
		AgentId:              "agent-alpha",
		ConversationAnchorId: anchorA2,
	})
	if err != nil {
		t.Fatalf("GetConversationAnchorSnapshot(recovered A2): %v", err)
	}
	if got := recoveredA2.GetSnapshot().GetAnchor().GetLastTurnId(); got != "" {
		t.Fatalf("expected untouched anchor A2 to remain empty after restart, got %s", got)
	}

	recoveredB1, err := recoveredSvc.GetConversationAnchorSnapshot(context.Background(), &runtimev1.GetConversationAnchorSnapshotRequest{
		AgentId:              "agent-beta",
		ConversationAnchorId: anchorB1,
	})
	if err != nil {
		t.Fatalf("GetConversationAnchorSnapshot(recovered B1): %v", err)
	}
	if got := recoveredB1.GetSnapshot().GetAnchor().GetLastMessageId(); got != "message-pack4-2" {
		t.Fatalf("expected recovered B1 last_message_id=message-pack4-2, got %s", got)
	}

	recoveredSession := requestPublicChatSessionSnapshot(t, recoveredSvc, recoveredCapture, anchorA1, "snapshot-pack4-recovered-a1")
	recoveredLastTurn := publicChatLastTurnSnapshot(t, recoveredSession)
	if got := recoveredLastTurn["message_id"]; got != "message-pack4-1" {
		t.Fatalf("expected recovered session snapshot message_id=message-pack4-1, got=%v", recoveredLastTurn)
	}
	if got := recoveredLastTurn["text"]; got != "reply-1" {
		t.Fatalf("expected recovered session snapshot text=reply-1, got=%v", recoveredLastTurn)
	}
}

func TestWave1ExecPack4InterruptIsolationRejectsWrongAnchor(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorA1 := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	anchorA2 := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	var err error
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-pack4-interrupt",
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

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorA1,
			"messages": []any{
				map[string]any{"role": "user", "content": "hold"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	turnPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(turnPayload["turn_id"].(string))

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnInterruptType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorA2,
			"turn_id":                turnID,
			"reason":                 "wrong_anchor",
		}),
	})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("expected NotFound for wrong-anchor interrupt, got err=%v code=%v", err, status.Code(err))
	}

	stateResp, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{AgentId: "agent-alpha"})
	if err != nil {
		t.Fatalf("GetAgentState(after wrong interrupt): %v", err)
	}
	if got := stateResp.GetState().GetExecutionState(); got != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE {
		t.Fatalf("expected CHAT_ACTIVE after wrong-anchor interrupt, got %s", got)
	}

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnInterruptType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorA1,
			"turn_id":                turnID,
			"reason":                 "user_cancelled",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(correct interrupt): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnInterruptAckType)
	_ = capture.waitForMessageType(t, publicChatTurnInterruptedType)
}

func TestWave1RemediationATrimHookLifecycleDoesNotEmitExecutionStateSpread(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-pack4-hook-origin",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	now := time.Now().UTC()
	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	if err := svc.admitPendingHook("agent-pack4-hook-origin", newTestTimePendingHook(t, "hook-pack4-origin", "agent-pack4-hook-origin", now.Add(time.Minute), now)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}
	if _, err := svc.markHookRunning("agent-pack4-hook-origin", "hook-pack4-origin"); err != nil {
		t.Fatalf("markHookRunning: %v", err)
	}
	if _, err := svc.CancelHook(ctx, &runtimev1.CancelHookRequest{
		AgentId:  "agent-pack4-hook-origin",
		IntentId: "hook-pack4-origin",
		Reason:   "operator stop",
	}); err != nil {
		t.Fatalf("CancelHook: %v", err)
	}

	streamCtx, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
	defer cancel()
	stream := newAgentEventCaptureStreamLimit(streamCtx, 5)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId: "agent-pack4-hook-origin",
		Cursor:  encodeCursor(cursor),
	}, stream); err != context.Canceled && err != context.DeadlineExceeded {
		t.Fatalf("SubscribeAgentEvents: %v", err)
	}
	if len(stream.events) != 4 {
		t.Fatalf("expected 4 hook events without execution_state_changed spread, got %d", len(stream.events))
	}

	wantFamilies := []runtimev1.HookAdmissionState{
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED,
	}
	for i, event := range stream.events {
		if event.GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK {
			t.Fatalf("expected hook-only backlog after trim, got %#v", event)
		}
		if got := event.GetHook().GetFamily(); got != wantFamilies[i] {
			t.Fatalf("unexpected hook family at index %d: got %s want %s", i, got, wantFamilies[i])
		}
		intent := event.GetHook().GetIntent()
		if strings.TrimSpace(intent.GetConversationAnchorId()) != "" ||
			strings.TrimSpace(intent.GetOriginatingTurnId()) != "" ||
			strings.TrimSpace(intent.GetOriginatingStreamId()) != "" {
			t.Fatalf("no-origin hook event must not fabricate linkage, got %#v", intent)
		}
	}
}

func TestWave1ExecPack4ChatTrackHookProposalUsesCanonicalHookLifecycle(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-pack4-chat-track",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{
		result: &ChatTrackSidecarResult{
			NextHookIntent: &runtimev1.HookIntent{
				IntentId:       "hook-pack4-chat-track",
				TriggerFamily:  runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
				TriggerDetail:  timeTriggerDetail(5 * time.Minute),
				Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
				AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
			},
		},
	})

	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	if err := svc.ExecuteChatTrackSidecar(ctx, ChatTrackSidecarExecutionRequest{
		AgentID:       "agent-pack4-chat-track",
		SourceEventID: "chat-turn-pack4",
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "follow up later"},
		},
	}); err != nil {
		t.Fatalf("ExecuteChatTrackSidecar: %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:              "agent-pack4-chat-track",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(pending): %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 || pendingResp.GetHooks()[0].GetIntent().GetIntentId() != "hook-pack4-chat-track" {
		t.Fatalf("expected canonical pending hook from chat-track path, got %#v", pendingResp.GetHooks())
	}

	hookStream := newAgentEventCaptureStreamLimit(ctx, 2)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId:      "agent-pack4-chat-track",
		Cursor:       encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK},
	}, hookStream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(hook): %v", err)
	}
	if len(hookStream.events) != 2 {
		t.Fatalf("expected proposed+pending hook events from chat-track path, got %d", len(hookStream.events))
	}
	if got := hookStream.events[0].GetHook().GetFamily(); got != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED {
		t.Fatalf("expected proposed hook family first, got %s", got)
	}
	if got := hookStream.events[1].GetHook().GetFamily(); got != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
		t.Fatalf("expected pending hook family second, got %s", got)
	}
}

func TestWave1ExecPack4NegativeIngressAndNoAPMLConsumerPath(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeWithFollowUpJSON("message-pack4-hook", "hook me later", "action-pack4-hook", "follow up", 300)
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-pack4-hook",
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
				TraceId:   "trace-pack4-hook",
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
				TraceId:   "trace-pack4-hook",
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
				map[string]any{"role": "user", "content": "propose follow up"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
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

	requirePublicChatPostTurnHookIntent(t, postTurn, "action-pack4-hook", "pending", 300)

	// Mandatory negative proof from the parent packet: observing
	// turn.post_turn.detail.hook_intent alone must NOT drive canonical hook
	// lifecycle truth. The indication is emitted, but runtime.agent.hook.*
	// remains empty unless a real admitted hook path commits it.
	pendingResp, err := svc.ListPendingHooks(context.Background(), &runtimev1.ListPendingHooksRequest{
		AgentId:              "agent-alpha",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(after post_turn indication): %v", err)
	}
	if len(pendingResp.GetHooks()) != 0 {
		t.Fatalf("post_turn.detail.hook_intent must not create canonical pending hook truth, got %#v", pendingResp.GetHooks())
	}
	hookCtx, cancelHooks := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancelHooks()
	hookStream := newAgentEventCaptureStreamLimit(hookCtx, 1)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId:      "agent-alpha",
		Cursor:       encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK},
	}, hookStream); err != context.DeadlineExceeded && err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(hook after post_turn indication): %v", err)
	}
	if len(hookStream.events) != 0 {
		t.Fatalf("post_turn.detail.hook_intent must not emit runtime.agent.hook.* truth by itself, got %#v", hookStream.events)
	}

	capture.mu.Lock()
	for _, item := range capture.items {
		if strings.HasPrefix(item.GetMessageType(), "apml.") {
			capture.mu.Unlock()
			t.Fatalf("normal runtime consumer path must not emit raw apml.*, got %s", item.GetMessageType())
		}
	}
	capture.mu.Unlock()

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "missing agent id"},
			},
		}),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for implicit/default-agent routing attempt, got err=%v code=%v", err, status.Code(err))
	}
	if err == nil || !strings.Contains(err.Error(), "requires agent_id") {
		t.Fatalf("expected agent_id requirement failure, got %v", err)
	}
}
