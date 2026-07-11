package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (r publicChatRuntime) handleTurnVoiceRender(ctx context.Context, event *runtimev1.AppMessageEvent, req publicChatTurnVoiceRenderPayload) error {
	session, turn, text, err := r.resolveCompletedTurnVoiceRender(event.GetFromAppId(), event.GetSubjectUserId(), req)
	if err != nil {
		return err
	}
	if r.svc == nil || r.svc.voiceLipsync == nil {
		return nil
	}
	policy, ok := r.agentVoiceOutputPolicyForSession(session)
	if !ok {
		return nil
	}
	synthesisInput := voiceLipsyncSynthesisInput{
		Context:               ctx,
		TurnID:                turn.TurnID,
		MessageID:             strings.TrimSpace(req.MessageID),
		Text:                  text,
		DefaultVoiceReference: policy.DefaultVoiceReference,
		SpeechModelID:         policy.SpeechModelID,
		SpeechRoutePolicy:     policy.SpeechRoutePolicy,
		SpeechConnectorID:     policy.SpeechConnectorID,
		SpeechTargetRef:       clonePublicChatTargetRef(policy.SpeechTargetRef),
		AgentID:               session.AgentID,
		IdempotencyKey:        runtimeAgentManualVoiceLipsyncIdempotencyKey(turn.TurnID, req.MessageID, event.GetMessageId()),
	}
	out, err := r.svc.voiceLipsync.synthesize(synthesisInput)
	if err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("manual voice render failed",
				"agent_id", session.AgentID,
				"turn_id", turn.TurnID,
				"message_id", req.MessageID,
				"error", err,
			)
		}
		return nil
	}
	if strings.TrimSpace(out.AudioArtifactID) == "" {
		return nil
	}
	if err := r.svc.verifyVoiceAudioArtifact(out); err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("manual voice render artifact unavailable",
				"agent_id", session.AgentID,
				"turn_id", turn.TurnID,
				"message_id", req.MessageID,
				"audio_artifact_id", out.AudioArtifactID,
				"error", err,
			)
		}
		return nil
	}
	if err := r.svc.retainGeneratedVoiceArtifact(synthesisInput, out, session); err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("manual voice render artifact metadata unavailable",
				"agent_id", session.AgentID,
				"turn_id", turn.TurnID,
				"message_id", req.MessageID,
				"audio_artifact_id", out.AudioArtifactID,
				"error", err,
			)
		}
		return nil
	}
	playbackTarget := strings.TrimSpace(req.PlaybackTarget)
	if playbackTarget == "" {
		playbackTarget = "desktop_manual"
	}
	if err := r.emitVoiceStreamChunkTimelineEventForSnapshot(session, turn, publicChatVoiceStreamChunkProjection{
		AudioArtifactID:    out.AudioArtifactID,
		AudioMimeType:      out.AudioMimeType,
		MessageID:          strings.TrimSpace(req.MessageID),
		ChunkSequence:      1,
		FinalChunk:         true,
		VoiceOutputMode:    "batch_final_artifact",
		VoicePlaybackState: "active",
		DurationMs:         out.DurationMs,
		Reason:             "manual_render_final_artifact_available",
		PlaybackTarget:     playbackTarget,
	}); err != nil {
		return err
	}
	return r.emitVoicePlaybackTimelineEventForSnapshot(session, turn, publicChatVoicePlaybackProjection{
		AudioArtifactID:       out.AudioArtifactID,
		AudioMimeType:         out.AudioMimeType,
		MessageID:             strings.TrimSpace(req.MessageID),
		DurationMs:            out.DurationMs,
		DefaultVoiceReference: out.DefaultVoiceReference,
		VoiceRouteBinding:     out.VoiceRouteBinding,
		PlaybackState:         "requested",
		VoiceOutputMode:       "batch_final_artifact",
		VoicePlaybackState:    "active",
		PlaybackTarget:        playbackTarget,
		FinalArtifact:         true,
		Reason:                "manual_render_requested",
	})
}

func (r publicChatRuntime) resolveCompletedTurnVoiceRender(callerAppID string, subjectUserID string, req publicChatTurnVoiceRenderPayload) (publicChatAnchorState, publicChatTurnState, string, error) {
	anchorID := strings.TrimSpace(req.ConversationAnchorID)
	turnID := strings.TrimSpace(req.TurnID)
	messageID := strings.TrimSpace(req.MessageID)
	trimmedSubjectUserID := strings.TrimSpace(subjectUserID)
	if strings.TrimSpace(callerAppID) == "" || trimmedSubjectUserID == "" || anchorID == "" || turnID == "" || messageID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, "", status.Error(codes.InvalidArgument, "public chat voice render requires caller, subject_user_id, conversation_anchor_id, turn_id, and message_id")
	}
	r.svc.chatSurfaceMu.Lock()
	defer r.svc.chatSurfaceMu.Unlock()
	session := r.svc.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, "", status.Error(codes.NotFound, "conversation anchor not found")
	}
	if err := validatePublicChatCommittedTranscript(session.CommittedTranscript); err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, "", status.Error(codes.DataLoss, err.Error())
	}
	if strings.TrimSpace(session.SubjectUserID) != trimmedSubjectUserID {
		return publicChatAnchorState{}, publicChatTurnState{}, "", status.Error(codes.PermissionDenied, "public chat anchor subject_user_id mismatch")
	}
	projection := publicChatCompletedTurnProjectionForMessageLocked(session, turnID, messageID)
	if projection == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, "", status.Error(codes.NotFound, "completed public chat message not found")
	}
	text := strings.TrimSpace(projection.AssistantText)
	if text == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, "", status.Error(codes.FailedPrecondition, "completed public chat message has no text")
	}
	if requestText := strings.TrimSpace(req.Text); requestText != "" && requestText != text {
		return publicChatAnchorState{}, publicChatTurnState{}, "", status.Error(codes.InvalidArgument, "public chat voice render text does not match committed message")
	}
	if strings.TrimSpace(projection.StreamID) == "" || projection.TimelineStartedAt.IsZero() {
		return publicChatAnchorState{}, publicChatTurnState{}, "", status.Error(codes.FailedPrecondition, "completed public chat turn timeline unavailable")
	}
	sessionSnapshot := *session
	// Manual replay is delivered to the authenticated requesting surface. The
	// anchor's last turn caller remains delivery history, never an app-id
	// authorization partition.
	sessionSnapshot.CallerAppID = strings.TrimSpace(callerAppID)
	sessionSnapshot.CommittedTranscript = clonePublicChatCommittedTranscript(session.CommittedTranscript)
	sessionSnapshot.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	sessionSnapshot.LastTurnSnapshot = clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	sessionSnapshot.CompletedTurnSnapshots = clonePublicChatTurnProjectionStateMap(session.CompletedTurnSnapshots)
	projectionSnapshot := clonePublicChatTurnProjectionState(projection)
	return sessionSnapshot, publicChatTurnState{
		ConversationAnchorID: sessionSnapshot.ConversationAnchorID,
		TurnID:               projection.TurnID,
		StreamID:             projection.StreamID,
		AgentID:              sessionSnapshot.AgentID,
		CallerAppID:          strings.TrimSpace(callerAppID),
		SubjectUserID:        sessionSnapshot.SubjectUserID,
		ThreadID:             sessionSnapshot.ThreadID,
		StreamSequence:       projectionSnapshot.StreamSequence,
		TimelineStartedAt:    projectionSnapshot.TimelineStartedAt,
		Origin:               firstNonEmpty(strings.TrimSpace(projection.Origin), publicChatTurnOriginUser),
		ChainID:              projection.ChainID,
		FollowUpDepth:        projection.FollowUpDepth,
		MaxFollowUpTurns:     projection.MaxFollowUpTurns,
		SourceTurnID:         projection.SourceTurnID,
		SourceActionID:       projection.SourceActionID,
	}, text, nil
}

func runtimeAgentManualVoiceLipsyncIdempotencyKey(turnID string, messageID string, requestID string) string {
	trimmedRequestID := strings.TrimSpace(requestID)
	if trimmedRequestID == "" {
		trimmedRequestID = ulid.Make().String()
	}
	return strings.Join([]string{
		"runtime-agent-voice-lipsync-manual",
		strings.TrimSpace(turnID),
		strings.TrimSpace(messageID),
		trimmedRequestID,
	}, ":")
}

func publicChatCompletedTurnProjectionForMessageLocked(session *publicChatAnchorState, turnID string, messageID string) *publicChatTurnProjectionState {
	projection := publicChatCompletedTurnProjectionByTurnLocked(session, turnID)
	if projection == nil || strings.TrimSpace(projection.MessageID) != strings.TrimSpace(messageID) {
		return nil
	}
	return projection
}

func publicChatCompletedTurnProjectionByTurnLocked(session *publicChatAnchorState, turnID string) *publicChatTurnProjectionState {
	if session == nil {
		return nil
	}
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return nil
	}
	if projection := session.CompletedTurnSnapshots[trimmedTurnID]; publicChatProjectionIsCompletedTurn(projection, trimmedTurnID) {
		return projection
	}
	for _, projection := range session.CompletedTurnSnapshots {
		if publicChatProjectionIsCompletedTurn(projection, trimmedTurnID) {
			return projection
		}
	}
	if publicChatProjectionIsCompletedTurn(session.LastTurnSnapshot, trimmedTurnID) {
		return session.LastTurnSnapshot
	}
	return nil
}

func publicChatProjectionIsCompletedTurn(projection *publicChatTurnProjectionState, turnID string) bool {
	return projection != nil &&
		projection.Status == publicChatTurnStatusCompleted &&
		strings.TrimSpace(projection.TurnID) == strings.TrimSpace(turnID)
}

func (r publicChatRuntime) emitVoicePlaybackTimelineEventForSnapshot(session publicChatAnchorState, turn publicChatTurnState, input publicChatVoicePlaybackProjection) error {
	detail, err := publicChatBuildVoicePlaybackDetail(input)
	if err != nil {
		return err
	}
	return r.emitTimelineEventForChannelSnapshot(session, turn, publicChatPresentationVoicePlaybackRequestedType, publicChatTimelineChannelVoice, detail)
}

func (r publicChatRuntime) emitVoiceStreamChunkTimelineEventForSnapshot(session publicChatAnchorState, turn publicChatTurnState, input publicChatVoiceStreamChunkProjection) error {
	detail, err := publicChatBuildVoiceStreamChunkDetail(input)
	if err != nil {
		return err
	}
	return r.emitTimelineEventForChannelSnapshot(session, turn, publicChatPresentationVoiceStreamChunkType, publicChatTimelineChannelVoice, detail)
}

func (r publicChatRuntime) emitTimelineEventForChannelSnapshot(session publicChatAnchorState, turn publicChatTurnState, messageType string, channel string, detail map[string]any) error {
	sequence, err := r.svc.nextPublicChatCompletedTurnStreamSequence(session.ConversationAnchorID, turn.TurnID)
	if err != nil {
		return err
	}
	turn.StreamSequence = sequence
	observedAt := time.Now().UTC()
	timeline, err := publicChatBuildTimelineEnvelopeForChannel(turn, channel, sequence, observedAt)
	if err != nil {
		return err
	}
	timeline["projection_rule_id"] = publicChatProjectionRuleIDForTimelineMessage(messageType)
	out := map[string]any{
		"agent_id":               session.AgentID,
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                strings.TrimSpace(turn.TurnID),
		"stream_id":              strings.TrimSpace(turn.StreamID),
		"timeline":               timeline,
		"detail":                 detail,
	}
	if err := r.emitEvent(session.CallerAppID, session.SubjectUserID, messageType, out); err != nil {
		return err
	}
	if err := r.emitPresentationAgentEventForTimeline(session, strings.TrimSpace(turn.TurnID), strings.TrimSpace(turn.StreamID), messageType, detail, observedAt); err != nil {
		return err
	}
	r.svc.persistCurrentPublicChatSurfaceState()
	return nil
}

func (s *Service) nextPublicChatCompletedTurnStreamSequence(anchorID string, turnID string) (uint64, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatAnchors[strings.TrimSpace(anchorID)]
	if session == nil {
		return 0, status.Error(codes.NotFound, "completed public chat turn not found")
	}
	projection := clonePublicChatTurnProjectionState(publicChatCompletedTurnProjectionByTurnLocked(session, turnID))
	if projection == nil {
		return 0, status.Error(codes.NotFound, "completed public chat turn not found")
	}
	projection.StreamSequence++
	projection.UpdatedAt = time.Now().UTC()
	session.UpdatedAt = projection.UpdatedAt
	trimmedTurnID := strings.TrimSpace(projection.TurnID)
	if session.CompletedTurnSnapshots == nil {
		session.CompletedTurnSnapshots = make(map[string]*publicChatTurnProjectionState)
	}
	session.CompletedTurnSnapshots[trimmedTurnID] = clonePublicChatTurnProjectionState(projection)
	if session.LastTurnSnapshot != nil && strings.TrimSpace(session.LastTurnSnapshot.TurnID) == trimmedTurnID {
		session.LastTurnSnapshot = clonePublicChatTurnProjectionState(projection)
	}
	return projection.StreamSequence, nil
}
