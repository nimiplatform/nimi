package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestPublicChatCommittedTurnSkipsVoiceLipsyncProjectionWithoutAvatarAutoplay(t *testing.T) {
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"request_id":             "lipsync-request-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))

	committedPayload := publicChatPayloadMap(t, committed)
	requirePublicChatTimelineEnvelope(t, committedPayload, turnID, streamID, publicChatTimelineChannelText)
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatPresentationVoicePlaybackRequestedType ||
			messageType == publicChatPresentationVoiceStreamChunkType ||
			messageType == publicChatPresentationLipsyncFrameBatchType {
			t.Fatalf("default text-only turn must not emit voice/lipsync projection, got message types %v", capture.messageTypes())
		}
	}
}

func TestPublicChatCommittedTurnEmitsAvatarAutoplayProviderVoiceProjection(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", true)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	const expectedAudioArtifactID = "artifact-provider-voice-lipsync-1"
	audioBytes := []byte("RIFF\x24\x00\x00\x00WAVEfmt ")
	if err := svc.runtimeArtifacts.Put(expectedAudioArtifactID, runtimeartifact.ArtifactRecord{
		Bytes:     audioBytes,
		MimeType:  "audio/wav",
		SizeBytes: int64(len(audioBytes)),
	}); err != nil {
		t.Fatalf("Put provider voice artifact: %v", err)
	}
	voiceAI := &fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-provider-voice-lipsync-1",
		modelResolved: "speech/qwen3tts-ready",
		artifact:      &runtimev1.ScenarioArtifact{ArtifactId: expectedAudioArtifactID, MimeType: "audio/wav"},
	}
	svc.SetVoiceLipsyncScenarioExecutor(voiceAI, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-provider-lipsync",
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
				TraceId:   "trace-provider-lipsync",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{
								Text: publicChatStructuredEnvelopeAPML("message-provider-lipsync-1", "Hello world this turn drives provider voice."),
							},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-provider-lipsync",
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"request_id":             "lipsync-request-2",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	voiceChunk := capture.waitForMessageType(t, publicChatPresentationVoiceStreamChunkType)
	voicePlayback := capture.waitForMessageType(t, publicChatPresentationVoicePlaybackRequestedType)
	lipsyncBatch := capture.waitForMessageType(t, publicChatPresentationLipsyncFrameBatchType)

	voicePayload := publicChatPayloadMap(t, voicePlayback)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))
	committedPayload := publicChatPayloadMap(t, committed)
	messageID := strings.TrimSpace(committedPayload["message_id"].(string))
	requirePublicChatTimelineEnvelope(t, committedPayload, turnID, streamID, publicChatTimelineChannelText)
	chunkPayload := publicChatPayloadMap(t, voiceChunk)
	requirePublicChatTimelineEnvelope(t, chunkPayload, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")
	chunkDetail := chunkPayload["detail"].(map[string]any)
	if got := strings.TrimSpace(chunkDetail["message_id"].(string)); got != messageID {
		t.Fatalf("expected voice stream chunk message_id %s, got %s", messageID, got)
	}
	if got := strings.TrimSpace(chunkDetail["audio_artifact_id"].(string)); got != expectedAudioArtifactID {
		t.Fatalf("expected voice stream chunk audio artifact id %s, got %s", expectedAudioArtifactID, got)
	}
	if got := strings.TrimSpace(chunkDetail["audio_mime_type"].(string)); got != "audio/wav" {
		t.Fatalf("expected voice stream chunk audio mime type audio/wav, got %s", got)
	}
	if got, _ := chunkDetail["chunk_sequence"].(float64); got != 1 {
		t.Fatalf("expected voice stream chunk_sequence=1, got %v", chunkDetail["chunk_sequence"])
	}
	if got, ok := chunkDetail["final_chunk"].(bool); !ok || !got {
		t.Fatalf("expected final_chunk=true, got %v", chunkDetail["final_chunk"])
	}
	if got := strings.TrimSpace(chunkDetail["playback_target"].(string)); got != "avatar_autoplay" {
		t.Fatalf("expected voice stream playback_target=avatar_autoplay, got %s", got)
	}
	if got := strings.TrimSpace(chunkDetail["voice_output_mode"].(string)); got != "batch_final_artifact" {
		t.Fatalf("expected voice stream chunk voice_output_mode=batch_final_artifact, got %s", got)
	}
	if got := strings.TrimSpace(chunkDetail["voice_playback_state"].(string)); got != "active" {
		t.Fatalf("expected voice stream chunk voice_playback_state=active, got %s", got)
	}
	requirePublicChatTimelineEnvelope(t, voicePayload, turnID, streamID, publicChatTimelineChannelVoice)
	voiceDetail := voicePayload["detail"].(map[string]any)
	if got := strings.TrimSpace(voiceDetail["message_id"].(string)); got != messageID {
		t.Fatalf("expected voice playback message_id %s, got %s", messageID, got)
	}
	audioArtifactID := strings.TrimSpace(voiceDetail["audio_artifact_id"].(string))
	if audioArtifactID != expectedAudioArtifactID {
		t.Fatalf("expected provider audio artifact id %s, got %s", expectedAudioArtifactID, voiceDetail["audio_artifact_id"])
	}
	if got := strings.TrimSpace(voiceDetail["audio_mime_type"].(string)); got != "audio/wav" {
		t.Fatalf("expected provider audio mime type audio/wav, got %s", got)
	}
	record, ok := svc.runtimeArtifacts.Get(audioArtifactID)
	if !ok {
		t.Fatalf("expected provider audio artifact to remain readable before emit")
	}
	if string(record.Bytes) != string(audioBytes) {
		t.Fatalf("audio artifact bytes must not be overwritten by lipsync metadata, got %q", string(record.Bytes))
	}
	if got := strings.TrimSpace(record.MimeType); got != "audio/wav" {
		t.Fatalf("expected stored audio mime type audio/wav, got %s", got)
	}
	if record.GeneratedVoice == nil {
		t.Fatalf("expected generated voice retention metadata")
	}
	if got, want := strings.TrimSpace(record.GeneratedVoice.AgentID), strings.TrimSpace(voicePayload["agent_id"].(string)); got != want {
		t.Fatalf("expected generated voice agent_id %s, got %s", want, got)
	}
	if got, want := strings.TrimSpace(record.GeneratedVoice.ConversationAnchorID), strings.TrimSpace(voicePayload["conversation_anchor_id"].(string)); got != want {
		t.Fatalf("expected generated voice conversation_anchor_id %s, got %s", want, got)
	}
	if got := strings.TrimSpace(record.GeneratedVoice.MessageID); got != messageID {
		t.Fatalf("expected generated voice message_id %s, got %s", messageID, got)
	}
	if got := strings.TrimSpace(voiceDetail["playback_state"].(string)); got != "requested" {
		t.Fatalf("expected playback_state=requested, got %s", got)
	}
	if got := strings.TrimSpace(voiceDetail["voice_output_mode"].(string)); got != "batch_final_artifact" {
		t.Fatalf("expected voice playback voice_output_mode=batch_final_artifact, got %s", got)
	}
	if got := strings.TrimSpace(voiceDetail["voice_playback_state"].(string)); got != "active" {
		t.Fatalf("expected voice playback voice_playback_state=active, got %s", got)
	}
	if got := strings.TrimSpace(voiceDetail["playback_target"].(string)); got != "avatar_autoplay" {
		t.Fatalf("expected playback_target=avatar_autoplay, got %s", got)
	}
	if got, ok := voiceDetail["final_artifact"].(bool); !ok || !got {
		t.Fatalf("expected final_artifact=true, got %v", voiceDetail["final_artifact"])
	}
	if duration, ok := voiceDetail["duration_ms"].(float64); !ok || duration <= 0 {
		t.Fatalf("expected positive duration_ms, got %v", voiceDetail["duration_ms"])
	}
	if voiceAI.submitReq == nil {
		t.Fatalf("expected provider voice synthesis submit")
	}
	if got := strings.TrimSpace(voiceAI.submitReq.GetHead().GetModelId()); got != "speech/qwen3tts" {
		t.Fatalf("expected speech model speech/qwen3tts, got %q", got)
	}
	if got := voiceAI.submitReq.GetHead().GetRoutePolicy(); got != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		t.Fatalf("expected local speech route policy, got %v", got)
	}

	lipsyncPayload := publicChatPayloadMap(t, lipsyncBatch)
	requirePublicChatTimelineEnvelope(t, lipsyncPayload, turnID, streamID, publicChatTimelineChannelLipsync)
	lipsyncDetail := lipsyncPayload["detail"].(map[string]any)
	if got := strings.TrimSpace(lipsyncDetail["audio_artifact_id"].(string)); got != audioArtifactID {
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
