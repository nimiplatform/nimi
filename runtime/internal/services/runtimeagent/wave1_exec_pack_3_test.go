package runtimeagent

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

// TestWave1ExecPack3PostureProjectionAndEnvelopeInvariants exercises the
// Wave 1 Exec Pack 3 Must-Achieve items that land without requiring a live
// chat turn executor:
//
//   - runtime.agent.state.posture_changed emits real PostureProjection per
//     K-AGCORE-037 (current_posture.{action_family,interrupt_mode}).
//   - state_envelope origin linkage is preserved verbatim and NOT fabricated
//     when caller has no real continuity branch.
//   - runtime.agent.state.status_text_changed emits when status text
//     transitions; previous_status_text carries real prior value.
//   - runtime.agent.presentation.* validator fail-closes when envelope
//     (conversation_anchor_id / turn_id / stream_id) is missing. Runtime
//     MUST NOT emit anonymous presentation payloads.
func TestWave1ExecPack3PostureProjectionAndEnvelopeInvariants(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	defer func() {
		_ = memorySvc.PersistenceBackend().Close()
	}()
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}

	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-exec-pack-3",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	entry, err := svc.agentByID("agent-exec-pack-3")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	// Seed a prior status_text so we can verify previous_status_text carries
	// real prior truth on the transition.
	entry.State.StatusText = "idle observer"
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("seed status_text: %v", err)
	}

	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	entry, err = svc.agentByID("agent-exec-pack-3")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}

	posture := BehavioralPosture{
		AgentID:       "agent-exec-pack-3",
		PostureClass:  "steady_support",
		ActionFamily:  "support",
		StatusText:    "steady and terse",
		InterruptMode: "cautious",
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	// origin intentionally empty: admin-style posture mutation without real
	// continuity branch. Runtime MUST NOT fabricate turn linkage here.
	stateEvents, err := svc.applyBehavioralPostureUpdate(ctx, entry, posture, stateEventOrigin{}, time.Now().UTC())
	if err != nil {
		t.Fatalf("applyBehavioralPostureUpdate: %v", err)
	}
	entry.State.StatusText = posture.StatusText
	if err := svc.updateAgent(entry, stateEvents...); err != nil {
		t.Fatalf("updateAgent(posture): %v", err)
	}

	streamCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	stream := newAgentEventCaptureStreamLimit(streamCtx, 2)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId: "agent-exec-pack-3",
		Cursor:  encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{
			runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE,
		},
	}, stream); err != context.Canceled && err != context.DeadlineExceeded {
		t.Fatalf("SubscribeAgentEvents: %v", err)
	}

	if len(stream.events) < 2 {
		t.Fatalf("expected 2 state events (posture_changed + status_text_changed), got %d", len(stream.events))
	}
	postureEvent := stream.events[0]
	if postureEvent.GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE {
		t.Fatalf("expected state event type, got %#v", postureEvent)
	}
	postureDetail := postureEvent.GetState()
	if postureDetail.GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_POSTURE_CHANGED {
		t.Fatalf("expected posture_changed family, got %s", postureDetail.GetFamily())
	}
	if postureDetail.GetCurrentPosture() == nil {
		t.Fatalf("expected current_posture PostureProjection")
	}
	if got := strings.TrimSpace(postureDetail.GetCurrentPosture().GetActionFamily()); got != "support" {
		t.Fatalf("expected action_family=support, got %q", got)
	}
	if got := strings.TrimSpace(postureDetail.GetCurrentPosture().GetInterruptMode()); got != "cautious" {
		t.Fatalf("expected interrupt_mode=cautious, got %q", got)
	}
	// K-AGCORE-037 invariant: no fabricated origin linkage on no-origin posture.
	if postureDetail.GetConversationAnchorId() != "" ||
		postureDetail.GetOriginatingTurnId() != "" ||
		postureDetail.GetOriginatingStreamId() != "" {
		t.Fatalf("no-origin posture event MUST NOT carry linkage, got %#v", postureDetail)
	}

	statusEvent := stream.events[1]
	statusDetail := statusEvent.GetState()
	if statusDetail.GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_STATUS_TEXT_CHANGED {
		t.Fatalf("expected status_text_changed family, got %s", statusDetail.GetFamily())
	}
	if got := strings.TrimSpace(statusDetail.GetCurrentStatusText()); got != "steady and terse" {
		t.Fatalf("expected current_status_text='steady and terse', got %q", got)
	}
	if got := strings.TrimSpace(statusDetail.GetPreviousStatusText()); got != "idle observer" {
		t.Fatalf("expected previous_status_text='idle observer', got %q", got)
	}
	if !statusDetail.GetHasPreviousStatusText() {
		t.Fatalf("expected has_previous_status_text=true when prior status was present")
	}

	// Presentation envelope validator: runtime MUST NOT emit presentation
	// events without real conversation_anchor_id + turn_id + stream_id.
	if err := validatePresentationDetail(nil); err == nil {
		t.Fatalf("expected validatePresentationDetail(nil) error")
	}
	missing := &runtimev1.AgentPresentationEventDetail{
		Family:               runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_EXPRESSION_REQUESTED,
		ConversationAnchorId: "anchor-1",
		TurnId:               "turn-1",
		// StreamId intentionally empty
		ExpressionId: "joy",
	}
	if err := validatePresentationDetail(missing); err == nil {
		t.Fatalf("expected fail-closed when stream_id missing")
	}
	full := &runtimev1.AgentPresentationEventDetail{
		Family:               runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_EXPRESSION_REQUESTED,
		ConversationAnchorId: "anchor-1",
		TurnId:               "turn-1",
		StreamId:             "stream-1",
		ExpressionId:         "joy",
	}
	if err := validatePresentationDetail(full); err != nil {
		t.Fatalf("expected presentation envelope valid with all identifiers, got %v", err)
	}

	// Exec helper produces a presentation event with stream identity distinct
	// from turn identity per K-AGCORE-030.
	evt := svc.presentationExpressionRequestedEvent("agent-exec-pack-3", "anchor-1", "turn-1", "stream-1", "joy", 0, time.Now().UTC())
	if evt.GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION {
		t.Fatalf("expected presentation event type")
	}
	if got := strings.TrimSpace(evt.GetPresentation().GetStreamId()); got != "stream-1" {
		t.Fatalf("expected stream_id=stream-1, got %q", got)
	}
	if evt.GetPresentation().GetTurnId() == evt.GetPresentation().GetStreamId() {
		t.Fatalf("stream_id MUST be distinct from turn_id per K-AGCORE-030")
	}
}

func TestWave1ExecPack3CommittedPresentationReachesTypedStream(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := `<message id="message-presentation"><emotion>joy</emotion>presentation committed</message>`
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-presentation-stream",
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
				TraceId:   "trace-presentation-stream",
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
				TraceId:   "trace-presentation-stream",
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

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "show emotion"},
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

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	streamCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	stream := newAgentEventCaptureStreamLimit(streamCtx, 1)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId: "agent-alpha",
		Cursor:  encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{
			runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION,
		},
	}, stream); err != context.Canceled && err != context.DeadlineExceeded {
		t.Fatalf("SubscribeAgentEvents: %v", err)
	}

	if len(stream.events) != 1 {
		t.Fatalf("expected one committed presentation event, got %d", len(stream.events))
	}
	event := stream.events[0]
	if event.GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION {
		t.Fatalf("expected presentation event type, got %#v", event)
	}
	detail := event.GetPresentation()
	if detail.GetFamily() != runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_EXPRESSION_REQUESTED {
		t.Fatalf("expected expression_requested family, got %s", detail.GetFamily())
	}
	if strings.TrimSpace(detail.GetConversationAnchorId()) != anchorID {
		t.Fatalf("expected committed presentation anchor_id=%s, got %q", anchorID, detail.GetConversationAnchorId())
	}
	if strings.TrimSpace(detail.GetTurnId()) == "" || strings.TrimSpace(detail.GetStreamId()) == "" {
		t.Fatalf("expected committed presentation turn_id + stream_id, got %#v", detail)
	}
	if strings.TrimSpace(detail.GetExpressionId()) != "joy" {
		t.Fatalf("expected committed expression_id=joy, got %#v", detail)
	}
}

func TestWave1ExecPack3CommittedAPMLActivityReachesTypedStream(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := `<message id="message-activity"><activity>thinking</activity>activity committed</message>`
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-activity-stream",
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
				TraceId:   "trace-activity-stream",
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
				TraceId:   "trace-activity-stream",
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

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "show activity"},
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

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	streamCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	stream := newAgentEventCaptureStreamLimit(streamCtx, 1)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId: "agent-alpha",
		Cursor:  encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{
			runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION,
		},
	}, stream); err != context.Canceled && err != context.DeadlineExceeded {
		t.Fatalf("SubscribeAgentEvents: %v", err)
	}

	if len(stream.events) != 1 {
		t.Fatalf("expected one committed activity presentation event, got %d", len(stream.events))
	}
	detail := stream.events[0].GetPresentation()
	if detail.GetFamily() != runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_ACTIVITY_REQUESTED {
		t.Fatalf("expected activity_requested family, got %s", detail.GetFamily())
	}
	if strings.TrimSpace(detail.GetConversationAnchorId()) != anchorID {
		t.Fatalf("expected committed presentation anchor_id=%s, got %q", anchorID, detail.GetConversationAnchorId())
	}
	if strings.TrimSpace(detail.GetTurnId()) == "" || strings.TrimSpace(detail.GetStreamId()) == "" {
		t.Fatalf("expected committed presentation turn_id + stream_id, got %#v", detail)
	}
	if strings.TrimSpace(detail.GetActivityName()) != "thinking" {
		t.Fatalf("expected committed activity_name=thinking, got %#v", detail)
	}
	if strings.TrimSpace(detail.GetActivityCategory()) != "interaction" || strings.TrimSpace(detail.GetActivitySource()) != "apml_output" {
		t.Fatalf("expected committed activity category/source, got %#v", detail)
	}
}
