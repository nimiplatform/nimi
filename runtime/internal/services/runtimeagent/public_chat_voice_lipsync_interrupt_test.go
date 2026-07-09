package runtimeagent

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPublicChatNativeVoicePlaybackInterruptCancelsStreamAndEmitsTerminalTruth(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	metadata := publicChatVoicePolicyMetadata(t, true)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
	setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", true)
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
