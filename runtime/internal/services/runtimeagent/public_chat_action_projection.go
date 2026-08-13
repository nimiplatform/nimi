package runtimeagent

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func (r publicChatRuntime) executeCommittedActions(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	structured *publicChatStructuredEnvelope,
) error {
	if structured == nil || len(structured.Actions) == 0 {
		return nil
	}
	for _, action := range structured.Actions {
		if action.Modality != "image" || action.Operation != "image.generate" {
			continue
		}
		projectionMessageID := publicChatActionProjectionMessageID(turn.TurnID, action)
		if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnActionPlannedType, map[string]any{
			"action_id":             action.ActionID,
			"modality":              action.Modality,
			"operation":             action.Operation,
			"projection_message_id": projectionMessageID,
		}); err != nil {
			return fmt.Errorf("emit public chat action_planned failed: %w", err)
		}
		if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnActionStartedType, map[string]any{
			"action_id":             action.ActionID,
			"modality":              action.Modality,
			"operation":             action.Operation,
			"projection_message_id": projectionMessageID,
		}); err != nil {
			return fmt.Errorf("emit public chat action_started failed: %w", err)
		}
		if reason, err := validateImageActionExecutionBinding(session, turn, action); err != nil {
			_ = r.emitTurnActionFailed(session, turn, action, projectionMessageID, reason, err)
			return err
		}
		result, err := r.svc.currentPublicChatActionExecutor().ExecuteImageAction(ctx, PublicChatActionExecutionRequest{
			Session: session,
			Turn:    turn,
			Action:  action,
		})
		if err != nil {
			_ = r.emitTurnActionFailed(session, turn, action, projectionMessageID, publicChatActionFailedReasonImageExecutionFailed, err)
			return err
		}
		artifact, err := r.validateRuntimeActionArtifact(result.ArtifactID)
		if err != nil {
			_ = r.emitTurnActionFailed(session, turn, action, projectionMessageID, publicChatActionFailedReasonImageExecutionFailed, err)
			return err
		}
		if err := r.svc.commitPublicChatTurnOutputArtifact(session.ConversationAnchorID, turn.TurnID, *artifact); err != nil {
			_ = r.emitTurnActionFailed(session, turn, action, projectionMessageID, publicChatActionFailedReasonImageExecutionFailed, err)
			return err
		}
		if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnArtifactReadyType, map[string]any{
			"action_id":             result.ActionID,
			"projection_message_id": result.ProjectionMessageID,
			"artifact_id":           artifact.ArtifactID,
			"mime_type":             artifact.MimeType,
		}); err != nil {
			return fmt.Errorf("emit public chat artifact_ready failed: %w", err)
		}
		if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnActionCompletedType, map[string]any{
			"action_id":             result.ActionID,
			"modality":              action.Modality,
			"operation":             action.Operation,
			"projection_message_id": result.ProjectionMessageID,
			"artifact_id":           artifact.ArtifactID,
			"mime_type":             artifact.MimeType,
			"job_id":                result.JobID,
		}); err != nil {
			return fmt.Errorf("emit public chat action_completed failed: %w", err)
		}
	}
	return nil
}

// K-AGCORE-148 typed action_failed reason codes
// (tables/runtime-agent-ai-config.yaml action_failed_reason_codes).
const (
	publicChatActionFailedReasonImageBindingMissing  = "image_binding_missing"
	publicChatActionFailedReasonImageRouteUnhealthy  = "image_route_unhealthy"
	publicChatActionFailedReasonImageExecutionFailed = "image_execution_failed"
)

// validateImageActionExecutionBinding gates a planned image action against
// the admission-fixed availability tri-state (K-AGCORE-148). It returns the
// typed reason for the failure branch; silent action drop or pseudo-success
// is not admitted.
func validateImageActionExecutionBinding(session publicChatAnchorState, turn publicChatTurnState, action publicChatStructuredAction) (string, error) {
	actionID := strings.TrimSpace(action.ActionID)
	if actionID == "" {
		actionID = "image.generate"
	}
	binding, ok := session.Bindings["image.generate"]
	if !ok || strings.TrimSpace(binding.ModelID) == "" || binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return publicChatActionFailedReasonImageBindingMissing,
			fmt.Errorf("runtime public chat image action %s has no committed image.generate Runtime Agent AI Config binding", actionID)
	}
	if turn.AvailableActions.ImageGenerate == publicChatImageActionUnavailable {
		return publicChatActionFailedReasonImageRouteUnhealthy,
			fmt.Errorf("runtime public chat image action %s is bound to a configured image route that is currently unavailable", actionID)
	}
	return "", nil
}

func (r publicChatRuntime) validateRuntimeActionArtifact(artifactID string) (*publicChatCommittedTranscriptAttachment, error) {
	trimmed := strings.TrimSpace(artifactID)
	if trimmed == "" {
		return nil, fmt.Errorf("runtime public chat image action artifact id is required")
	}
	if r.svc == nil || r.svc.runtimeArtifacts == nil {
		return nil, fmt.Errorf("runtime artifact store is required for public chat image action")
	}
	record, ok := r.svc.runtimeArtifacts.Get(trimmed)
	if !ok {
		return nil, fmt.Errorf("runtime public chat image action artifact %s was not stored", trimmed)
	}
	attachment := normalizePublicChatCommittedTranscriptAttachment(&publicChatCommittedTranscriptAttachment{
		ArtifactID: trimmed,
		MimeType:   strings.ToLower(strings.TrimSpace(record.MimeType)),
	})
	if len(record.Bytes) == 0 || attachment == nil {
		return nil, fmt.Errorf("runtime public chat image action artifact %s has no readable image bytes", trimmed)
	}
	return attachment, nil
}

func (r publicChatRuntime) emitTurnActionFailed(
	session publicChatAnchorState,
	turn publicChatTurnState,
	action publicChatStructuredAction,
	projectionMessageID string,
	reason string,
	err error,
) error {
	message := strings.TrimSpace(err.Error())
	if publicMessage, ok := grpcerr.ExtractPublicMessage(err); ok {
		message = publicMessage
	}
	return r.emitTurnEvent(session, turn.TurnID, publicChatTurnActionFailedType, map[string]any{
		"action_id":             action.ActionID,
		"modality":              action.Modality,
		"operation":             action.Operation,
		"projection_message_id": projectionMessageID,
		// `reason` carries the K-AGCORE-148 typed action failure vocabulary
		// from tables/runtime-agent-ai-config.yaml; `reason_code` remains the
		// generic runtime ReasonCode label.
		"reason":      reason,
		"reason_code": publicChatReasonCodeLabel(reasonCodeFromError(err)),
		"message":     message,
	})
}

func publicChatActionFailureReason(err error) runtimev1.ReasonCode {
	reasonCode := reasonCodeFromError(err)
	if reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
	return reasonCode
}
