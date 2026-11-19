package runtimeagent

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

func (r publicChatRuntime) synthesizeCompletedTurnVoice(
	ctx context.Context,
	callerAppID string,
	subjectUserID string,
	requestID string,
	req publicChatTurnVoiceRenderPayload,
) (publicChatAnchorState, publicChatTurnState, voiceLipsyncSynthesisOutput, string, error) {
	session, turn, text, err := r.resolveCompletedTurnVoiceRender(ctx, callerAppID, subjectUserID, req)
	if err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, voiceLipsyncSynthesisOutput{}, "", err
	}
	if r.svc == nil || r.svc.voiceLipsync == nil {
		return session, turn, voiceLipsyncSynthesisOutput{}, "VOICE_ROUTE_UNAVAILABLE", nil
	}
	policy, ok, policyReason := r.agentVoiceOutputPolicyForSession(ctx, session)
	if !ok {
		terminalReason := strings.TrimSpace(policyReason)
		if terminalReason == "" {
			terminalReason = "VOICE_POLICY_UNCONFIGURED"
		}
		return session, turn, voiceLipsyncSynthesisOutput{}, terminalReason, nil
	}
	synthesisInput := voiceLipsyncSynthesisInput{
		Context:                ctx,
		TurnID:                 turn.TurnID,
		MessageID:              strings.TrimSpace(req.MessageID),
		Text:                   text,
		DefaultVoiceReference:  policy.DefaultVoiceReference,
		SpeechModelID:          policy.SpeechModelID,
		SpeechRoutePolicy:      policy.SpeechRoutePolicy,
		SpeechConnectorID:      policy.SpeechConnectorID,
		SpeechTargetRef:        clonePublicChatTargetRef(policy.SpeechTargetRef),
		SpeechExecutionIntent:  executionintent.Clone(policy.SpeechExecutionIntent),
		SpeechLocalExecution:   localexecution.CloneSelectedLocalExecution(policy.SpeechLocalExecution),
		SpeechLocalIntent:      policy.SpeechLocalIntent,
		SpeechRequiredFeatures: append([]string(nil), policy.SpeechRequiredFeatures...),
		SpeechAppID:            policy.SpeechAppID,
		OwnerUserID:            policy.OwnerUserID,
		AgentID:                session.AgentID,
		IdempotencyKey:         runtimeAgentManualVoiceLipsyncIdempotencyKey(turn.TurnID, req.MessageID, requestID),
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
		return session, turn, voiceLipsyncSynthesisOutput{}, voiceProjectionTerminalReason(err, "VOICE_SYNTHESIS_FAILED"), nil
	}
	if strings.TrimSpace(out.AudioArtifactID) == "" {
		return session, turn, voiceLipsyncSynthesisOutput{}, "VOICE_OUTPUT_INVALID", nil
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
		return session, turn, voiceLipsyncSynthesisOutput{}, "VOICE_ARTIFACT_UNAVAILABLE", nil
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
		return session, turn, voiceLipsyncSynthesisOutput{}, "VOICE_ARTIFACT_RETENTION_FAILED", nil
	}
	return session, turn, out, "", nil
}

func (r publicChatRuntime) resolveCompletedTurnVoiceRender(ctx context.Context, callerAppID string, subjectUserID string, req publicChatTurnVoiceRenderPayload) (publicChatAnchorState, publicChatTurnState, string, error) {
	anchorID := strings.TrimSpace(req.ConversationAnchorID)
	turnID := strings.TrimSpace(req.TurnID)
	messageID := strings.TrimSpace(req.MessageID)
	trimmedSubjectUserID := strings.TrimSpace(subjectUserID)
	if strings.TrimSpace(callerAppID) == "" || trimmedSubjectUserID == "" || anchorID == "" || turnID == "" || messageID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	r.svc.chatSurfaceMu.Lock()
	defer r.svc.chatSurfaceMu.Unlock()
	session := r.svc.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, "", grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	if strings.TrimSpace(session.SubjectUserID) != trimmedSubjectUserID {
		return publicChatAnchorState{}, publicChatTurnState{}, "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	if err := r.svc.loadVoiceRenderTurnLocked(ctx, session, turnID); err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, "", err
	}
	projection := publicChatCompletedTurnProjectionForLocalAppMessageLocked(session, turnID, messageID)
	if projection == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, "", grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	text := strings.TrimSpace(projection.AssistantText)
	if text == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if requestText := strings.TrimSpace(req.Text); requestText != "" && requestText != text {
		return publicChatAnchorState{}, publicChatTurnState{}, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if strings.TrimSpace(projection.StreamID) == "" || projection.TimelineStartedAt.IsZero() {
		return publicChatAnchorState{}, publicChatTurnState{}, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	sessionSnapshot := *session
	// Manual replay records the authenticated requester as projection origin.
	// CallerAppID is informational only and never targets the conversation
	// broadcast or partitions authorization.
	sessionSnapshot.CallerAppID = strings.TrimSpace(callerAppID)
	sessionSnapshot.CommittedTranscript = nil
	sessionSnapshot.CompletedTurnSnapshots = nil
	sessionSnapshot.Recoveries = nil
	sessionSnapshot.VoiceSidecars = nil
	sessionSnapshot.VoiceRenderRequests = nil
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

func publicChatCompletedTurnProjectionForLocalAppMessageLocked(session *publicChatAnchorState, turnID string, messageID string) *publicChatTurnProjectionState {
	projection := publicChatVoiceEligibleTurnProjectionLocked(session, turnID)
	if projection == nil || localAppConversationMessageID(turnID, "assistant", "") != strings.TrimSpace(messageID) {
		return nil
	}
	return projection
}

func publicChatVoiceEligibleTurnProjectionLocked(session *publicChatAnchorState, turnID string) *publicChatTurnProjectionState {
	if session == nil {
		return nil
	}
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return nil
	}
	if projection := session.CompletedTurnSnapshots[trimmedTurnID]; publicChatProjectionIsVoiceEligible(projection, trimmedTurnID) {
		return projection
	}
	if publicChatProjectionIsVoiceEligible(session.LastTurnSnapshot, trimmedTurnID) {
		return session.LastTurnSnapshot
	}
	return nil
}

func publicChatProjectionIsVoiceEligible(projection *publicChatTurnProjectionState, turnID string) bool {
	return projection != nil &&
		(projection.Status == publicChatTurnStatusCompleted || projection.Status == publicChatTurnStatusFailed || projection.Status == publicChatTurnStatusInterrupted) &&
		strings.TrimSpace(projection.AssistantText) != "" &&
		strings.TrimSpace(projection.TurnID) == strings.TrimSpace(turnID)
}

// A manual render binds to a single durable assistant message, including the
// same turn's optional sidecar. No other transcript or voice is needed.
func (s *Service) loadVoiceRenderTurnLocked(ctx context.Context, a *publicChatAnchorState, id string) error {
	var body, origin string
	var projection, sidecar sql.NullString
	var completed bool
	err := s.backend.DB().QueryRowContext(ctx, `SELECT json_extract(t.turn_json,'$.assistantText'), json_extract(t.turn_json,'$.origin'),p.projection_json,p.completed,v.voice_json
 FROM runtime_conversation_turn t JOIN runtime_conversation_projection p ON p.anchor_id=t.anchor_id AND p.turn_id=t.turn_id
 LEFT JOIN runtime_conversation_voice v ON v.anchor_id=t.anchor_id AND v.turn_id=t.turn_id WHERE t.anchor_id=? AND t.turn_id=?`, a.ConversationAnchorID, id).Scan(&body, &origin, &projection, &completed, &sidecar)
	if err == sql.ErrNoRows || err == nil && (body == "" || origin != publicChatTurnOriginUser && origin != publicChatTurnOriginApp && !isProactiveOrigin(origin)) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	if err != nil {
		return err
	}
	if publicChatVoiceEligibleTurnProjectionLocked(a, id) == nil && completed && projection.Valid {
		var p persistedPublicChatTurnSnapshot
		if err := decodeConversationRow(projection.String, &p); err != nil {
			return err
		}
		if p.TurnID != id {
			return fmt.Errorf("stored voice target identity mismatch")
		}
		if err := restoreConversationProjectionText(&p, body); err != nil {
			return err
		}
		if a.CompletedTurnSnapshots == nil {
			a.CompletedTurnSnapshots = make(map[string]*publicChatTurnProjectionState)
		}
		a.CompletedTurnSnapshots[id] = fromPersistedPublicChatTurnSnapshot(&p)
	}
	if publicChatVoiceEligibleTurnProjectionLocked(a, id) == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if a.VoiceSidecars[id] == nil && sidecar.Valid {
		var voice publicChatVoiceSidecarState
		if err := decodeConversationRow(sidecar.String, &voice); err != nil {
			return err
		}
		if voice.TurnID != id {
			return fmt.Errorf("stored voice sidecar identity mismatch")
		}
		if a.VoiceSidecars == nil {
			a.VoiceSidecars = make(map[string]*publicChatVoiceSidecarState)
		}
		a.VoiceSidecars[id] = &voice
	}
	return nil
}
