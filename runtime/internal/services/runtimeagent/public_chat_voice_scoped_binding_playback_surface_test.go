package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func publicChatVoiceScopedBinding(bindingID string, runtimeAppID string, agentID string, anchorID string) *runtimev1.ScopedRuntimeBindingAttachment {
	return &runtimev1.ScopedRuntimeBindingAttachment{
		BindingId:            bindingID,
		RuntimeAppId:         runtimeAppID,
		AgentId:              testRuntimeAgentLocalRef(agentID),
		ConversationAnchorId: anchorID,
	}
}

func TestPublicChatNativeVoiceStreamSubscribeAllowsScopedBindingPlaybackSurface(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-scoped-binding-voice-subscribe",
		StreamID:             "stream-scoped-binding-voice-subscribe",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
		TimelineStartedAt:    time.Now(),
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-scoped-binding-subscribe"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            "message-scoped-binding-voice-subscribe",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-scoped-binding-subscribe"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	subscribeCtx := testRuntimeAgentIdentityContext("agent-alpha")
	subscribeCtx.AppId = "nimi.zhiyu"
	subscribeCtx.ScopedBinding = publicChatVoiceScopedBinding("binding-scoped-voice-subscribe", "nimi.zhiyu", "agent-alpha", anchorID)
	stream := newAgentVoiceStreamCaptureStreamLimit(context.Background(), 1)
	err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		Context:              subscribeCtx,
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
	}, stream)
	if err != context.Canceled {
		t.Fatalf("scoped binding voice stream subscription error=%v, want context.Canceled after first chunk", err)
	}
	if len(stream.events) != 1 {
		t.Fatalf("scoped binding voice stream subscription expected one chunk, got %#v", stream.events)
	}
	if got := string(stream.events[0].GetChunk()); got != "RIFF-scoped-binding-subscribe" {
		t.Fatalf("scoped binding voice stream chunk = %q", got)
	}
}

func TestPublicChatNativeVoiceInterruptAllowsScopedBindingPlaybackSurface(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetScopedBindingValidator(stubScopedBindingValidator{
		validate: func(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
			if strings.TrimSpace(bindingID) != "binding-scoped-voice-interrupt" ||
				actual == nil ||
				strings.TrimSpace(actual.GetRuntimeAppId()) != "nimi.zhiyu" ||
				strings.TrimSpace(actual.GetAgentId()) != testRuntimeAgentLocalRef("agent-alpha") ||
				strings.TrimSpace(actual.GetConversationAnchorId()) == "" ||
				strings.TrimSpace(requiredScope) != "runtime.agent.turn.write" {
				return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND, false
			}
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_UNSPECIFIED, true
		},
	})
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-scoped-binding-voice-interrupt",
		StreamID:             "stream-scoped-binding-voice-interrupt",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
		TimelineStartedAt:    time.Now(),
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()

	voiceStreamID := "runtime-agent-voice-stream:test-scoped-binding-interrupt"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            "message-scoped-binding-voice-interrupt",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-scoped-binding-interrupt"),
		MimeType:             "audio/wav",
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
	})

	interruptCtx := testRuntimeAgentIdentityContext("agent-alpha")
	interruptCtx.AppId = "nimi.zhiyu"
	interruptCtx.ScopedBinding = publicChatVoiceScopedBinding("binding-scoped-voice-interrupt", "nimi.zhiyu", "agent-alpha", anchorID)
	resp, err := svc.InterruptAgentVoicePlayback(context.Background(), &runtimev1.InterruptAgentVoicePlaybackRequest{
		Context:              interruptCtx,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		VoiceStreamId:        voiceStreamID,
		Reason:               "scoped_binding_voice_interrupt",
	})
	if err != nil {
		t.Fatalf("scoped binding InterruptAgentVoicePlayback: %v", err)
	}
	if resp.GetVoicePlaybackState() != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED {
		t.Fatalf("scoped binding interrupt playback state=%v", resp.GetVoicePlaybackState())
	}
	if got := svc.agentVoiceStreamTerminalState(voiceStreamID); got != runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED {
		t.Fatalf("scoped binding interrupt terminal state=%v", got)
	}
}
