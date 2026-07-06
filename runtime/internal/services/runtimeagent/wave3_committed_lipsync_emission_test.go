package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/types/known/structpb"
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
			"runtime_source_ref":         "agent-alpha",
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
	metadata := publicChatVoicePolicyMetadata(t, true)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
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
			"runtime_source_ref":         "agent-alpha",
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

func TestPublicChatManualVoiceRenderEmitsDesktopManualProjectionWithoutAvatarAutoplay(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	metadata := publicChatVoicePolicyMetadata(t, false)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	const expectedAudioArtifactID = "artifact-provider-voice-manual-1"
	audioBytes := []byte("RIFF\x24\x00\x00\x00WAVEfmt manual")
	if err := svc.runtimeArtifacts.Put(expectedAudioArtifactID, runtimeartifact.ArtifactRecord{
		Bytes:     audioBytes,
		MimeType:  "audio/wav",
		SizeBytes: int64(len(audioBytes)),
	}); err != nil {
		t.Fatalf("Put manual voice artifact: %v", err)
	}
	svc.SetVoiceLipsyncScenarioExecutor(&fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-provider-voice-manual-1",
		modelResolved: "speech/qwen3tts-ready",
		artifact:      &runtimev1.ScenarioArtifact{ArtifactId: expectedAudioArtifactID, MimeType: "audio/wav"},
	}, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-provider-manual",
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
				TraceId:   "trace-provider-manual",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{
								Text: publicChatStructuredEnvelopeAPML("message-provider-manual-1", "Manual desktop playback should use runtime voice policy."),
							},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-provider-manual",
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
			"runtime_source_ref":         "agent-alpha",
			"conversation_anchor_id": anchorID,
			"request_id":             "manual-voice-request-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatPresentationVoicePlaybackRequestedType ||
			messageType == publicChatPresentationVoiceStreamChunkType {
			t.Fatalf("avatar_autoplay=false must not emit post-turn voice projection, got %v", capture.messageTypes())
		}
	}

	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnVoiceRenderType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"turn_id":                turnID,
			"message_id":             "message-provider-manual-1",
			"text":                   "Manual desktop playback should use runtime voice policy.",
			"playback_target":        "desktop_manual",
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(voice_render): %v", err)
	}

	voiceChunk := capture.waitForMessageType(t, publicChatPresentationVoiceStreamChunkType)
	voicePlayback := capture.waitForMessageType(t, publicChatPresentationVoicePlaybackRequestedType)
	chunkPayload := publicChatPayloadMap(t, voiceChunk)
	requirePublicChatTimelineEnvelope(t, chunkPayload, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")
	chunkDetail := chunkPayload["detail"].(map[string]any)
	if got := strings.TrimSpace(chunkDetail["message_id"].(string)); got != "message-provider-manual-1" {
		t.Fatalf("expected manual chunk message_id=message-provider-manual-1, got %s", got)
	}
	if got := strings.TrimSpace(chunkDetail["playback_target"].(string)); got != "desktop_manual" {
		t.Fatalf("expected manual chunk playback_target=desktop_manual, got %s", got)
	}
	voicePayload := publicChatPayloadMap(t, voicePlayback)
	requirePublicChatTimelineEnvelope(t, voicePayload, turnID, streamID, publicChatTimelineChannelVoice)
	voiceDetail := voicePayload["detail"].(map[string]any)
	if got := strings.TrimSpace(voiceDetail["message_id"].(string)); got != "message-provider-manual-1" {
		t.Fatalf("expected manual voice message_id=message-provider-manual-1, got %s", got)
	}
	if got := strings.TrimSpace(voiceDetail["audio_artifact_id"].(string)); got != expectedAudioArtifactID {
		t.Fatalf("expected manual voice audio artifact id %s, got %s", expectedAudioArtifactID, got)
	}
	if got := strings.TrimSpace(voiceDetail["playback_target"].(string)); got != "desktop_manual" {
		t.Fatalf("expected manual playback_target=desktop_manual, got %s", got)
	}
	if got, ok := voiceDetail["final_artifact"].(bool); !ok || !got {
		t.Fatalf("expected manual final_artifact=true, got %v", voiceDetail["final_artifact"])
	}
	record, ok := svc.runtimeArtifacts.Get(expectedAudioArtifactID)
	if !ok || record.GeneratedVoice == nil {
		t.Fatalf("expected manual generated voice retention metadata, ok=%v record=%#v", ok, record.GeneratedVoice)
	}
	if got := strings.TrimSpace(record.GeneratedVoice.ConversationAnchorID); got != anchorID {
		t.Fatalf("expected manual generated voice anchor %s, got %s", anchorID, got)
	}
	if got := strings.TrimSpace(record.GeneratedVoice.MessageID); got != "message-provider-manual-1" {
		t.Fatalf("expected manual generated voice message_id=message-provider-manual-1, got %s", got)
	}
}

func TestPublicChatManualVoiceRenderSupportsHistoricalTurnAndRerendersAfterCleanup(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	metadata := publicChatVoicePolicyMetadata(t, false)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)

	audioIDs := []string{
		"artifact-provider-voice-history-1",
		"artifact-provider-voice-history-2",
	}
	for _, artifactID := range audioIDs {
		audioBytes := []byte("RIFF\x24\x00\x00\x00WAVEfmt " + artifactID)
		if err := svc.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
			Bytes:     audioBytes,
			MimeType:  "audio/wav",
			SizeBytes: int64(len(audioBytes)),
		}); err != nil {
			t.Fatalf("Put historical manual voice artifact %s: %v", artifactID, err)
		}
	}
	voiceAI := &idempotentVoiceLipsyncScenarioExecutor{
		modelResolved: "speech/qwen3tts-ready",
		artifactIDs:   audioIDs,
	}
	svc.SetVoiceLipsyncScenarioExecutor(voiceAI, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)

	historicalStartedAt := time.Now().Add(-2 * time.Minute)
	latestStartedAt := time.Now().Add(-time.Minute)
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	if anchor == nil {
		svc.chatSurfaceMu.Unlock()
		t.Fatalf("expected test anchor %s", anchorID)
	}
	anchor.LastTurnSnapshot = &publicChatTurnProjectionState{
		TurnID:            "turn-latest-voice",
		StreamID:          "stream-latest-voice",
		Status:            publicChatTurnStatusCompleted,
		StreamSequence:    3,
		TimelineStartedAt: latestStartedAt,
		MessageID:         "message-latest-voice",
		AssistantText:     "Latest message should not shadow history.",
	}
	anchor.CompletedTurnSnapshots = map[string]*publicChatTurnProjectionState{
		"turn-history-voice": {
			TurnID:            "turn-history-voice",
			StreamID:          "stream-history-voice",
			Status:            publicChatTurnStatusCompleted,
			StreamSequence:    7,
			TimelineStartedAt: historicalStartedAt,
			MessageID:         "message-history-voice",
			AssistantText:     "Historical desktop playback should still be renderable.",
		},
		"turn-latest-voice": clonePublicChatTurnProjectionState(anchor.LastTurnSnapshot),
	}
	svc.chatSurfaceMu.Unlock()

	renderHistoricalVoice := func(messageID string) string {
		t.Helper()
		if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
			MessageId:     messageID,
			ToAppId:       publicChatRuntimeAppID,
			FromAppId:     "desktop.app",
			SubjectUserId: "user-1",
			MessageType:   publicChatTurnVoiceRenderType,
			Payload: publicChatStructPayload(t, map[string]any{
				"conversation_anchor_id": anchorID,
				"turn_id":                "turn-history-voice",
				"message_id":             "message-history-voice",
				"text":                   "Historical desktop playback should still be renderable.",
				"playback_target":        "desktop_manual",
			}),
		}); err != nil {
			t.Fatalf("ConsumePublicChatAppMessage(voice_render %s): %v", messageID, err)
		}
		_ = capture.waitForMessageType(t, publicChatPresentationVoiceStreamChunkType)
		voicePlayback := capture.waitForMessageType(t, publicChatPresentationVoicePlaybackRequestedType)
		voicePayload := publicChatPayloadMap(t, voicePlayback)
		requirePublicChatTimelineEnvelope(t, voicePayload, "turn-history-voice", "stream-history-voice", publicChatTimelineChannelVoice)
		voiceDetail := voicePayload["detail"].(map[string]any)
		if got := strings.TrimSpace(voiceDetail["message_id"].(string)); got != "message-history-voice" {
			t.Fatalf("expected historical voice message_id=message-history-voice, got %s", got)
		}
		return strings.TrimSpace(voiceDetail["audio_artifact_id"].(string))
	}

	firstArtifactID := renderHistoricalVoice("manual-history-render-1")
	if firstArtifactID != audioIDs[0] {
		t.Fatalf("expected first historical render artifact %s, got %s", audioIDs[0], firstArtifactID)
	}
	deleted, err := svc.runtimeArtifacts.CleanupGeneratedVoiceArtifacts(runtimeartifact.GeneratedVoiceArtifactSelector{
		AgentID:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorID: anchorID,
	})
	if err != nil {
		t.Fatalf("CleanupGeneratedVoiceArtifacts: %v", err)
	}
	if len(deleted) != 1 || deleted[0] != firstArtifactID {
		t.Fatalf("expected cleanup to delete first historical voice artifact %s, got %v", firstArtifactID, deleted)
	}
	if _, ok := svc.runtimeArtifacts.Get(firstArtifactID); ok {
		t.Fatalf("expected first historical voice artifact %s to be deleted", firstArtifactID)
	}

	secondArtifactID := renderHistoricalVoice("manual-history-render-2")
	if secondArtifactID != audioIDs[1] {
		t.Fatalf("expected second historical render artifact %s after cleanup, got %s", audioIDs[1], secondArtifactID)
	}
	if len(voiceAI.submitReqs) != 2 {
		t.Fatalf("expected two voice synthesis submissions after cleanup rerender, got %d", len(voiceAI.submitReqs))
	}
	if voiceAI.submitReqs[0].GetIdempotencyKey() == voiceAI.submitReqs[1].GetIdempotencyKey() {
		t.Fatalf("manual rerender must use a fresh idempotency key after cleanup, got %s", voiceAI.submitReqs[0].GetIdempotencyKey())
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
	svc.publicChatRuntime().projectCommittedVoiceLipsync(context.Background(), session, turn, &publicChatStructuredEnvelope{
		Message: publicChatStructuredMessage{
			MessageID: "message-empty",
			Text:      "   ",
		},
	})
	if emitted != 0 {
		t.Fatalf("expected zero emitted events for empty committed text, got %d", emitted)
	}
}

func TestPublicChatCommittedTurnSkipsLipsyncProjectionWithoutArtifactStore(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	metadata := publicChatVoicePolicyMetadata(t, true)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
	svc.SetVoiceLipsyncScenarioExecutor(&fakeVoiceLipsyncScenarioExecutor{
		jobID:    "job-no-store-voice",
		artifact: &runtimev1.ScenarioArtifact{ArtifactId: "artifact-no-store-voice", MimeType: "audio/wav"},
	}, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetRuntimeArtifactStore(nil)
	emitted := 0
	svc.SetPublicChatAppEmitter(func(_ context.Context, _ *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		emitted++
		return &runtimev1.SendAppMessageResponse{Accepted: true}, nil
	})

	svc.publicChatRuntime().projectCommittedVoiceLipsync(context.Background(), publicChatAnchorState{
		ConversationAnchorID: anchorID,
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}, publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-no-store-1",
		StreamID:             "stream-no-store-1",
	}, &publicChatStructuredEnvelope{
		Message: publicChatStructuredMessage{
			MessageID: "message-no-store-1",
			Text:      "store is required before emitting lipsync",
		},
	})
	if emitted != 0 {
		t.Fatalf("expected zero emitted events without artifact store, got %d", emitted)
	}
}

type idempotentVoiceLipsyncScenarioExecutor struct {
	submitReqs    []*runtimev1.SubmitScenarioJobRequest
	jobsByKey     map[string]string
	artifactByJob map[string]*runtimev1.ScenarioArtifact
	modelResolved string
	artifactIDs   []string
}

func (f *idempotentVoiceLipsyncScenarioExecutor) SubmitScenarioJob(_ context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	if f.jobsByKey == nil {
		f.jobsByKey = make(map[string]string)
	}
	if f.artifactByJob == nil {
		f.artifactByJob = make(map[string]*runtimev1.ScenarioArtifact)
	}
	key := strings.TrimSpace(req.GetIdempotencyKey())
	if jobID := f.jobsByKey[key]; jobID != "" {
		return &runtimev1.SubmitScenarioJobResponse{
			Job: &runtimev1.ScenarioJob{
				JobId:         jobID,
				Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
				ModelResolved: f.modelResolved,
			},
		}, nil
	}
	if len(f.submitReqs) >= len(f.artifactIDs) {
		return nil, fmt.Errorf("unexpected voice synthesis submission %d", len(f.submitReqs)+1)
	}
	jobID := fmt.Sprintf("job-provider-voice-history-%d", len(f.submitReqs)+1)
	f.submitReqs = append(f.submitReqs, req)
	f.jobsByKey[key] = jobID
	f.artifactByJob[jobID] = &runtimev1.ScenarioArtifact{
		ArtifactId: f.artifactIDs[len(f.submitReqs)-1],
		MimeType:   "audio/wav",
	}
	return &runtimev1.SubmitScenarioJobResponse{
		Job: &runtimev1.ScenarioJob{
			JobId:         jobID,
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			ModelResolved: f.modelResolved,
		},
	}, nil
}

func (f *idempotentVoiceLipsyncScenarioExecutor) GetScenarioJob(_ context.Context, req *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	return &runtimev1.GetScenarioJobResponse{
		Job: &runtimev1.ScenarioJob{
			JobId:         req.GetJobId(),
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			ModelResolved: f.modelResolved,
		},
	}, nil
}

func (f *idempotentVoiceLipsyncScenarioExecutor) GetScenarioArtifacts(_ context.Context, req *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	artifact := f.artifactByJob[strings.TrimSpace(req.GetJobId())]
	return &runtimev1.GetScenarioArtifactsResponse{
		JobId:     req.GetJobId(),
		Artifacts: []*runtimev1.ScenarioArtifact{artifact},
	}, nil
}

func publicChatVoicePolicyMetadata(t *testing.T, avatarAutoplay bool) *structpb.Struct {
	t.Helper()
	metadata, err := structpb.NewStruct(map[string]any{
		"realm_profile_context": map[string]any{
			"avatar_autoplay":         avatarAutoplay,
			"default_voice_reference": "preset_voice_id:nimi-default",
			"speech_model_id":         "speech/qwen3tts",
			"speech_route_policy":     "local",
		},
	})
	if err != nil {
		t.Fatalf("structpb.NewStruct(voice policy metadata): %v", err)
	}
	return metadata
}

func openPublicChatTestAnchorWithMetadata(t *testing.T, svc *Service, agentID string, callerAppID string, subjectUserID string, metadata *structpb.Struct) string {
	t.Helper()
	ctx := testLocalAgentContext(subjectUserID, agentID)
	ctx.AppId = callerAppID
	resp, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       ctx,
		SubjectUserId: subjectUserID,
		Metadata:      metadata,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor: %v", err)
	}
	anchorID := resp.GetSnapshot().GetAnchor().GetConversationAnchorId()
	if strings.TrimSpace(anchorID) == "" {
		t.Fatalf("OpenConversationAnchor returned empty anchor id")
	}
	return anchorID
}
