package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const defaultRuntimeAgentVoiceInterruptReason = "runtime_voice_interrupt_requested"

func (s *Service) InterruptAgentVoicePlayback(ctx context.Context, req *runtimev1.InterruptAgentVoicePlaybackRequest) (*runtimev1.InterruptAgentVoicePlaybackResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "interrupt agent voice playback request is required")
	}
	identity, _, err := s.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	if err := s.authorizeBundledAvatarIdentity(ctx, req.GetContext(), identity, runtimeAgentTurnWriteScope); err != nil {
		return nil, err
	}
	callerAppID := strings.TrimSpace(req.GetContext().GetAppId())
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	turnID := strings.TrimSpace(req.GetTurnId())
	voiceStreamID := strings.TrimSpace(req.GetVoiceStreamId())
	if callerAppID == "" || anchorID == "" || turnID == "" || voiceStreamID == "" {
		return nil, status.Error(codes.InvalidArgument, "voice playback interrupt requires app_id, conversation_anchor_id, turn_id, and voice_stream_id")
	}
	scopedBinding := req.GetContext().GetScopedBinding()
	if scopedBinding == nil {
		scopedBinding = scopedBindingAttachmentFromIncomingMetadata(ctx)
	}
	if scopedBinding != nil {
		if scopedBindingAttachmentConversationAnchorMismatches(scopedBinding, anchorID) {
			return nil, status.Error(codes.PermissionDenied, "voice playback scoped binding conversation_anchor_id mismatch")
		}
		if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, identity.LocalAgentRef, runtimeAgentTurnWriteScope); err != nil {
			return nil, err
		}
	}
	session, turn, err := s.resolveVoicePlaybackTurnScope(callerAppID, identity, anchorID, turnID, scopedBinding, runtimeAgentTurnWriteScope)
	if err != nil {
		return nil, err
	}
	reason := normalizeRuntimeAgentVoiceInterruptReason(req.GetReason())
	terminal, fresh, err := s.interruptAgentVoiceStream(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: session.ConversationAnchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		Terminal:             true,
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED,
		TerminalReason:       reason,
	})
	if err != nil {
		return nil, err
	}
	switch terminal.GetVoicePlaybackState() {
	case runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED:
	case runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_CANCELED:
	default:
		return nil, status.Error(codes.FailedPrecondition, "agent voice stream is already terminal")
	}
	if fresh {
		if err := s.publicChatRuntime().emitVoicePlaybackTerminalTimelineEvent(session, turn, publicChatVoicePlaybackTerminalProjection{
			VoiceStreamID:      voiceStreamID,
			MessageID:          terminal.GetMessageId(),
			VoiceOutputMode:    runtimeAgentVoiceOutputModeName(terminal.GetVoiceOutputMode()),
			VoicePlaybackState: "interrupted",
			PlaybackTarget:     firstNonEmpty(strings.TrimSpace(terminal.GetPlaybackTarget()), "avatar_autoplay"),
			TerminalReason:     reason,
		}); err != nil {
			return nil, err
		}
	}
	return &runtimev1.InterruptAgentVoicePlaybackResponse{
		VoiceStreamId:      voiceStreamID,
		VoiceOutputMode:    terminal.GetVoiceOutputMode(),
		VoicePlaybackState: terminal.GetVoicePlaybackState(),
		TerminalReason:     strings.TrimSpace(terminal.GetTerminalReason()),
	}, nil
}

func (s *Service) resolveVoicePlaybackTurnScope(
	callerAppID string,
	identity localAgentIdentity,
	anchorID string,
	turnID string,
	scopedBinding *runtimev1.ScopedRuntimeBindingAttachment,
	requiredScope string,
) (publicChatAnchorState, publicChatTurnState, error) {
	session, err := s.resolveVoicePlaybackAnchorScope(callerAppID, identity, anchorID, scopedBinding, requiredScope)
	if err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, err
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[turnID]
	if turn == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.NotFound, "public chat turn not found")
	}
	if strings.TrimSpace(turn.ConversationAnchorID) != strings.TrimSpace(session.ConversationAnchorID) {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.NotFound, "public chat turn not found under referenced anchor")
	}
	return session, *turn, nil
}

func (s *Service) resolveVoicePlaybackAnchorScope(
	callerAppID string,
	identity localAgentIdentity,
	anchorID string,
	scopedBinding *runtimev1.ScopedRuntimeBindingAttachment,
	requiredScope string,
) (publicChatAnchorState, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if strings.TrimSpace(session.CallerAppID) != callerAppID && !s.avatarLiveInstanceBindingAuthorizesAnchorLocked(callerAppID, anchorID, identity) {
		if scopedBinding == nil {
			return publicChatAnchorState{}, status.Error(codes.PermissionDenied, "public chat anchor caller mismatch")
		}
		if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, identity.LocalAgentRef, requiredScope); err != nil {
			return publicChatAnchorState{}, err
		}
	}
	if strings.TrimSpace(session.OwnerUserID) != identity.OwnerUserID ||
		strings.TrimSpace(session.RuntimeSourceRef) != identity.RuntimeSourceRef ||
		strings.TrimSpace(session.LocalAgentRef) != identity.LocalAgentRef {
		return publicChatAnchorState{}, status.Error(codes.FailedPrecondition, "public chat anchor local identity mismatch")
	}
	return *session, nil
}

func normalizeRuntimeAgentVoiceInterruptReason(value string) string {
	reason := strings.TrimSpace(value)
	if reason == "" {
		return defaultRuntimeAgentVoiceInterruptReason
	}
	return reason
}

func runtimeAgentVoiceOutputModeName(mode runtimev1.VoiceOutputMode) string {
	switch mode {
	case runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM:
		return "native_stream"
	case runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_SIMULATED_STREAM:
		return "simulated_stream"
	case runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_BATCH_FINAL_ARTIFACT:
		return "batch_final_artifact"
	case runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_TEXT_ONLY:
		return "text_only"
	default:
		return ""
	}
}
