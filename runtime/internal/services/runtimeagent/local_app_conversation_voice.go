package runtimeagent

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

const (
	publicChatTurnVoiceReadyType  = "runtime.agent.turn.voice_ready"
	publicChatTurnVoiceFailedType = "runtime.agent.turn.voice_failed"
)

func clonePublicChatVoiceSidecars(
	input map[string]*publicChatVoiceSidecarState,
) map[string]*publicChatVoiceSidecarState {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]*publicChatVoiceSidecarState, len(input))
	for key, value := range input {
		if value == nil {
			continue
		}
		copy := *value
		out[key] = &copy
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (s *Service) commitLocalAppConversationVoiceReady(
	session publicChatAnchorState,
	turn publicChatTurnState,
	ownerMessageID string,
	artifactID string,
) error {
	artifactID = strings.TrimSpace(artifactID)
	if s == nil || s.runtimeArtifacts == nil || artifactID == "" {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	record, ok := s.runtimeArtifacts.Get(artifactID)
	if !ok || record.GeneratedVoice == nil || record.SizeBytes <= 0 ||
		record.SizeBytes != int64(len(record.Bytes)) || record.SizeBytes > runtimeartifact.MaxInlineBytes ||
		!strings.HasPrefix(strings.ToLower(strings.TrimSpace(record.MimeType)), "audio/") ||
		strings.TrimSpace(record.GeneratedVoice.AgentID) != strings.TrimSpace(session.AgentID) ||
		strings.TrimSpace(record.GeneratedVoice.ConversationAnchorID) != strings.TrimSpace(session.ConversationAnchorID) ||
		strings.TrimSpace(record.GeneratedVoice.TurnID) != strings.TrimSpace(turn.TurnID) ||
		(strings.TrimSpace(ownerMessageID) != "" && strings.TrimSpace(record.GeneratedVoice.MessageID) != strings.TrimSpace(ownerMessageID)) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	voice := localAppConversationVoiceState(turn.TurnID, "ready")
	voice.ArtifactID = artifactID
	if err := s.commitLocalAppConversationVoiceSidecar(session, turn, voice); err != nil {
		return err
	}
	return s.publishLocalAppConversationVoice(session.SubjectUserID, session.ConversationAnchorID, voice)
}

func (s *Service) commitLocalAppConversationVoiceFailed(
	session publicChatAnchorState,
	turn publicChatTurnState,
	terminalReason string,
) error {
	reasonCode := runtimev1.ReasonCode_AI_OUTPUT_INVALID
	if strings.Contains(strings.ToUpper(terminalReason), "UNAVAILABLE") ||
		strings.Contains(strings.ToUpper(terminalReason), "UNCONFIGURED") ||
		strings.Contains(strings.ToUpper(terminalReason), "ROUTE") {
		reasonCode = runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED
	}
	voice := localAppConversationVoiceState(turn.TurnID, "failed")
	voice.ReasonCode = reasonCode
	voice.Message = strings.TrimSpace(terminalReason)
	if voice.Message == "" {
		voice.Message = "VOICE_SYNTHESIS_FAILED"
	}
	if err := s.commitLocalAppConversationVoiceSidecar(session, turn, voice); err != nil {
		return err
	}
	return s.publishLocalAppConversationVoice(session.SubjectUserID, session.ConversationAnchorID, voice)
}

func localAppConversationVoiceState(turnID string, state string) *publicChatVoiceSidecarState {
	turnID = strings.TrimSpace(turnID)
	messageID := localAppConversationMessageID(turnID, "assistant", "")
	digest := sha256HexBytes([]byte(turnID + "\x00" + messageID + "\x00voice"))
	return &publicChatVoiceSidecarState{
		VoiceID:   "local_app_voice_" + digest[:24],
		TurnID:    turnID,
		MessageID: messageID,
		State:     state,
	}
}

func (s *Service) commitLocalAppConversationVoiceSidecar(
	session publicChatAnchorState,
	turn publicChatTurnState,
	voice *publicChatVoiceSidecarState,
) error {
	if voice == nil || !validLocalAppConversationSelector(voice.VoiceID) ||
		!validLocalAppConversationSelector(voice.TurnID) || !validLocalAppConversationSelector(voice.MessageID) ||
		(voice.State != "ready" && voice.State != "failed") ||
		(voice.State == "ready") != (strings.TrimSpace(voice.ArtifactID) != "") ||
		(voice.State == "failed") != (voice.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(session.ConversationAnchorID)]
	activeTurn := s.chatTurns[strings.TrimSpace(turn.TurnID)]
	completedTurn := publicChatCompletedTurnProjectionByTurnLocked(anchor, turn.TurnID)
	if anchor == nil || (activeTurn == nil && completedTurn == nil) ||
		(activeTurn != nil && (activeTurn.Interrupted ||
			strings.TrimSpace(activeTurn.ConversationAnchorID) != strings.TrimSpace(anchor.ConversationAnchorID))) {
		return grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
	foundTurn := false
	for _, transcriptTurn := range anchor.CommittedTranscript {
		if transcriptTurn.Origin == publicChatTurnOriginUser && transcriptTurn.TurnID == voice.TurnID &&
			strings.TrimSpace(transcriptTurn.AssistantText) != "" {
			foundTurn = true
			break
		}
	}
	if !foundTurn || voice.MessageID != localAppConversationMessageID(voice.TurnID, "assistant", "") {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	if existing := anchor.VoiceSidecars[voice.TurnID]; existing != nil {
		if *existing == *voice {
			return nil
		}
		return grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	before := clonePublicChatVoiceSidecars(anchor.VoiceSidecars)
	updatedAtBefore := anchor.UpdatedAt
	versionBefore := s.chatSurfaceVersion
	if anchor.VoiceSidecars == nil {
		anchor.VoiceSidecars = make(map[string]*publicChatVoiceSidecarState)
	}
	copy := *voice
	anchor.VoiceSidecars[voice.TurnID] = &copy
	anchor.UpdatedAt = time.Now().UTC()
	if err := s.persistPublicChatSurfaceStateLocked(); err != nil {
		anchor.VoiceSidecars = before
		anchor.UpdatedAt = updatedAtBefore
		s.chatSurfaceVersion = versionBefore
		return grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE,
			fmt.Errorf("persist conversation voice sidecar: %w", err),
			grpcerr.ReasonOptions{},
		)
	}
	return nil
}

func (s *Service) publishLocalAppConversationVoice(
	subjectUserID string,
	anchorID string,
	voice *publicChatVoiceSidecarState,
) error {
	if voice == nil {
		return nil
	}
	messageType := publicChatTurnVoiceReadyType
	if voice.State == "failed" {
		messageType = publicChatTurnVoiceFailedType
	}
	detail := map[string]any{
		"voice_id":   voice.VoiceID,
		"message_id": voice.MessageID,
		"state":      voice.State,
	}
	if voice.ArtifactID != "" {
		detail["artifact_id"] = voice.ArtifactID
	}
	if voice.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		detail["reason_code"] = voice.ReasonCode.String()
	}
	if voice.Message != "" {
		detail["message"] = voice.Message
	}
	return s.publishLocalAppConversationEvent(subjectUserID, messageType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                voice.TurnID,
		"detail":                 detail,
		"timeline":               map[string]any{"sequence": int64(0)},
	})
}

func (s *Service) localAppConversationVoiceForTurn(
	anchorID string,
	turnID string,
) *publicChatVoiceSidecarState {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil || anchor.VoiceSidecars == nil {
		return nil
	}
	voice := anchor.VoiceSidecars[strings.TrimSpace(turnID)]
	if voice == nil {
		return nil
	}
	copy := *voice
	return &copy
}

func (s *Service) localAppConversationVoiceArtifactMembership(
	localAgentRef string,
	anchorID string,
	artifactID string,
	record runtimeartifact.ArtifactRecord,
) bool {
	if record.GeneratedVoice == nil || strings.TrimSpace(record.GeneratedVoice.AgentID) != strings.TrimSpace(localAgentRef) ||
		strings.TrimSpace(record.GeneratedVoice.ConversationAnchorID) != strings.TrimSpace(anchorID) {
		return false
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil {
		return false
	}
	voice := anchor.VoiceSidecars[strings.TrimSpace(record.GeneratedVoice.TurnID)]
	return voice != nil && voice.State == "ready" &&
		voice.TurnID == strings.TrimSpace(record.GeneratedVoice.TurnID) &&
		voice.ArtifactID == strings.TrimSpace(artifactID) &&
		voice.MessageID == localAppConversationMessageID(voice.TurnID, "assistant", "")
}

func localAppConversationVoiceFromState(
	voice *publicChatVoiceSidecarState,
) *runtimev1.LocalAppConversationVoice {
	if voice == nil {
		return nil
	}
	result := &runtimev1.LocalAppConversationVoice{
		VoiceId:    voice.VoiceID,
		TurnId:     voice.TurnID,
		MessageId:  voice.MessageID,
		ReasonCode: voice.ReasonCode,
	}
	if voice.State == "ready" {
		result.State = runtimev1.LocalAppConversationVoiceState_LOCAL_APP_CONVERSATION_VOICE_STATE_READY
		artifactID := voice.ArtifactID
		result.ArtifactId = &artifactID
	} else {
		result.State = runtimev1.LocalAppConversationVoiceState_LOCAL_APP_CONVERSATION_VOICE_STATE_FAILED
		if voice.Message != "" {
			message := voice.Message
			result.Message = &message
		}
	}
	return result
}
