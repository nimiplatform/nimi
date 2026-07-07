package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
			"runtime_source_ref":     "agent-alpha",
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
			"runtime_source_ref":     "agent-alpha",
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

func TestPublicChatCommittedTurnEmitsNativeVoiceStreamChunksBeforeFinalArtifact(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	metadata := publicChatVoicePolicyMetadata(t, true)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
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
			"runtime_source_ref":     "agent-alpha",
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
	presentationStream := newAgentEventCaptureStreamLimit(context.Background(), 4)
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
	voiceStream := newAgentVoiceStreamCaptureStreamLimit(context.Background(), 3)
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
	if got := voiceAI.streamReq.GetHead().GetTargetRef().GetLocalRuntime().GetProfileBindingId(); got != "local-runtime:speech/qwen3tts" {
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

func TestPublicChatNativeVoicePlaybackInterruptCancelsStreamAndEmitsTerminalTruth(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	metadata := publicChatVoicePolicyMetadata(t, true)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	voiceAI := newBlockingNativeVoiceScenarioExecutor()
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
							Text: &runtimev1.TextStreamDelta{Text: publicChatStructuredEnvelopeAPML("message-native-voice-interrupt-1", "Native voice stream should be interruptible after its first chunk.")},
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

	presentationCtx, cancelPresentation := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelPresentation()
	presentationStream := newAgentEventCaptureStreamLimit(presentationCtx, 1)
	presentationStream.headerSent = make(chan struct{}, 1)
	presentationDone := make(chan error, 1)
	go func() {
		presentationDone <- svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
			Context:      testRuntimeAgentIdentityContext("agent-alpha"),
			AgentId:      "agent-alpha",
			EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION},
		}, presentationStream)
	}()
	select {
	case <-presentationStream.headerSent:
	case err := <-presentationDone:
		t.Fatalf("SubscribeAgentEvents(live presentation) returned before turn submit: %v", err)
	case <-time.After(time.Second):
		t.Fatal("SubscribeAgentEvents(live presentation) did not admit before turn submit")
	}

	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"request_id":             "native-voice-interrupt-request-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello interruptible native voice"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	chunk := capture.waitForMessageType(t, publicChatPresentationVoiceStreamChunkType)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))
	chunkPayload := publicChatPayloadMap(t, chunk)
	requirePublicChatTimelineEnvelope(t, chunkPayload, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")
	chunkDetail := chunkPayload["detail"].(map[string]any)
	voiceStreamID := strings.TrimSpace(chunkDetail["voice_stream_id"].(string))
	if voiceStreamID == "" {
		t.Fatalf("native chunk must expose voice_stream_id: %#v", chunkDetail)
	}
	if _, ok := chunkDetail["audio_artifact_id"]; ok {
		t.Fatalf("interrupted native non-final chunk must not be durable artifact-backed: %#v", chunkDetail)
	}
	select {
	case err := <-presentationDone:
		if err != nil && err != context.Canceled && !errors.Is(err, context.Canceled) {
			t.Fatalf("SubscribeAgentEvents(live presentation) returned unexpected error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("live presentation subscriber did not receive the native voice chunk")
	}
	if len(presentationStream.events) != 1 {
		t.Fatalf("expected one live presentation event, got %#v", presentationStream.events)
	}
	livePresentation := presentationStream.events[0].GetPresentation()
	if livePresentation.GetFamily() != runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_STREAM_CHUNK_AVAILABLE ||
		livePresentation.GetTurnId() != turnID ||
		livePresentation.GetStreamId() != streamID ||
		livePresentation.GetVoiceStreamId() != voiceStreamID ||
		livePresentation.GetChunkSequence() != 1 ||
		livePresentation.GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM ||
		livePresentation.GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE {
		t.Fatalf("live native voice presentation event mismatch: %#v", livePresentation)
	}

	interruptCtx := testRuntimeAgentIdentityContext("agent-alpha")
	interruptCtx.AppId = "desktop.app"
	resp, err := svc.InterruptAgentVoicePlayback(context.Background(), &runtimev1.InterruptAgentVoicePlaybackRequest{
		Context:              interruptCtx,
		ConversationAnchorId: anchorID,
		TurnId:               turnID,
		VoiceStreamId:        voiceStreamID,
		Reason:               "avatar_user_interrupt",
	})
	if err != nil {
		t.Fatalf("InterruptAgentVoicePlayback: %v", err)
	}
	if resp.GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED {
		t.Fatalf("interrupt response playback state = %v", resp.GetVoicePlaybackState())
	}
	voiceAI.waitCanceled(t)
	terminal := capture.waitForMessageType(t, publicChatPresentationVoicePlaybackTerminalType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	terminalPayload := publicChatPayloadMap(t, terminal)
	requirePublicChatTimelineEnvelope(t, terminalPayload, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")
	terminalDetail := terminalPayload["detail"].(map[string]any)
	if got := strings.TrimSpace(terminalDetail["voice_stream_id"].(string)); got != voiceStreamID {
		t.Fatalf("terminal voice_stream_id drift: want %s got %#v", voiceStreamID, terminalDetail)
	}
	if got := strings.TrimSpace(terminalDetail["voice_output_mode"].(string)); got != "native_stream" {
		t.Fatalf("interrupted terminal must preserve selected mode native_stream, got %#v", terminalDetail)
	}
	if got := strings.TrimSpace(terminalDetail["voice_playback_state"].(string)); got != "interrupted" {
		t.Fatalf("voice terminal state = %q, detail=%#v", got, terminalDetail)
	}
	if got := strings.TrimSpace(terminalDetail["terminal_reason"].(string)); got != "avatar_user_interrupt" {
		t.Fatalf("voice terminal reason = %q, detail=%#v", got, terminalDetail)
	}
	if _, ok := terminalDetail["final_artifact_id"]; ok {
		t.Fatalf("interrupted native stream must not claim final replay artifact: %#v", terminalDetail)
	}
	if _, ok := svc.runtimeArtifacts.Get(runtimeAgentVoiceStreamArtifactID("final", turnID, "message-native-voice-interrupt-1", 0)); ok {
		t.Fatal("interrupted native voice stream must not write final generated voice artifact")
	}
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatPresentationVoicePlaybackRequestedType ||
			messageType == publicChatPresentationLipsyncFrameBatchType {
			t.Fatalf("interrupted native voice stream must not emit final playback/lipsync events, got %v", capture.messageTypes())
		}
	}
	voiceStream := newAgentVoiceStreamCaptureStreamLimit(context.Background(), 2)
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
	if len(voiceStream.events) != 2 {
		t.Fatalf("expected first chunk plus interrupted terminal, got %d events: %#v", len(voiceStream.events), voiceStream.events)
	}
	if got := string(voiceStream.events[0].GetChunk()); got != "RIFF-native-interrupt-1" {
		t.Fatalf("typed stream first chunk = %q", got)
	}
	if !voiceStream.events[1].GetTerminal() ||
		voiceStream.events[1].GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED ||
		voiceStream.events[1].GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM {
		t.Fatalf("typed stream interrupted terminal mismatch: %#v", voiceStream.events[1])
	}
}

func TestPublicChatNativeVoicePlaybackInterruptRejectsStreamFromDifferentTurn(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ownerAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	otherAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	ownerTurn := publicChatTurnState{
		ConversationAnchorID: ownerAnchorID,
		TurnID:               "turn-owner-voice-stream",
		StreamID:             "stream-owner-voice-stream",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	otherTurn := publicChatTurnState{
		ConversationAnchorID: otherAnchorID,
		TurnID:               "turn-other-voice-stream",
		StreamID:             "stream-other-voice-stream",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[ownerTurn.TurnID] = &ownerTurn
	svc.chatTurns[otherTurn.TurnID] = &otherTurn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-owner"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: ownerAnchorID,
		TurnId:               ownerTurn.TurnID,
		StreamId:             ownerTurn.StreamID,
		MessageId:            "message-owner-voice-stream",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-owner-stream"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	interruptCtx := testRuntimeAgentIdentityContext("agent-alpha")
	interruptCtx.AppId = "desktop.app"
	if _, err := svc.InterruptAgentVoicePlayback(context.Background(), &runtimev1.InterruptAgentVoicePlaybackRequest{
		Context:              interruptCtx,
		ConversationAnchorId: otherAnchorID,
		TurnId:               otherTurn.TurnID,
		VoiceStreamId:        voiceStreamID,
		Reason:               "wrong_turn_interrupt",
	}); err == nil {
		t.Fatal("InterruptAgentVoicePlayback must reject a voice_stream_id owned by a different anchor/turn")
	}

	if got := svc.agentVoiceStreamTerminalState(voiceStreamID); got != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_UNSPECIFIED {
		t.Fatalf("wrong-turn interrupt must not terminalize owner stream, terminal state=%v", got)
	}
}

func TestPublicChatNativeVoiceStreamSubscribeRejectsStreamFromDifferentTurn(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ownerAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	otherAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	ownerTurn := publicChatTurnState{
		ConversationAnchorID: ownerAnchorID,
		TurnID:               "turn-owner-voice-subscribe",
		StreamID:             "stream-owner-voice-subscribe",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	otherTurn := publicChatTurnState{
		ConversationAnchorID: otherAnchorID,
		TurnID:               "turn-other-voice-subscribe",
		StreamID:             "stream-other-voice-subscribe",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[ownerTurn.TurnID] = &ownerTurn
	svc.chatTurns[otherTurn.TurnID] = &otherTurn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-subscribe-owner"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: ownerAnchorID,
		TurnId:               ownerTurn.TurnID,
		StreamId:             ownerTurn.StreamID,
		MessageId:            "message-owner-voice-subscribe",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-owner-subscribe"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	subscribeCtx := testRuntimeAgentIdentityContext("agent-alpha")
	subscribeCtx.AppId = "desktop.app"
	stream := newAgentVoiceStreamCaptureStreamLimit(context.Background(), 1)
	err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		Context:              subscribeCtx,
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: otherAnchorID,
		TurnId:               otherTurn.TurnID,
	}, stream)
	if status.Code(err) != codes.NotFound {
		t.Fatalf("wrong-turn voice stream subscription error code=%v, want NotFound", status.Code(err))
	}
	if len(stream.events) != 0 {
		t.Fatalf("wrong-turn voice stream subscription must not receive owner chunks: %#v", stream.events)
	}
}

func TestPublicChatNativeVoiceStreamSubscribeRejectsWrongCallerApp(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-owner-voice-subscribe-caller",
		StreamID:             "stream-owner-voice-subscribe-caller",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-subscribe-caller-owner"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            "message-owner-voice-subscribe-caller",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-owner-subscribe-caller"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	subscribeCtx := testRuntimeAgentIdentityContext("agent-alpha")
	subscribeCtx.AppId = "web.app"
	stream := newAgentVoiceStreamCaptureStreamLimit(context.Background(), 1)
	err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		Context:              subscribeCtx,
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
	}, stream)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("wrong-caller voice stream subscription error code=%v, want PermissionDenied", status.Code(err))
	}
	if len(stream.events) != 0 {
		t.Fatalf("wrong-caller voice stream subscription must not receive owner chunks: %#v", stream.events)
	}
}

func TestPublicChatNativeVoiceStreamSubscribeValidatesScopedBinding(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-scoped-voice-subscribe",
		StreamID:             "stream-scoped-voice-subscribe",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-scoped-subscribe"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            "message-scoped-voice-subscribe",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-scoped-subscribe"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	var validatorCalls int
	svc.SetScopedBindingValidator(stubScopedBindingValidator{validate: func(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
		validatorCalls++
		if bindingID != "binding-voice-read" {
			t.Fatalf("binding id = %q", bindingID)
		}
		if requiredScope != runtimeAgentTurnReadScope {
			t.Fatalf("required scope = %q", requiredScope)
		}
		if actual.GetRuntimeAppId() != "desktop.app" ||
			actual.GetAgentId() != localAgentRef ||
			actual.GetConversationAnchorId() != anchorID {
			t.Fatalf("scoped binding relation mismatch: %#v", actual)
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
	}})

	subscribeCtx := testRuntimeAgentIdentityContext("agent-alpha")
	subscribeCtx.AppId = "desktop.app"
	subscribeCtx.ScopedBinding = &runtimev1.ScopedRuntimeBindingAttachment{
		BindingId:            "binding-voice-read",
		RuntimeAppId:         "desktop.app",
		AgentId:              localAgentRef,
		ConversationAnchorId: anchorID,
	}
	stream := newAgentVoiceStreamCaptureStreamLimit(context.Background(), 1)
	err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		Context:              subscribeCtx,
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
	}, stream)
	if err != context.Canceled {
		t.Fatalf("scoped voice stream subscription error=%v, want context.Canceled after first chunk", err)
	}
	if validatorCalls != 1 {
		t.Fatalf("expected one scoped binding validation, got %d", validatorCalls)
	}
	if len(stream.events) != 1 || string(stream.events[0].GetChunk()) != "RIFF-scoped-subscribe" {
		t.Fatalf("scoped voice stream did not receive expected chunk: %#v", stream.events)
	}
}

func TestPublicChatNativeVoiceStreamSubscribeAcceptsBindingIDOnlyWithCanonicalRelation(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-scoped-voice-subscribe-id-only",
		StreamID:             "stream-scoped-voice-subscribe-id-only",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-scoped-subscribe-id-only"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            "message-scoped-voice-subscribe-id-only",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-scoped-subscribe-id-only"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	var validatorCalls int
	svc.SetScopedBindingValidator(stubScopedBindingValidator{
		resolve: func(bindingID string) *runtimev1.ScopedAppBindingRelation {
			if bindingID != "binding-voice-read-id-only" {
				t.Fatalf("resolved binding id = %q", bindingID)
			}
			return &runtimev1.ScopedAppBindingRelation{
				RuntimeAppId:         "desktop.app",
				AppInstanceId:        "desktop.app.local-first-party",
				WindowId:             "window-from-runtime",
				AgentId:              localAgentRef,
				ConversationAnchorId: anchorID,
				WorldId:              "world-from-runtime",
			}
		},
		validate: func(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
			validatorCalls++
			if bindingID != "binding-voice-read-id-only" {
				t.Fatalf("binding id = %q", bindingID)
			}
			if requiredScope != runtimeAgentTurnReadScope {
				t.Fatalf("required scope = %q", requiredScope)
			}
			if actual.GetRuntimeAppId() != "desktop.app" ||
				actual.GetAppInstanceId() != "desktop.app.local-first-party" ||
				actual.GetWindowId() != "window-from-runtime" ||
				actual.GetAgentId() != localAgentRef ||
				actual.GetConversationAnchorId() != anchorID ||
				actual.GetWorldId() != "world-from-runtime" {
				t.Fatalf("canonical scoped binding relation was not completed: %#v", actual)
			}
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
		},
	})

	subscribeCtx := testRuntimeAgentIdentityContext("agent-alpha")
	subscribeCtx.AppId = "desktop.app"
	subscribeCtx.ScopedBinding = &runtimev1.ScopedRuntimeBindingAttachment{
		BindingId: "binding-voice-read-id-only",
	}
	stream := newAgentVoiceStreamCaptureStreamLimit(context.Background(), 1)
	err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		Context:              subscribeCtx,
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
	}, stream)
	if err != context.Canceled {
		t.Fatalf("scoped voice stream subscription error=%v, want context.Canceled after first chunk", err)
	}
	if validatorCalls != 1 {
		t.Fatalf("expected one scoped binding validation, got %d", validatorCalls)
	}
	if len(stream.events) != 1 || string(stream.events[0].GetChunk()) != "RIFF-scoped-subscribe-id-only" {
		t.Fatalf("scoped voice stream did not receive expected chunk: %#v", stream.events)
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
			},
	})
	if err != nil {
		t.Fatalf("structpb.NewStruct(voice policy metadata): %v", err)
	}
	return metadata
}

func setPublicChatTestPresentationProfile(t *testing.T, svc *Service, agentID string, callerAppID string, subjectUserID string, avatarAutoplay bool) {
	t.Helper()
	ctx := testLocalAgentContext(subjectUserID, agentID)
	ctx.AppId = callerAppID
	_, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context: ctx,
		AgentId: ctx.GetLocalAgentRef(),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef:        "runtime-presentation-avatar:test-vrm",
				ExpressionProfileRef:  "expression://test/calm",
				IdlePreset:            "idle-soft",
				InteractionPolicyRef:  "policy://test/ambient",
				DefaultVoiceReference: "preset_voice_id:nimi-default",
				AvatarAutoplay:        avatarAutoplay,
			},
		},
	})
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile: %v", err)
	}
}

type blockingNativeVoiceScenarioExecutor struct {
	streamReq  *runtimev1.StreamScenarioRequest
	firstChunk chan struct{}
	release    chan struct{}
	canceled   chan struct{}
}

func newBlockingNativeVoiceScenarioExecutor() *blockingNativeVoiceScenarioExecutor {
	return &blockingNativeVoiceScenarioExecutor{
		firstChunk: make(chan struct{}),
		release:    make(chan struct{}),
		canceled:   make(chan struct{}),
	}
}

func (f *blockingNativeVoiceScenarioExecutor) SubmitScenarioJob(context.Context, *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	return nil, fmt.Errorf("blocking native voice test must not submit async batch job")
}

func (f *blockingNativeVoiceScenarioExecutor) GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	return nil, fmt.Errorf("blocking native voice test must not poll async batch job")
}

func (f *blockingNativeVoiceScenarioExecutor) GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return nil, fmt.Errorf("blocking native voice test must not read async batch artifacts")
}

func (f *blockingNativeVoiceScenarioExecutor) StreamScenario(req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	f.streamReq = req
	if err := stream.Send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
		Payload: &runtimev1.StreamScenarioEvent_Started{
			Started: &runtimev1.ScenarioStreamStarted{
				ModelResolved:   "speech/qwen3tts-native-interrupt",
				RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				VoiceOutputMode: runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
			},
		},
	}); err != nil {
		return err
	}
	if err := stream.Send(nativeVoiceArtifactDeltaEvent([]byte("RIFF-native-interrupt-1"))); err != nil {
		return err
	}
	close(f.firstChunk)
	select {
	case <-stream.Context().Done():
		close(f.canceled)
		return stream.Context().Err()
	case <-f.release:
		return stream.Send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
			Payload: &runtimev1.StreamScenarioEvent_Completed{
				Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
			},
		})
	}
}

func (f *blockingNativeVoiceScenarioExecutor) waitCanceled(t *testing.T) {
	t.Helper()
	timeout := time.NewTimer(10 * time.Second)
	defer timeout.Stop()
	select {
	case <-f.canceled:
	case <-timeout.C:
		t.Fatal("timed out waiting for native voice provider stream cancellation")
	}
}

func nativeVoiceArtifactDeltaEvent(chunk []byte) *runtimev1.StreamScenarioEvent {
	return &runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
		Payload: &runtimev1.StreamScenarioEvent_Delta{
			Delta: &runtimev1.ScenarioStreamDelta{
				Delta: &runtimev1.ScenarioStreamDelta_Artifact{
					Artifact: &runtimev1.ArtifactStreamDelta{
						Chunk:    chunk,
						MimeType: "audio/wav",
					},
				},
			},
		},
	}
}

func indexOfMessageType(types []string, want string) int {
	for index, messageType := range types {
		if messageType == want {
			return index
		}
	}
	return -1
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
