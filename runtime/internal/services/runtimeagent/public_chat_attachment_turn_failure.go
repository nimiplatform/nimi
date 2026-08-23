package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Vision-unsupported attachment turn semantics
// (rule.nimi.runtime.agent-participation.r174): when the current route cannot
// consume image content, the user attachment message still commits and
// persists without a synthetic assistant message, then the turn surfaces the
// typed failure.
const (
	publicChatTurnAttachmentVisionUnsupportedReasonCode = "turn-attachment-route-vision-unsupported"
	publicChatTurnAttachmentVisionUnsupportedMessage    = "current route cannot consume image content"
)

// publicChatTurnCarriesUserAttachment reports whether the admitted current
// turn input is a user message carrying a Runtime-validated attachment.
func publicChatTurnCarriesUserAttachment(req publicChatTurnRequestPayload) bool {
	return len(req.Messages) == 1 && strings.TrimSpace(req.Messages[0].Role) == "user" && len(req.resolvedAttachments) > 0
}

// publicChatCurrentUserCommitMessage builds the Runtime-owned current user
// message for the transcript commit point, including the admitted attachment
// as exactly one artifact_ref image part carrying the store-trusted mime.
func publicChatCurrentUserCommitMessage(req publicChatTurnRequestPayload) *runtimev1.ChatMessage {
	if len(req.Messages) != 1 || strings.TrimSpace(req.Messages[0].Role) != "user" {
		return nil
	}
	message := &runtimev1.ChatMessage{Role: "user", Content: strings.TrimSpace(req.Messages[0].Content)}
	if len(req.resolvedAttachments) == 1 {
		attachment := req.resolvedAttachments[0]
		message.Parts = []*runtimev1.ChatContentPart{{
			Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF,
			Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{
				LocalArtifactId: attachment.ArtifactID,
				MimeType:        attachment.MimeType,
				DisplayName:     attachment.DisplayName,
			}},
		}}
	}
	return message
}

// failVisionUnsupportedAttachmentTurn commits only the user attachment
// message, then projects the typed vision-unsupported failure. The attachment
// is never dropped, no assistant message is fabricated, and the image is never
// reported as consumed.
func (r publicChatRuntime) failVisionUnsupportedAttachmentTurn(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
	traceID string,
	modelResolved string,
	routeDecision runtimev1.RoutePolicy,
) {
	finalizeCommittedProjection := func(projection *publicChatTurnProjectionState) {
		projection.Status = publicChatTurnStatusCommitted
		projection.TraceID = strings.TrimSpace(traceID)
		projection.ModelResolved = strings.TrimSpace(modelResolved)
		projection.RouteDecision = routeDecision
		projection.OutputObserved = false
		projection.MessageID = ""
		projection.AssistantText = ""
	}
	commitErr := r.svc.commitPublicChatTranscriptTurn(
		ctx,
		session.ConversationAnchorID,
		turn.TurnID,
		publicChatTurnOriginUser,
		strings.TrimSpace(req.Messages[0].Content),
		publicChatCommittedAttachmentFromMessage(publicChatCurrentUserCommitMessage(req)),
		"",
		finalizeCommittedProjection,
	)
	if commitErr != nil {
		diagnostic := "commit Runtime transcript failed: " + commitErr.Error()
		r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
			projection.Status = publicChatTurnStatusFailed
			projection.TraceID = traceID
			projection.ModelResolved = modelResolved
			projection.RouteDecision = routeDecision
			projection.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
			projection.Message = diagnostic
		})
		r.emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, runtimev1.ReasonCode_AI_STREAM_BROKEN, diagnostic, "")
		return
	}
	if err := r.emitTurnMessageCommitted(
		session,
		turn.TurnID,
		localAppConversationMessageID(turn.TurnID, "user", ""),
		strings.TrimSpace(req.Messages[0].Content),
	); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit vision-unsupported committed user message failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
	r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		projection.Status = publicChatTurnStatusFailed
		projection.TraceID = strings.TrimSpace(traceID)
		projection.ModelResolved = strings.TrimSpace(modelResolved)
		projection.RouteDecision = routeDecision
		projection.MessageID = ""
		projection.AssistantText = ""
		projection.ReasonCode = runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED
		projection.ReasonCodeToken = publicChatTurnAttachmentVisionUnsupportedReasonCode
		projection.Message = publicChatTurnAttachmentVisionUnsupportedMessage
	})
	r.emitTurnFailedReasonToken(session, turn, publicChatTurnAttachmentVisionUnsupportedReasonCode, publicChatTurnAttachmentVisionUnsupportedMessage)
}

// emitTurnFailedReasonToken projects `turn.failed.detail` with an exact
// reason code token instead of an enum label, keeping the admitted detail
// shape (`reason_code` required, `message?`).
func (r publicChatRuntime) emitTurnFailedReasonToken(session publicChatAnchorState, turn publicChatTurnState, reasonToken string, message string) {
	payload := map[string]any{
		"reason_code": strings.TrimSpace(reasonToken),
	}
	if trimmed := strings.TrimSpace(message); trimmed != "" {
		payload["message"] = trimmed
	}
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnFailedType, payload); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat failed event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
}
