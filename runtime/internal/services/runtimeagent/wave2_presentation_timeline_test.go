package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestPublicChatTurnEventsCarryRuntimeTimelineEnvelope(t *testing.T) {
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
				TraceId:   "trace-timeline",
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
				TraceId:   "trace-timeline",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: publicChatStructuredEnvelopeAPML("message-timeline", "timeline ready")},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-timeline",
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
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"request_id":             "timeline-request-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
	delta := capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)

	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))
	requirePublicChatTimelineEnvelope(t, acceptedPayload, turnID, streamID, publicChatTimelineChannelState)
	requirePublicChatTimelineEnvelope(t, publicChatPayloadMap(t, delta), turnID, streamID, publicChatTimelineChannelText)
	requirePublicChatTimelineEnvelope(t, publicChatPayloadMap(t, committed), turnID, streamID, publicChatTimelineChannelText)
}

func TestPublicChatTimelineValidationRejectsInvalidTimelineMetadata(t *testing.T) {
	t.Parallel()
	started := time.Now()
	turn := publicChatTurnState{
		TurnID:            "turn-1",
		StreamID:          "stream-1",
		TimelineStartedAt: started,
	}
	if _, err := publicChatBuildTimelineEnvelopeForChannel(turn, "bogus", 1, started); err == nil {
		t.Fatalf("expected invalid channel to fail closed")
	}
	if _, err := publicChatBuildTimelineEnvelopeForChannel(publicChatTurnState{TurnID: "turn-1", StreamID: "stream-1"}, publicChatTimelineChannelVoice, 1, started); err == nil {
		t.Fatalf("expected missing timebase to fail closed")
	}
	if _, err := publicChatBuildTimelineEnvelopeForChannel(turn, publicChatTimelineChannelVoice, 1, started.Add(-time.Millisecond)); err == nil {
		t.Fatalf("expected negative offset to fail closed")
	}
	if _, err := publicChatBuildTimelineEnvelopeForChannel(turn, publicChatTimelineChannelLipsync, 0, started); err == nil {
		t.Fatalf("expected zero lipsync sequence to fail closed")
	}
	if err := publicChatValidateTimelineSequence(publicChatTimelineChannelVoice, 2, publicChatTimelineChannelVoice, 2); err == nil {
		t.Fatalf("expected non-monotonic voice sequence to fail closed")
	}
	if err := publicChatValidateTimelineSequence(publicChatTimelineChannelLipsync, 3, publicChatTimelineChannelLipsync, 2); err == nil {
		t.Fatalf("expected non-monotonic lipsync sequence to fail closed")
	}
}

func TestPublicChatVoiceAndLipsyncTimelineEventsRequireRuntimeOwnedPayload(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	started := time.Now().UTC().Add(-time.Second)
	session := publicChatAnchorState{
		ConversationAnchorID: "anchor-voice-1",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	turn := publicChatTurnState{
		ConversationAnchorID: session.ConversationAnchorID,
		TurnID:               "turn-voice-1",
		StreamID:             "stream-voice-1",
		AgentID:              session.AgentID,
		CallerAppID:          session.CallerAppID,
		SubjectUserID:        session.SubjectUserID,
		TimelineStartedAt:    started,
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()

	if err := svc.publicChatRuntime().emitVoicePlaybackTimelineEvent(session, turn, publicChatVoicePlaybackProjection{
		AudioArtifactID:  "artifact-voice-1",
		AudioMimeType:    "audio/wav",
		DurationMs:       1200,
		DeadlineOffsetMs: 1500,
		PlaybackState:    "requested",
	}); err != nil {
		t.Fatalf("emitVoicePlaybackTimelineEvent: %v", err)
	}
	voicePayload := publicChatPayloadMap(t, capture.waitForMessageType(t, publicChatPresentationVoicePlaybackRequestedType))
	requirePublicChatTimelineEnvelope(t, voicePayload, turn.TurnID, turn.StreamID, publicChatTimelineChannelVoice)
	voiceDetail := voicePayload["detail"].(map[string]any)
	if got := strings.TrimSpace(voiceDetail["audio_artifact_id"].(string)); got != "artifact-voice-1" {
		t.Fatalf("expected voice audio artifact identity, got %s", got)
	}

	if err := svc.publicChatRuntime().emitLipsyncFrameBatchTimelineEvent(session, turn, publicChatLipsyncFrameBatchProjection{
		AudioArtifactID: "artifact-voice-1",
		Frames: []publicChatLipsyncFrameProjection{
			{FrameSequence: 1, OffsetMs: 0, DurationMs: 80, MouthOpenY: 0.25, AudioLevel: 0.4},
			{FrameSequence: 2, OffsetMs: 80, DurationMs: 80, MouthOpenY: 0.8, AudioLevel: 0.7},
		},
	}); err != nil {
		t.Fatalf("emitLipsyncFrameBatchTimelineEvent: %v", err)
	}
	lipsyncPayload := publicChatPayloadMap(t, capture.waitForMessageType(t, publicChatPresentationLipsyncFrameBatchType))
	requirePublicChatTimelineEnvelope(t, lipsyncPayload, turn.TurnID, turn.StreamID, publicChatTimelineChannelLipsync)
	lipsyncDetail := lipsyncPayload["detail"].(map[string]any)
	frames := lipsyncDetail["frames"].([]any)
	if len(frames) != 2 {
		t.Fatalf("expected two lipsync frames, got %v", frames)
	}
}

func TestPublicChatVoiceAndLipsyncTimelinePayloadValidationRejectsMalformedInput(t *testing.T) {
	t.Parallel()
	if _, err := publicChatBuildVoicePlaybackDetail(publicChatVoicePlaybackProjection{
		AudioMimeType: "audio/wav",
		PlaybackState: "requested",
	}); err == nil {
		t.Fatalf("expected missing voice audio artifact identity to fail closed")
	}
	if _, err := publicChatBuildVoicePlaybackDetail(publicChatVoicePlaybackProjection{
		AudioArtifactID: "artifact-voice-1",
		AudioMimeType:   "audio/wav",
		PlaybackState:   "provider-timed",
	}); err == nil {
		t.Fatalf("expected invalid voice playback state to fail closed")
	}
	if _, err := publicChatBuildLipsyncFrameBatchDetail(publicChatLipsyncFrameBatchProjection{
		AudioArtifactID: "artifact-voice-1",
		Frames: []publicChatLipsyncFrameProjection{
			{FrameSequence: 2, OffsetMs: 0, DurationMs: 80, MouthOpenY: 0.2, AudioLevel: 0.2},
			{FrameSequence: 2, OffsetMs: 80, DurationMs: 80, MouthOpenY: 0.4, AudioLevel: 0.4},
		},
	}); err == nil {
		t.Fatalf("expected non-monotonic lipsync frame sequence to fail closed")
	}
	if _, err := publicChatBuildLipsyncFrameBatchDetail(publicChatLipsyncFrameBatchProjection{
		AudioArtifactID: "artifact-voice-1",
		Frames: []publicChatLipsyncFrameProjection{
			{FrameSequence: 1, OffsetMs: 0, DurationMs: 0, MouthOpenY: 0.2, AudioLevel: 0.2},
		},
	}); err == nil {
		t.Fatalf("expected non-positive lipsync frame duration to fail closed")
	}
	if _, err := publicChatBuildLipsyncFrameBatchDetail(publicChatLipsyncFrameBatchProjection{
		AudioArtifactID: "artifact-voice-1",
		Frames: []publicChatLipsyncFrameProjection{
			{FrameSequence: 1, OffsetMs: 0, DurationMs: 80, MouthOpenY: 1.2, AudioLevel: 0.2},
		},
	}); err == nil {
		t.Fatalf("expected invalid mouth_open_y to fail closed")
	}
}

func requirePublicChatTimelineEnvelope(t *testing.T, payload map[string]any, turnID string, streamID string, channel string) {
	t.Helper()
	timeline, ok := payload["timeline"].(map[string]any)
	if !ok {
		t.Fatalf("expected runtime timeline envelope on payload=%v", payload)
	}
	if got := strings.TrimSpace(timeline["turn_id"].(string)); got != turnID {
		t.Fatalf("expected timeline.turn_id=%s, got %s", turnID, got)
	}
	if got := strings.TrimSpace(timeline["stream_id"].(string)); got != streamID {
		t.Fatalf("expected timeline.stream_id=%s, got %s", streamID, got)
	}
	if got := strings.TrimSpace(timeline["channel"].(string)); got != channel {
		t.Fatalf("expected timeline.channel=%s, got %s", channel, got)
	}
	if got := strings.TrimSpace(timeline["timebase_owner"].(string)); got != "runtime" {
		t.Fatalf("expected runtime timebase owner, got %s", got)
	}
	if got := strings.TrimSpace(timeline["projection_rule_id"].(string)); got != "K-AGCORE-051" {
		t.Fatalf("expected K-AGCORE-051 projection rule, got %s", got)
	}
	if got := strings.TrimSpace(timeline["clock_basis"].(string)); got != "monotonic_with_wall_anchor" {
		t.Fatalf("expected monotonic_with_wall_anchor clock basis, got %s", got)
	}
	if got, _ := timeline["provider_neutral"].(bool); !got {
		t.Fatalf("expected provider_neutral=true, got %v", timeline["provider_neutral"])
	}
	if got, _ := timeline["app_local_authority"].(bool); got {
		t.Fatalf("expected app_local_authority=false, got %v", timeline["app_local_authority"])
	}
	if got, _ := timeline["offset_ms"].(float64); got < 0 {
		t.Fatalf("expected non-negative offset_ms, got %v", timeline["offset_ms"])
	}
	if got, _ := timeline["sequence"].(float64); got <= 0 {
		t.Fatalf("expected positive sequence, got %v", timeline["sequence"])
	}
	if strings.TrimSpace(timeline["started_at_wall"].(string)) == "" || strings.TrimSpace(timeline["observed_at_wall"].(string)) == "" {
		t.Fatalf("expected wall-clock anchors, got %v", timeline)
	}
}
