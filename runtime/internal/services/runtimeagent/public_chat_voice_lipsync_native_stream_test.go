package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestPublicChatCommittedTurnEmitsNativeVoiceStreamChunksBeforeFinalArtifact(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	metadata := publicChatVoicePolicyMetadata(t, true)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
	setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", true)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	presentationCursor := svc.sequence

	voiceAI := &fakeVoiceLipsyncScenarioExecutor{
		modelResolved: "speech/qwen3tts-native",
		streamEvents: []*runtimev1.StreamScenarioEvent{
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved:   "speech/qwen3tts-native",
						RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
						VoiceOutputMode: runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
					},
				},
			},
			nativeVoiceArtifactDeltaEvent([]byte("RIFF-native-chunk-1")),
			nativeVoiceArtifactDeltaEvent([]byte("-native-chunk-2")),
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
				},
			},
		},
	}
	svc.SetVoiceLipsyncScenarioExecutor(voiceAI, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
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
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: publicChatStructuredEnvelopeAPML("message-native-voice-1", "Native voice stream should emit chunks before replay artifact.")},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
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
			"request_id":             "native-voice-request-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello native voice"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	chunk1 := capture.waitForMessageType(t, publicChatPresentationVoiceStreamChunkType)
	chunk2 := capture.waitForMessageType(t, publicChatPresentationVoiceStreamChunkType)
	playback := capture.waitForMessageType(t, publicChatPresentationVoicePlaybackRequestedType)
	_ = capture.waitForMessageType(t, publicChatPresentationLipsyncFrameBatchType)
	terminal := capture.waitForMessageType(t, "runtime.agent.presentation.voice_playback_terminal")

	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))
	chunkPayload1 := publicChatPayloadMap(t, chunk1)
	chunkPayload2 := publicChatPayloadMap(t, chunk2)
	playbackPayload := publicChatPayloadMap(t, playback)
	terminalPayload := publicChatPayloadMap(t, terminal)
	requirePublicChatTimelineEnvelope(t, chunkPayload1, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")
	requirePublicChatTimelineEnvelope(t, chunkPayload2, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")
	requirePublicChatTimelineEnvelope(t, playbackPayload, turnID, streamID, publicChatTimelineChannelVoice)
	requirePublicChatTimelineEnvelope(t, terminalPayload, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")

	chunkDetail1 := chunkPayload1["detail"].(map[string]any)
	chunkDetail2 := chunkPayload2["detail"].(map[string]any)
	playbackDetail := playbackPayload["detail"].(map[string]any)
	terminalDetail := terminalPayload["detail"].(map[string]any)
	for _, detail := range []map[string]any{chunkDetail1, chunkDetail2, playbackDetail, terminalDetail} {
		if got := strings.TrimSpace(detail["voice_output_mode"].(string)); got != "native_stream" {
			t.Fatalf("expected native_stream voice_output_mode, got %s in %#v", got, detail)
		}
	}
	voiceStreamID := strings.TrimSpace(chunkDetail1["voice_stream_id"].(string))
	if voiceStreamID == "" {
		t.Fatalf("native chunk must expose voice_stream_id: %#v", chunkDetail1)
	}
	for _, detail := range []map[string]any{chunkDetail1, chunkDetail2, playbackDetail, terminalDetail} {
		if got := strings.TrimSpace(detail["voice_stream_id"].(string)); got != voiceStreamID {
			t.Fatalf("voice stream identity drift: want %s got %s in %#v", voiceStreamID, got, detail)
		}
	}
	if finalChunk, ok := chunkDetail1["final_chunk"].(bool); !ok || finalChunk {
		t.Fatalf("first native chunk must be non-final, got %v", chunkDetail1["final_chunk"])
	}
	if finalChunk, ok := chunkDetail2["final_chunk"].(bool); !ok || finalChunk {
		t.Fatalf("second native chunk must be non-final, got %v", chunkDetail2["final_chunk"])
	}
	if got := chunkDetail1["chunk_sequence"]; got != float64(1) {
		t.Fatalf("first native chunk sequence = %v", got)
	}
	if got := chunkDetail2["chunk_sequence"]; got != float64(2) {
		t.Fatalf("second native chunk sequence = %v", got)
	}
	for _, detail := range []map[string]any{chunkDetail1, chunkDetail2} {
		if _, ok := detail["audio_artifact_id"]; ok {
			t.Fatalf("native non-final chunk must use transient transport, not durable audio_artifact_id: %#v", detail)
		}
		transportRef := strings.TrimSpace(detail["chunk_transport_ref"].(string))
		if transportRef == "" || !strings.Contains(transportRef, voiceStreamID) {
			t.Fatalf("native non-final chunk must expose transport ref bound to voice_stream_id=%s: %#v", voiceStreamID, detail)
		}
	}
	if finalArtifact, ok := playbackDetail["final_artifact"].(bool); !ok || !finalArtifact {
		t.Fatalf("native playback must carry final_artifact=true, got %v", playbackDetail["final_artifact"])
	}
	finalArtifactID := strings.TrimSpace(playbackDetail["audio_artifact_id"].(string))
	finalRecord, ok := svc.runtimeArtifacts.Get(finalArtifactID)
	if !ok || string(finalRecord.Bytes) != "RIFF-native-chunk-1-native-chunk-2" {
		t.Fatalf("expected assembled final voice artifact, ok=%v record=%#v", ok, finalRecord)
	}
	if finalRecord.GeneratedVoice == nil || finalRecord.GeneratedVoice.RetentionScope != "generated_agent_voice" {
		t.Fatalf("expected one final generated voice artifact scope, got %#v", finalRecord.GeneratedVoice)
	}
	if got := strings.TrimSpace(terminalDetail["voice_playback_state"].(string)); got != "completed" {
		t.Fatalf("native playback terminal state = %q, detail=%#v", got, terminalDetail)
	}
	if got := strings.TrimSpace(terminalDetail["terminal_reason"].(string)); got != "native_stream_completed" {
		t.Fatalf("native playback terminal reason = %q, detail=%#v", got, terminalDetail)
	}
	presentationStream := newAgentEventCaptureStreamLimit(authenticatedRuntimeAgentTestContext(context.Background(), "user-1"), 4)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		Context:      testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId:      "agent-alpha",
		Cursor:       encodeCursor(presentationCursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION},
	}, presentationStream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(presentation voice): %v", err)
	}
	if len(presentationStream.events) != 4 {
		t.Fatalf("expected two native chunks, final playback, and terminal presentation events, got %d events: %#v", len(presentationStream.events), presentationStream.events)
	}
	presentationChunk := presentationStream.events[0].GetPresentation()
	if presentationChunk.GetFamily() != runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_STREAM_CHUNK_AVAILABLE {
		t.Fatalf("first presentation event family = %v", presentationChunk.GetFamily())
	}
	if presentationChunk.GetVoiceStreamId() != voiceStreamID ||
		presentationChunk.GetChunkTransportRef() == "" ||
		presentationChunk.GetAudioArtifactId() != "" ||
		presentationChunk.GetChunkSequence() != 1 ||
		presentationChunk.GetFinalChunk() ||
		presentationChunk.GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM ||
		presentationChunk.GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE ||
		presentationChunk.GetPlaybackTarget() != "avatar_autoplay" {
		t.Fatalf("native voice presentation chunk mismatch: %#v", presentationChunk)
	}
	presentationTerminal := presentationStream.events[3].GetPresentation()
	if presentationTerminal.GetFamily() != runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_PLAYBACK_TERMINAL ||
		presentationTerminal.GetVoiceStreamId() != voiceStreamID ||
		presentationTerminal.GetFinalArtifactId() != finalArtifactID ||
		presentationTerminal.GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM ||
		presentationTerminal.GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_COMPLETED ||
		presentationTerminal.GetTerminalReason() != "native_stream_completed" {
		t.Fatalf("native voice presentation terminal mismatch: %#v", presentationTerminal)
	}
	voiceStream := newAgentVoiceStreamCaptureStreamLimit(authenticatedRuntimeAgentTestContext(context.Background(), "user-1"), 3)
	voiceStreamCtx := testRuntimeAgentIdentityContext("agent-alpha")
	voiceStreamCtx.AppId = "desktop.app"
	if err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		Context:              voiceStreamCtx,
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turnID,
	}, voiceStream); err != nil {
		t.Fatalf("SubscribeAgentVoiceStream: %v", err)
	}
	if len(voiceStream.events) != 3 {
		t.Fatalf("expected two chunks plus terminal from voice stream broker, got %d events: %#v", len(voiceStream.events), voiceStream.events)
	}
	if got := string(voiceStream.events[0].GetChunk()); got != "RIFF-native-chunk-1" {
		t.Fatalf("first typed stream chunk bytes = %q", got)
	}
	if got := string(voiceStream.events[1].GetChunk()); got != "-native-chunk-2" {
		t.Fatalf("second typed stream chunk bytes = %q", got)
	}
	if !voiceStream.events[2].GetTerminal() ||
		voiceStream.events[2].GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_COMPLETED ||
		voiceStream.events[2].GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM {
		t.Fatalf("typed stream terminal event mismatch: %#v", voiceStream.events[2])
	}
	if voiceAI.submitReq != nil {
		t.Fatalf("native stream path must not submit async batch job")
	}
	if voiceAI.streamReq == nil || voiceAI.streamReq.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_STREAM {
		t.Fatalf("expected native voice StreamScenario request, got %#v", voiceAI.streamReq)
	}
	if got := voiceAI.streamReq.GetHead().GetTargetRef().GetLocalRuntime().GetReadinessRef(); got != "test_runtime_readiness:v2:speech-qwen3tts" {
		t.Fatalf("native voice StreamScenario target_ref = %q", got)
	}
	types := capture.messageTypes()
	firstChunkIndex := indexOfMessageType(types, publicChatPresentationVoiceStreamChunkType)
	playbackIndex := indexOfMessageType(types, publicChatPresentationVoicePlaybackRequestedType)
	terminalIndex := indexOfMessageType(types, "runtime.agent.presentation.voice_playback_terminal")
	if firstChunkIndex < 0 || playbackIndex < 0 || firstChunkIndex > playbackIndex {
		t.Fatalf("native chunk must be emitted before final playback; types=%v", types)
	}
	if terminalIndex < 0 || terminalIndex < playbackIndex {
		t.Fatalf("native terminal truth must be emitted after final playback artifact; types=%v", types)
	}
}

func TestPublicChatCommittedTurnEmitsNativeVoiceFailedTerminalAfterProviderFailure(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", true)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	presentationCursor := svc.sequence

	voiceAI := &fakeVoiceLipsyncScenarioExecutor{
		modelResolved: "speech/qwen3tts-native-failed",
		streamEvents: []*runtimev1.StreamScenarioEvent{
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved:   "speech/qwen3tts-native-failed",
						RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
						VoiceOutputMode: runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
					},
				},
			},
			nativeVoiceArtifactDeltaEvent([]byte("RIFF-native-failed-1")),
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
				Payload: &runtimev1.StreamScenarioEvent_Failed{
					Failed: &runtimev1.ScenarioStreamFailed{
						ReasonCode: runtimev1.ReasonCode_AI_STREAM_BROKEN,
						ActionHint: "provider native stream failed after chunk",
					},
				},
			},
		},
	}
	svc.SetVoiceLipsyncScenarioExecutor(voiceAI, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
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
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: publicChatStructuredEnvelopeAPML("message-native-voice-failed-1", "Native voice stream should fail after its first chunk.")},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
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
			"request_id":             "native-voice-failed-request-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello failed native voice"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	chunk := capture.waitForMessageType(t, publicChatPresentationVoiceStreamChunkType)
	terminal := capture.waitForMessageType(t, publicChatPresentationVoicePlaybackTerminalType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))
	chunkPayload := publicChatPayloadMap(t, chunk)
	terminalPayload := publicChatPayloadMap(t, terminal)
	requirePublicChatTimelineEnvelope(t, chunkPayload, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")
	requirePublicChatTimelineEnvelope(t, terminalPayload, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")

	chunkDetail := chunkPayload["detail"].(map[string]any)
	terminalDetail := terminalPayload["detail"].(map[string]any)
	voiceStreamID := strings.TrimSpace(chunkDetail["voice_stream_id"].(string))
	if voiceStreamID == "" {
		t.Fatalf("native failed chunk must expose voice_stream_id: %#v", chunkDetail)
	}
	if got := strings.TrimSpace(chunkDetail["voice_output_mode"].(string)); got != "native_stream" {
		t.Fatalf("native failed chunk voice_output_mode = %q, detail=%#v", got, chunkDetail)
	}
	if got := strings.TrimSpace(chunkDetail["voice_playback_state"].(string)); got != "active" {
		t.Fatalf("native failed chunk voice_playback_state = %q, detail=%#v", got, chunkDetail)
	}
	if finalChunk, ok := chunkDetail["final_chunk"].(bool); !ok || finalChunk {
		t.Fatalf("native failed first chunk must be non-final, got %v", chunkDetail["final_chunk"])
	}
	if _, ok := chunkDetail["audio_artifact_id"]; ok {
		t.Fatalf("native failed non-final chunk must not claim durable artifact: %#v", chunkDetail)
	}
	if got := strings.TrimSpace(terminalDetail["voice_stream_id"].(string)); got != voiceStreamID {
		t.Fatalf("native failed terminal voice_stream_id drift: want %s got %#v", voiceStreamID, terminalDetail)
	}
	if got := strings.TrimSpace(terminalDetail["voice_output_mode"].(string)); got != "native_stream" {
		t.Fatalf("native failed terminal voice_output_mode = %q, detail=%#v", got, terminalDetail)
	}
	if got := strings.TrimSpace(terminalDetail["voice_playback_state"].(string)); got != "failed" {
		t.Fatalf("native failed terminal voice_playback_state = %q, detail=%#v", got, terminalDetail)
	}
	if got := strings.TrimSpace(terminalDetail["terminal_reason"].(string)); got != "native_stream_failed" {
		t.Fatalf("native failed terminal reason = %q, detail=%#v", got, terminalDetail)
	}
	if _, ok := terminalDetail["final_artifact_id"]; ok {
		t.Fatalf("native failed terminal must not claim final replay artifact: %#v", terminalDetail)
	}
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatPresentationVoicePlaybackRequestedType ||
			messageType == publicChatPresentationLipsyncFrameBatchType {
			t.Fatalf("failed native voice stream must not emit final playback/lipsync events, got %v", capture.messageTypes())
		}
	}

	presentationStream := newAgentEventCaptureStreamLimit(authenticatedRuntimeAgentTestContext(context.Background(), "user-1"), 2)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		Context:      testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId:      "agent-alpha",
		Cursor:       encodeCursor(presentationCursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION},
	}, presentationStream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(presentation voice failed): %v", err)
	}
	if len(presentationStream.events) != 2 {
		t.Fatalf("expected failed native chunk and terminal presentation events, got %d events: %#v", len(presentationStream.events), presentationStream.events)
	}
	presentationTerminal := presentationStream.events[1].GetPresentation()
	if presentationTerminal.GetFamily() != runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_PLAYBACK_TERMINAL ||
		presentationTerminal.GetVoiceStreamId() != voiceStreamID ||
		presentationTerminal.GetFinalArtifactId() != "" ||
		presentationTerminal.GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM ||
		presentationTerminal.GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_FAILED ||
		presentationTerminal.GetTerminalReason() != "native_stream_failed" {
		t.Fatalf("native failed presentation terminal mismatch: %#v", presentationTerminal)
	}

	voiceStream := newAgentVoiceStreamCaptureStreamLimit(authenticatedRuntimeAgentTestContext(context.Background(), "user-1"), 2)
	voiceStreamCtx := testRuntimeAgentIdentityContext("agent-alpha")
	voiceStreamCtx.AppId = "desktop.app"
	if err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		Context:              voiceStreamCtx,
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turnID,
	}, voiceStream); err != nil {
		t.Fatalf("SubscribeAgentVoiceStream(failed native): %v", err)
	}
	if len(voiceStream.events) != 2 {
		t.Fatalf("expected first chunk plus failed terminal, got %d events: %#v", len(voiceStream.events), voiceStream.events)
	}
	if got := string(voiceStream.events[0].GetChunk()); got != "RIFF-native-failed-1" {
		t.Fatalf("typed stream failed first chunk = %q", got)
	}
	if !voiceStream.events[1].GetTerminal() ||
		voiceStream.events[1].GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_FAILED ||
		voiceStream.events[1].GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM ||
		voiceStream.events[1].GetTerminalReason() != "native_stream_failed" {
		t.Fatalf("typed stream failed terminal mismatch: %#v", voiceStream.events[1])
	}
	if voiceAI.submitReq != nil {
		t.Fatalf("failed native stream path must not submit async batch job")
	}
	if voiceAI.streamReq == nil || voiceAI.streamReq.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_STREAM {
		t.Fatalf("expected failed native voice StreamScenario request, got %#v", voiceAI.streamReq)
	}
}
