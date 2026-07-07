package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/metadata"
)

func TestPublicChatNativeVoiceInterruptValidatesScopedBinding(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-scoped-voice-interrupt",
		StreamID:             "stream-scoped-voice-interrupt",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
		TimelineStartedAt:    time.Now().Add(-time.Millisecond),
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-scoped-interrupt"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            "message-scoped-voice-interrupt",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-scoped-interrupt"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	var validatorCalls int
	svc.SetScopedBindingValidator(stubScopedBindingValidator{validate: func(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
		validatorCalls++
		if bindingID != "binding-voice-write" {
			t.Fatalf("binding id = %q", bindingID)
		}
		if requiredScope != runtimeAgentTurnWriteScope {
			t.Fatalf("required scope = %q", requiredScope)
		}
		if actual.GetRuntimeAppId() != "desktop.app" ||
			actual.GetAgentId() != localAgentRef ||
			actual.GetConversationAnchorId() != anchorID {
			t.Fatalf("scoped binding relation mismatch: %#v", actual)
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
	}})

	interruptCtx := testRuntimeAgentIdentityContext("agent-alpha")
	interruptCtx.AppId = "desktop.app"
	interruptCtx.ScopedBinding = &runtimev1.ScopedRuntimeBindingAttachment{
		BindingId:            "binding-voice-write",
		RuntimeAppId:         "desktop.app",
		AgentId:              localAgentRef,
		ConversationAnchorId: anchorID,
	}
	resp, err := svc.InterruptAgentVoicePlayback(context.Background(), &runtimev1.InterruptAgentVoicePlaybackRequest{
		Context:              interruptCtx,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		VoiceStreamId:        voiceStreamID,
		Reason:               "scoped_voice_interrupt",
	})
	if err != nil {
		t.Fatalf("InterruptAgentVoicePlayback: %v", err)
	}
	if validatorCalls != 1 {
		t.Fatalf("expected one scoped binding validation, got %d", validatorCalls)
	}
	if resp.GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED ||
		resp.GetTerminalReason() != "scoped_voice_interrupt" {
		t.Fatalf("scoped voice interrupt response mismatch: %#v", resp)
	}
}

func TestPublicChatNativeVoiceInterruptAcceptsBindingIDOnlyWithCanonicalRelation(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-scoped-voice-interrupt-id-only",
		StreamID:             "stream-scoped-voice-interrupt-id-only",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
		TimelineStartedAt:    time.Now().Add(-time.Millisecond),
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-scoped-interrupt-id-only"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            "message-scoped-voice-interrupt-id-only",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-scoped-interrupt-id-only"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	var validatorCalls int
	svc.SetScopedBindingValidator(stubScopedBindingValidator{
		resolve: func(bindingID string) *runtimev1.ScopedAppBindingRelation {
			if bindingID != "binding-voice-write-id-only" {
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
			if bindingID != "binding-voice-write-id-only" {
				t.Fatalf("binding id = %q", bindingID)
			}
			if requiredScope != runtimeAgentTurnWriteScope {
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

	interruptCtx := testRuntimeAgentIdentityContext("agent-alpha")
	interruptCtx.AppId = "desktop.app"
	rpcCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-runtime-scoped-binding-id",
		"binding-voice-write-id-only",
	))
	resp, err := svc.InterruptAgentVoicePlayback(rpcCtx, &runtimev1.InterruptAgentVoicePlaybackRequest{
		Context:              interruptCtx,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		VoiceStreamId:        voiceStreamID,
		Reason:               "scoped_voice_interrupt_id_only",
	})
	if err != nil {
		t.Fatalf("InterruptAgentVoicePlayback: %v", err)
	}
	if validatorCalls != 1 {
		t.Fatalf("expected one scoped binding validation, got %d", validatorCalls)
	}
	if resp.GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED ||
		resp.GetTerminalReason() != "scoped_voice_interrupt_id_only" {
		t.Fatalf("scoped voice interrupt response mismatch: %#v", resp)
	}
}

func TestPublicChatNativeVoiceStreamSubscribeAllowsBoundAvatarPlaybackSurface(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	desktopCtx := testRuntimeAgentIdentityContext("agent-alpha")
	desktopCtx.AppId = "desktop.app"
	if _, err := svc.RegisterAvatarLiveInstanceBinding(context.Background(), &runtimev1.RegisterAvatarLiveInstanceBindingRequest{
		Context:              desktopCtx,
		AvatarInstanceId:     "avatar-instance-voice-stream",
		ConversationAnchorId: anchorID,
	}); err != nil {
		t.Fatalf("RegisterAvatarLiveInstanceBinding: %v", err)
	}
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-bound-avatar-voice-subscribe",
		StreamID:             "stream-bound-avatar-voice-subscribe",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-bound-avatar-subscribe"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            "message-bound-avatar-voice-subscribe",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-bound-avatar-subscribe"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	avatarCtx := testRuntimeAgentIdentityContext("agent-alpha")
	avatarCtx.AppId = defaultAvatarRuntimeAppID
	stream := newAgentVoiceStreamCaptureStreamLimit(context.Background(), 1)
	err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		Context:              avatarCtx,
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
	}, stream)
	if err != context.Canceled {
		t.Fatalf("bound avatar voice stream subscription error=%v, want context.Canceled after first chunk", err)
	}
	if len(stream.events) != 1 {
		t.Fatalf("bound avatar voice stream subscription expected one chunk, got %#v", stream.events)
	}
	if got := string(stream.events[0].GetChunk()); got != "RIFF-bound-avatar-subscribe" {
		t.Fatalf("bound avatar voice stream chunk = %q", got)
	}
}

func TestPublicChatManualVoiceRenderEmitsDesktopManualProjectionWithoutAvatarAutoplay(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestExecutionConfig(t, svc, publicChatTestAudioSynthesizeBinding())
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
			"runtime_source_ref":     "agent-alpha",
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
	upsertPublicChatTestExecutionConfig(t, svc, publicChatTestAudioSynthesizeBinding())
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
	upsertPublicChatTestExecutionConfig(t, svc, publicChatTestAudioSynthesizeBinding())
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
