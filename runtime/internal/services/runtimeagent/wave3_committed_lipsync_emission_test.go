package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Wave 3 — runtime.agent.turn.message_committed must drive the K-AGCORE-051
// voice/lipsync projection: a `voice_playback_requested` event with
// playback_state="requested" followed by a `lipsync_frame_batch` event whose
// frames + audio_artifact_id come from the runtime-injected synthesizer. The
// test wires the default synthetic synthesizer to validate that committed
// assistant text → both events emit in order with timeline envelopes that
// pass schema validation.
func TestPublicChatCommittedTurnEmitsVoiceLipsyncProjection(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-lipsync",
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
				TraceId:   "trace-lipsync",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{
								Text: publicChatStructuredEnvelopeAPML("message-lipsync-1", "Hello world this turn drives lipsync."),
							},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-lipsync",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
				},
			})
		},
	})
	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"request_id":             "lipsync-request-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	voicePlayback := capture.waitForMessageType(t, publicChatPresentationVoicePlaybackRequestedType)
	lipsyncBatch := capture.waitForMessageType(t, publicChatPresentationLipsyncFrameBatchType)

	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))

	committedPayload := publicChatPayloadMap(t, committed)
	requirePublicChatTimelineEnvelope(t, committedPayload, turnID, streamID, publicChatTimelineChannelText)

	voicePayload := publicChatPayloadMap(t, voicePlayback)
	requirePublicChatTimelineEnvelope(t, voicePayload, turnID, streamID, publicChatTimelineChannelVoice)
	voiceDetail := voicePayload["detail"].(map[string]any)
	if got := strings.TrimSpace(voiceDetail["audio_artifact_id"].(string)); !strings.HasPrefix(got, syntheticVoiceArtifactScheme+"/") {
		t.Fatalf("expected synthetic audio artifact id, got %s", got)
	}
	if !strings.Contains(strings.TrimSpace(voiceDetail["audio_artifact_id"].(string)), turnID) {
		t.Fatalf("audio artifact id must include turn_id: got %v turn_id=%s", voiceDetail["audio_artifact_id"], turnID)
	}
	if got := strings.TrimSpace(voiceDetail["audio_mime_type"].(string)); got != syntheticVoiceMimeType {
		t.Fatalf("expected synthetic mime type %s, got %s", syntheticVoiceMimeType, got)
	}
	if got := strings.TrimSpace(voiceDetail["playback_state"].(string)); got != "requested" {
		t.Fatalf("expected playback_state=requested, got %s", got)
	}
	if duration, ok := voiceDetail["duration_ms"].(float64); !ok || duration <= 0 {
		t.Fatalf("expected positive duration_ms, got %v", voiceDetail["duration_ms"])
	}

	lipsyncPayload := publicChatPayloadMap(t, lipsyncBatch)
	requirePublicChatTimelineEnvelope(t, lipsyncPayload, turnID, streamID, publicChatTimelineChannelLipsync)
	lipsyncDetail := lipsyncPayload["detail"].(map[string]any)
	if got := strings.TrimSpace(lipsyncDetail["audio_artifact_id"].(string)); got != strings.TrimSpace(voiceDetail["audio_artifact_id"].(string)) {
		t.Fatalf("voice + lipsync audio_artifact_id mismatch: %s vs %s", got, voiceDetail["audio_artifact_id"])
	}
	frames, ok := lipsyncDetail["frames"].([]any)
	if !ok || len(frames) == 0 {
		t.Fatalf("expected non-empty frames, got %v", lipsyncDetail["frames"])
	}
	// Spot-check frame schema of first/last frame.
	first := frames[0].(map[string]any)
	if seq, _ := first["frame_sequence"].(float64); seq != 1 {
		t.Fatalf("expected first frame_sequence=1, got %v", first["frame_sequence"])
	}
	if dur, _ := first["duration_ms"].(float64); dur <= 0 {
		t.Fatalf("expected positive duration_ms on first frame, got %v", first["duration_ms"])
	}
	if mouth, _ := first["mouth_open_y"].(float64); mouth < 0 || mouth > 1 {
		t.Fatalf("first frame mouth_open_y out of [0,1]: %v", first["mouth_open_y"])
	}
}

// Empty committed text must NOT trigger voice/lipsync projection (skip path).
func TestPublicChatCommittedTurnSkipsLipsyncProjectionOnEmptyText(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	session := publicChatAnchorState{
		ConversationAnchorID: "anchor-empty-1",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	turn := publicChatTurnState{
		ConversationAnchorID: session.ConversationAnchorID,
		TurnID:               "turn-empty-1",
		StreamID:             "stream-empty-1",
	}
	emitted := 0
	svc.SetPublicChatAppEmitter(func(_ context.Context, _ *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		emitted++
		return &runtimev1.SendAppMessageResponse{Accepted: true}, nil
	})

	// Direct projection call with empty committed text must produce no events.
	svc.publicChatRuntime().projectCommittedVoiceLipsync(session, turn, &publicChatStructuredEnvelope{
		Message: publicChatStructuredMessage{
			MessageID: "message-empty",
			Text:      "   ",
		},
	})
	if emitted != 0 {
		t.Fatalf("expected zero emitted events for empty committed text, got %d", emitted)
	}
}
