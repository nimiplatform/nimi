package runtimeagent

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
		if err := validateImageActionExecutionBinding(session, action); err != nil {
			_ = r.emitTurnActionFailed(session, turn, action, projectionMessageID, err)
			return err
		}
		result, err := r.svc.currentPublicChatActionExecutor().ExecuteImageAction(ctx, PublicChatActionExecutionRequest{
			Session: session,
			Turn:    turn,
			Action:  action,
		})
		if err != nil {
			_ = r.emitTurnActionFailed(session, turn, action, projectionMessageID, err)
			return err
		}
		if err := r.validateRuntimeActionArtifact(result.ArtifactID); err != nil {
			_ = r.emitTurnActionFailed(session, turn, action, projectionMessageID, err)
			return err
		}
		if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnArtifactReadyType, map[string]any{
			"action_id":             result.ActionID,
			"projection_message_id": result.ProjectionMessageID,
			"artifact_id":           result.ArtifactID,
			"mime_type":             result.MimeType,
		}); err != nil {
			return fmt.Errorf("emit public chat artifact_ready failed: %w", err)
		}
		if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnActionCompletedType, map[string]any{
			"action_id":             result.ActionID,
			"modality":              action.Modality,
			"operation":             action.Operation,
			"projection_message_id": result.ProjectionMessageID,
			"artifact_id":           result.ArtifactID,
			"mime_type":             result.MimeType,
			"job_id":                result.JobID,
		}); err != nil {
			return fmt.Errorf("emit public chat action_completed failed: %w", err)
		}
	}
	return nil
}

func validateImageActionExecutionBinding(session publicChatAnchorState, action publicChatStructuredAction) error {
	actionID := strings.TrimSpace(action.ActionID)
	if actionID == "" {
		actionID = "image.generate"
	}
	binding, ok := session.Bindings["image.generate"]
	if !ok || strings.TrimSpace(binding.ModelID) == "" || binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return fmt.Errorf("runtime public chat image action %s requires execution_bindings.image.generate", actionID)
	}
	return nil
}

func (r publicChatRuntime) validateRuntimeActionArtifact(artifactID string) error {
	trimmed := strings.TrimSpace(artifactID)
	if trimmed == "" {
		return fmt.Errorf("runtime public chat image action artifact id is required")
	}
	if r.svc == nil || r.svc.runtimeArtifacts == nil {
		return fmt.Errorf("runtime artifact store is required for public chat image action")
	}
	record, ok := r.svc.runtimeArtifacts.Get(trimmed)
	if !ok {
		return fmt.Errorf("runtime public chat image action artifact %s was not stored", trimmed)
	}
	if len(record.Bytes) == 0 || strings.TrimSpace(record.MimeType) == "" {
		return fmt.Errorf("runtime public chat image action artifact %s has no readable bytes", trimmed)
	}
	return nil
}

func (r publicChatRuntime) emitTurnActionFailed(
	session publicChatAnchorState,
	turn publicChatTurnState,
	action publicChatStructuredAction,
	projectionMessageID string,
	err error,
) error {
	return r.emitTurnEvent(session, turn.TurnID, publicChatTurnActionFailedType, map[string]any{
		"action_id":             action.ActionID,
		"modality":              action.Modality,
		"operation":             action.Operation,
		"projection_message_id": projectionMessageID,
		"reason_code":           publicChatReasonCodeLabel(reasonCodeFromError(err)),
		"message":               strings.TrimSpace(err.Error()),
	})
}

func publicChatActionFailureReason(err error) runtimev1.ReasonCode {
	reasonCode := reasonCodeFromError(err)
	if reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
	return reasonCode
}
