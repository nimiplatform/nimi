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

func TestConversationAnchorMetadataCommittedAndRecovered(t *testing.T) {
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
		Context:          testRuntimeAgentIdentityContext("agent-alpha"),
		LocalAgentRef:    testRuntimeAgentLocalRef("agent-alpha"),
		OwnerUserId:      "user-1",
		RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"),
		SubjectUserId:    "user-1",
		Metadata:         metadata,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor: %v", err)
	}
	anchorID := strings.TrimSpace(openResp.GetSnapshot().GetAnchor().GetConversationAnchorId())
	if anchorID == "" {
		t.Fatal("expected committed conversation_anchor_id")
	}
	openedAnchor, ok := svc.publicChatAnchorSnapshot(anchorID)
	if !ok || strings.TrimSpace(openedAnchor.ThreadID) == "" {
		t.Fatal("OpenConversationAnchor must allocate a Runtime-owned thread id before the first turn")
	}
	openedThreadID := strings.TrimSpace(openedAnchor.ThreadID)
	if !proto.Equal(openResp.GetSnapshot().GetAnchor().GetMetadata(), metadata) {
		t.Fatalf("open snapshot metadata mismatch: got=%v want=%v", openResp.GetSnapshot().GetAnchor().GetMetadata(), metadata)
	}

	currentResp, err := svc.GetConversationAnchorSnapshot(context.Background(), &runtimev1.GetConversationAnchorSnapshotRequest{
		Context:              testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
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
		Context:              testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
	})
	if err != nil {
		t.Fatalf("GetConversationAnchorSnapshot(recovered): %v", err)
	}
	if !proto.Equal(recoveredResp.GetSnapshot().GetAnchor().GetMetadata(), metadata) {
		t.Fatalf("recovered snapshot metadata mismatch: got=%v want=%v", recoveredResp.GetSnapshot().GetAnchor().GetMetadata(), metadata)
	}
	recoveredAnchor, ok := recoveredSvc.publicChatAnchorSnapshot(anchorID)
	if !ok || strings.TrimSpace(recoveredAnchor.ThreadID) != openedThreadID {
		t.Fatalf("Runtime-owned thread id did not recover with anchor: got=%q want=%q", recoveredAnchor.ThreadID, openedThreadID)
	}
}

func TestPublicChatLegacyMultiAnchorFailsClosedAndDifferentAgentIsolation(t *testing.T) {
	t.Parallel()

	localStatePath := t.TempDir() + "/local-state.json"
	svc, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	defer closeFirst()
	var err error

	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-beta"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization(agent-beta): %v", err)
	}
	upsertPublicChatTestAgentAIConfigForContext(t, svc, testRuntimeAgentIdentityContext("agent-beta"))

	anchorA1 := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	anchorA2 := addLegacyPublicChatTestAnchor(
		t, svc, anchorA1, "agent_anchor_legacy_older", time.Now().UTC().Add(-time.Hour),
		testPublicChatCommittedTranscript([2]string{"legacy prompt", "legacy reply"}),
	)
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
			envelope := publicChatStructuredEnvelopeAPML(
				fmt.Sprintf("message-pack4-%d", currentCall),
				fmt.Sprintf("reply-%d", currentCall),
			)
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   traceID,
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: runtimeAgentTextStreamDelta(

						envelope),
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorA1,
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorA1),
			"messages": []any{
				map[string]any{"role": "user", "content": "anchor A1"},
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
		Context:              testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-beta"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-beta"),
			"conversation_anchor_id": anchorB1,
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorB1),
			"messages": []any{
				map[string]any{"role": "user", "content": "anchor B1"},
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

	if err := svc.loadPublicChatSurfaceStateFromDB(); err == nil ||
		!strings.Contains(err.Error(), "explicit offline repair") {
		t.Fatalf("legacy duplicate durable anchors must fail closed without startup migration, got %v", err)
	}
	if got := svc.chatAnchors[anchorA2]; got == nil ||
		got.Status != runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE ||
		len(got.CommittedTranscript) != 1 {
		t.Fatalf("failed duplicate load mutated the legacy anchor: %+v", got)
	}
	if got := svc.chatAnchors[anchorB1]; got == nil || got.LastMessageID != "message-pack4-2" {
		t.Fatalf("failed duplicate load mutated the different-agent anchor: %+v", got)
	}
}

func addLegacyPublicChatTestAnchor(t *testing.T, svc *Service, sourceAnchorID string, legacyAnchorID string, updatedAt time.Time, transcript []publicChatCommittedTranscriptTurn) string {
	t.Helper()
	svc.chatSurfaceMu.Lock()
	legacy := clonePublicChatAnchorState(svc.chatAnchors[sourceAnchorID])
	if legacy == nil {
		svc.chatSurfaceMu.Unlock()
		t.Fatalf("source anchor %q not found", sourceAnchorID)
	}
	legacy.ConversationAnchorID = legacyAnchorID
	legacy.ThreadID = "agent_thread_" + legacyAnchorID
	legacy.ActiveTurnID = ""
	legacy.ActiveTurnSnapshot = nil
	legacy.LastTurnID = ""
	legacy.LastMessageID = ""
	legacy.LastTurnSnapshot = nil
	legacy.CompletedTurnSnapshots = nil
	legacy.PendingFollowUpID = ""
	legacy.Status = runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE
	legacy.CreatedAt = updatedAt.Add(-time.Minute)
	legacy.UpdatedAt = updatedAt
	legacy.CommittedTranscript = clonePublicChatCommittedTranscript(transcript)
	svc.chatAnchors[legacyAnchorID] = legacy
	svc.chatSurfaceMu.Unlock()
	svc.persistCurrentPublicChatSurfaceState()
	return legacyAnchorID
}

func TestPublicChatInterruptIsolationRejectsWrongAnchor(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorA1 := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	anchorA2 := addLegacyPublicChatTestAnchor(t, svc, anchorA1, "agent_anchor_legacy_interrupt", time.Now().UTC().Add(-time.Hour), nil)
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorA1,
			"messages": []any{
				map[string]any{"role": "user", "content": "hold"},
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
			"reason":                 "user_cancel",
		}),
	})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("expected NotFound for wrong-anchor interrupt, got err=%v code=%v", err, status.Code(err))
	}

	stateResp, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-alpha"), AgentId: "agent-alpha"})
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
			"reason":                 "user_cancel",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(correct interrupt): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnInterruptAckType)
	_ = capture.waitForMessageType(t, publicChatTurnInterruptedType)
}

func TestExecutionStateClosureEmitsOnlyAdmittedNoOriginLifecycleSeam(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := authenticatedRuntimeAgentTestContext(context.Background(), "user-1")
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-pack4-hook-origin"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	now := time.Now().UTC()
	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-pack4-hook-origin"), newTestTimePendingHook(t, "hook-pack4-origin", testRuntimeAgentLocalRef("agent-pack4-hook-origin"), now.Add(time.Minute), now)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}
	if _, err := svc.markHookRunning(testRuntimeAgentLocalRef("agent-pack4-hook-origin"), "hook-pack4-origin"); err != nil {
		t.Fatalf("markHookRunning: %v", err)
	}
	if _, err := svc.CancelHook(ctx, &runtimev1.CancelHookRequest{
		Context:  testRuntimeAgentIdentityContext("agent-pack4-hook-origin"),
		AgentId:  testRuntimeAgentLocalRef("agent-pack4-hook-origin"),
		IntentId: "hook-pack4-origin",
		Reason:   "operator stop",
	}); err != nil {
		t.Fatalf("CancelHook: %v", err)
	}

	events := retainedAgentEventsForTest(t, svc, "agent-pack4-hook-origin", cursor)
	if len(events) != 7 {
		t.Fatalf("expected 7 bounded lifecycle events after execution-state closure, got %d", len(events))
	}

	wantKinds := []struct {
		eventType runtimev1.AgentEventType
		hook      runtimev1.HookAdmissionState
		exec      runtimev1.AgentExecutionState
	}{
		{eventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK, hook: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED},
		{eventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK, hook: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING},
		{eventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE, exec: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING},
		{eventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK, hook: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING},
		{eventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE, exec: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_RUNNING},
		{eventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK, hook: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED},
		{eventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE, exec: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE},
	}
	for i, event := range events {
		if event.GetEventType() != wantKinds[i].eventType {
			t.Fatalf("unexpected event type at index %d: got %s want %s", i, event.GetEventType(), wantKinds[i].eventType)
		}
		switch event.GetEventType() {
		case runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK:
			if got := event.GetHook().GetFamily(); got != wantKinds[i].hook {
				t.Fatalf("unexpected hook family at index %d: got %s want %s", i, got, wantKinds[i].hook)
			}
			intent := event.GetHook().GetIntent()
			if strings.TrimSpace(intent.GetConversationAnchorId()) != "" ||
				strings.TrimSpace(intent.GetOriginatingTurnId()) != "" ||
				strings.TrimSpace(intent.GetOriginatingStreamId()) != "" {
				t.Fatalf("no-origin hook event must not fabricate linkage, got %#v", intent)
			}
		case runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE:
			detail := event.GetState()
			if detail.GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EXECUTION_STATE_CHANGED {
				t.Fatalf("expected execution_state_changed at index %d, got %#v", i, detail)
			}
			if got := detail.GetCurrentExecutionState(); got != wantKinds[i].exec {
				t.Fatalf("unexpected current execution state at index %d: got %s want %s", i, got, wantKinds[i].exec)
			}
			if strings.TrimSpace(detail.GetConversationAnchorId()) != "" ||
				strings.TrimSpace(detail.GetOriginatingTurnId()) != "" ||
				strings.TrimSpace(detail.GetOriginatingStreamId()) != "" {
				t.Fatalf("no-origin execution-state event must not fabricate linkage, got %#v", detail)
			}
		}
	}
}

func TestPublicChatTrackHookProposalUsesCanonicalHookLifecycle(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := authenticatedRuntimeAgentTestContext(context.Background(), "user-1")
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-pack4-chat-track"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	upsertPublicChatTestAgentAIConfigForContext(t, svc, testRuntimeAgentIdentityContext("agent-pack4-chat-track"))

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
		AgentID:       testRuntimeAgentLocalRef("agent-pack4-chat-track"),
		SourceEventID: "chat-turn-pack4",
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "follow up later"},
		},
	}); err != nil {
		t.Fatalf("ExecuteChatTrackSidecar: %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context:              testRuntimeAgentIdentityContext("agent-pack4-chat-track"),
		AgentId:              testRuntimeAgentLocalRef("agent-pack4-chat-track"),
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(pending): %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 || pendingResp.GetHooks()[0].GetIntent().GetIntentId() != "hook-pack4-chat-track" {
		t.Fatalf("expected canonical pending hook from chat-track path, got %#v", pendingResp.GetHooks())
	}

	hookEvents := retainedAgentEventsForTest(t, svc, "agent-pack4-chat-track", cursor, runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK)
	if len(hookEvents) != 2 {
		t.Fatalf("expected proposed+pending hook events from chat-track path, got %d", len(hookEvents))
	}
	if got := hookEvents[0].GetHook().GetFamily(); got != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED {
		t.Fatalf("expected proposed hook family first, got %s", got)
	}
	if got := hookEvents[1].GetHook().GetFamily(); got != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
		t.Fatalf("expected pending hook family second, got %s", got)
	}
}

func TestPublicChatHookProjectionAndNoRawAPMLConsumerPath(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeWithFollowUpAPML("message-pack4-hook", "hook me later", "action-pack4-hook", "follow up", 300)
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
					Delta: runtimeAgentTextStreamDelta(

						envelope),
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "propose follow up"},
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

	requirePublicChatPostTurnHookIntent(t, postTurn, "action-pack4-hook", "pending", 300)

	// The public chat APML hook path now emits runtime.agent.hook.* projection
	// truth, but it must not be mistaken for life-track PendingHook scheduler
	// truth. Public chat follow-up scheduling remains anchored in the chat
	// session surface.
	pendingResp, err := svc.ListPendingHooks(context.Background(), &runtimev1.ListPendingHooksRequest{
		Context:              testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(after public chat hook projection): %v", err)
	}
	if len(pendingResp.GetHooks()) != 0 {
		t.Fatalf("public chat follow-up must not create life-track pending hook truth, got %#v", pendingResp.GetHooks())
	}
	hookEvents := retainedAgentEventsForTest(t, svc, "agent-alpha", cursor, runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK)
	if len(hookEvents) != 2 {
		t.Fatalf("expected proposed+pending public chat hook projection events, got %#v", hookEvents)
	}
	for index, want := range []runtimev1.HookAdmissionState{
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	} {
		detail := hookEvents[index].GetHook()
		if got := detail.GetFamily(); got != want {
			t.Fatalf("unexpected hook projection family at index %d: got %s want %s", index, got, want)
		}
		intent := detail.GetIntent()
		if got := strings.TrimSpace(intent.GetIntentId()); got != "action-pack4-hook" {
			t.Fatalf("expected projected intent id action-pack4-hook, got %#v", intent)
		}
		if got := strings.TrimSpace(intent.GetConversationAnchorId()); got != anchorID {
			t.Fatalf("expected projected anchor %s, got %#v", anchorID, intent)
		}
		if got := strings.TrimSpace(intent.GetOriginatingTurnId()); got != turnID {
			t.Fatalf("expected projected turn %s, got %#v", turnID, intent)
		}
		if got := strings.TrimSpace(intent.GetOriginatingStreamId()); got != streamID {
			t.Fatalf("expected projected stream %s, got %#v", streamID, intent)
		}
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
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "missing agent id"},
			},
		}),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for implicit/default-agent routing attempt, got err=%v code=%v", err, status.Code(err))
	}
	if err == nil || !strings.Contains(err.Error(), "local_agent_ref is required") {
		t.Fatalf("expected local_agent_ref requirement failure, got %v", err)
	}
}
