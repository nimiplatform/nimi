package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	runtimeAgentCompanionParticipationReadScope  = "runtime.agent.companion_participation.read"
	runtimeAgentCompanionParticipationWriteScope = "runtime.agent.companion_participation.write"

	companionParticipationDefaultRoomOrchestrationRef = "runtime.room_orchestration/avatar_companion_presentation_room"
	companionParticipationDefaultPresentationRef      = "runtime.presentation/avatar_companion"
	companionParticipationMaxTextBytes                = 32 * 1024
)

func (s *Service) GetCompanionParticipationProjection(ctx context.Context, req *runtimev1.GetCompanionParticipationProjectionRequest) (*runtimev1.GetCompanionParticipationProjectionResponse, error) {
	session, activeTurn, lastTurn, err := s.validateCompanionParticipationProjectionRequest(ctx, req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), runtimeAgentCompanionParticipationReadScope)
	if err != nil {
		return nil, err
	}
	params, err := companionParticipationProjectionParamsFromRead(req.GetSurfaceKind(), req.GetTriggerSource(), req.GetProfileRef(), req.GetRoomOrchestrationRef())
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetCompanionParticipationProjectionResponse{
		Projection: buildCompanionParticipationProjection(session, activeTurn, lastTurn, params, ""),
	}, nil
}

func (s *Service) RequestCompanionParticipation(ctx context.Context, req *runtimev1.RequestCompanionParticipationRequest) (*runtimev1.RequestCompanionParticipationResponse, error) {
	session, activeTurn, lastTurn, err := s.validateCompanionParticipationProjectionRequest(ctx, req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), runtimeAgentCompanionParticipationWriteScope)
	if err != nil {
		return nil, err
	}
	params, err := companionParticipationProjectionParamsFromRead(req.GetSurfaceKind(), req.GetTriggerSource(), req.GetProfileRef(), req.GetRoomOrchestrationRef())
	if err != nil {
		return nil, err
	}
	if activeTurn != nil && strings.TrimSpace(activeTurn.TurnID) != "" {
		return &runtimev1.RequestCompanionParticipationResponse{
			Projection: buildCompanionParticipationProjection(session, activeTurn, lastTurn, params, "active_turn_already_running"),
		}, nil
	}
	text := strings.TrimSpace(req.GetText())
	if text == "" {
		return &runtimev1.RequestCompanionParticipationResponse{
			Projection: buildBlockedCompanionParticipationProjection(session, params, "companion_participation_text_required"),
		}, nil
	}
	if len([]byte(text)) > companionParticipationMaxTextBytes {
		return &runtimev1.RequestCompanionParticipationResponse{
			Projection: buildBlockedCompanionParticipationProjection(session, params, "companion_participation_text_too_large"),
		}, nil
	}
	if s == nil || !s.HasPublicChatTurnExecutor() || !s.HasPublicChatBindingResolver() || s.chatAppEmit == nil {
		return &runtimev1.RequestCompanionParticipationResponse{
			Projection: buildBlockedCompanionParticipationProjection(session, params, "companion_participation_runtime_unavailable"),
		}, nil
	}
	messages := []*runtimev1.ChatMessage{
		{
			Role:    "user",
			Content: text,
		},
	}
	_, err = s.resolveRuntimeDefaultPublicChatBinding(ctx, session.SubjectUserID, "", messages, req.GetMaxOutputTokens())
	if err != nil {
		if status.Code(err) == codes.FailedPrecondition || status.Code(err) == codes.Unavailable {
			return &runtimev1.RequestCompanionParticipationResponse{
				Projection: buildBlockedCompanionParticipationProjection(session, params, companionParticipationRefusalReason(err)),
			}, nil
		}
		return nil, err
	}

	payload, err := structpb.NewStruct(map[string]any{
		"local_agent_ref":        session.LocalAgentRef,
		"owner_user_id":          session.OwnerUserID,
		"runtime_source_ref":         session.RuntimeSourceRef,
		"conversation_anchor_id": session.ConversationAnchorID,
		"request_id":             firstNonEmpty(strings.TrimSpace(req.GetRequestId()), "companion-participation-"+session.ConversationAnchorID),
		"thread_id":              strings.TrimSpace(req.GetThreadId()),
		"world_id":               strings.TrimSpace(req.GetWorldId()),
		"max_output_tokens":      req.GetMaxOutputTokens(),
		"messages": []any{
			map[string]any{"role": "user", "content": text},
		},
		// K-AGCORE-147: no execution_bindings on the turn request payload;
		// turn admission binds to the committed execution config. The
		// resolveRuntimeDefaultPublicChatBinding call above remains a
		// fail-closed availability precheck for the blocked projection path.
	})
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "companion participation request payload invalid")
	}
	err = s.publicChatRuntime().consumeAppMessage(ctx, &runtimev1.AppMessageEvent{
		FromAppId:     session.CallerAppID,
		ToAppId:       publicChatRuntimeAppID,
		SubjectUserId: session.SubjectUserID,
		MessageType:   publicChatTurnRequestType,
		Payload:       payload,
	})
	if err != nil {
		if status.Code(err) == codes.FailedPrecondition || status.Code(err) == codes.Unavailable {
			return &runtimev1.RequestCompanionParticipationResponse{
				Projection: buildBlockedCompanionParticipationProjection(session, params, companionParticipationRefusalReason(err)),
			}, nil
		}
		return nil, err
	}
	session, activeTurn, lastTurn, err = s.snapshotCompanionParticipationSession(session.CallerAppID, session.ConversationAnchorID)
	if err != nil {
		return nil, err
	}
	return &runtimev1.RequestCompanionParticipationResponse{
		Projection: buildCompanionParticipationProjection(session, activeTurn, lastTurn, params, ""),
	}, nil
}

func (s *Service) CancelCompanionParticipation(ctx context.Context, req *runtimev1.CancelCompanionParticipationRequest) (*runtimev1.CancelCompanionParticipationResponse, error) {
	session, activeTurn, lastTurn, err := s.validateCompanionParticipationProjectionRequest(ctx, req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), runtimeAgentCompanionParticipationWriteScope)
	if err != nil {
		return nil, err
	}
	params, err := companionParticipationProjectionParamsFromRead(req.GetSurfaceKind(), req.GetTriggerSource(), req.GetProfileRef(), req.GetRoomOrchestrationRef())
	if err != nil {
		return nil, err
	}
	if activeTurn == nil || strings.TrimSpace(activeTurn.TurnID) == "" {
		return &runtimev1.CancelCompanionParticipationResponse{
			Projection: buildCompanionParticipationProjection(session, activeTurn, lastTurn, params, "no_active_companion_participation"),
		}, nil
	}
	targetTurnID := strings.TrimSpace(req.GetTurnId())
	if targetTurnID == "" {
		targetTurnID = strings.TrimSpace(activeTurn.TurnID)
	}
	if targetTurnID != strings.TrimSpace(activeTurn.TurnID) {
		return nil, status.Error(codes.FailedPrecondition, "companion participation turn_id mismatch")
	}
	if projectionID := strings.TrimSpace(req.GetProjectionId()); projectionID != "" {
		currentProjection := buildCompanionParticipationProjection(session, activeTurn, lastTurn, params, "")
		if projectionID != strings.TrimSpace(currentProjection.GetProjectionId()) {
			return nil, status.Error(codes.NotFound, "companion participation projection not found")
		}
	}
	payload, err := structpb.NewStruct(map[string]any{
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                targetTurnID,
		"reason":                 firstNonEmpty(strings.TrimSpace(req.GetReason()), "companion_participation_cancel_requested"),
	})
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "companion participation cancel payload invalid")
	}
	err = s.publicChatRuntime().consumeAppMessage(ctx, &runtimev1.AppMessageEvent{
		FromAppId:     session.CallerAppID,
		ToAppId:       publicChatRuntimeAppID,
		SubjectUserId: session.SubjectUserID,
		MessageType:   publicChatTurnInterruptType,
		Payload:       payload,
	})
	if err != nil {
		return nil, err
	}
	return &runtimev1.CancelCompanionParticipationResponse{
		Projection: buildCompanionParticipationProjectionWithStatus(session, activeTurn, params, runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_CANCELED, "companion_participation_cancel_requested"),
	}, nil
}

func (s *Service) OpenCompanionParticipationReplay(ctx context.Context, req *runtimev1.OpenCompanionParticipationReplayRequest) (*runtimev1.OpenCompanionParticipationReplayResponse, error) {
	session, activeTurn, lastTurn, err := s.validateCompanionParticipationProjectionRequest(ctx, req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), runtimeAgentCompanionParticipationReadScope)
	if err != nil {
		return nil, err
	}
	params, err := companionParticipationProjectionParamsFromRead(req.GetSurfaceKind(), req.GetTriggerSource(), req.GetProfileRef(), req.GetRoomOrchestrationRef())
	if err != nil {
		return nil, err
	}
	projection := buildCompanionParticipationProjection(session, activeTurn, lastTurn, params, "")
	if requested := strings.TrimSpace(req.GetProjectionId()); requested != "" && requested != strings.TrimSpace(projection.GetProjectionId()) {
		if lastTurn != nil && strings.TrimSpace(lastTurn.TurnID) != "" {
			lastProjection := buildCompanionParticipationProjection(session, nil, lastTurn, params, "")
			if requested == strings.TrimSpace(lastProjection.GetProjectionId()) {
				projection = lastProjection
			} else {
				return nil, status.Error(codes.NotFound, "companion participation projection not found")
			}
		} else {
			return nil, status.Error(codes.NotFound, "companion participation projection not found")
		}
	}
	return &runtimev1.OpenCompanionParticipationReplayResponse{
		ReplayRef:  "runtime.replay.companion_participation/" + projection.GetProjectionId(),
		Projection: projection,
	}, nil
}

type companionParticipationProjectionParams struct {
	surfaceKind          runtimev1.CompanionParticipationSurfaceKind
	triggerSource        runtimev1.CompanionParticipationTriggerSource
	profileRef           string
	roomOrchestrationRef string
}

func (s *Service) validateCompanionParticipationProjectionRequest(
	ctx context.Context,
	requestContext *runtimev1.AgentRequestContext,
	agentID string,
	anchorID string,
	requiredScope string,
) (publicChatAnchorState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, error) {
	if s == nil || s.isClosed() {
		return publicChatAnchorState{}, nil, nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	trimmedAgentID := strings.TrimSpace(agentID)
	trimmedAnchorID := strings.TrimSpace(anchorID)
	if trimmedAgentID == "" {
		return publicChatAnchorState{}, nil, nil, status.Error(codes.InvalidArgument, "agent_id is required")
	}
	if trimmedAnchorID == "" {
		return publicChatAnchorState{}, nil, nil, status.Error(codes.InvalidArgument, "conversation_anchor_id is required")
	}
	callerAppID := strings.TrimSpace(requestContext.GetAppId())
	if callerAppID == "" {
		return publicChatAnchorState{}, nil, nil, status.Error(codes.InvalidArgument, "context.app_id is required")
	}
	if scopedBinding := requestContext.GetScopedBinding(); scopedBinding != nil {
		if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, trimmedAgentID, requiredScope); err != nil {
			return publicChatAnchorState{}, nil, nil, err
		}
	} else if !envelope.HasValidatedProtectedCapability(ctx, callerAppID, requiredScope) {
		return publicChatAnchorState{}, nil, nil, runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	session, activeTurn, lastTurn, err := s.snapshotCompanionParticipationSession(callerAppID, trimmedAnchorID)
	if err != nil {
		return publicChatAnchorState{}, nil, nil, err
	}
	if strings.TrimSpace(session.AgentID) != trimmedAgentID {
		return publicChatAnchorState{}, nil, nil, status.Error(codes.FailedPrecondition, "conversation anchor agent_id mismatch")
	}
	return session, activeTurn, lastTurn, nil
}

func (s *Service) snapshotCompanionParticipationSession(callerAppID string, anchorID string) (publicChatAnchorState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, error) {
	session, activeTurn, lastTurn, _, err := s.snapshotPublicChatAnchorForCaller(callerAppID, anchorID)
	return session, activeTurn, lastTurn, err
}

func companionParticipationProjectionParamsFromRead(
	surfaceKind runtimev1.CompanionParticipationSurfaceKind,
	triggerSource runtimev1.CompanionParticipationTriggerSource,
	profileRef string,
	roomOrchestrationRef string,
) (companionParticipationProjectionParams, error) {
	if surfaceKind != runtimev1.CompanionParticipationSurfaceKind_COMPANION_PARTICIPATION_SURFACE_KIND_AVATAR_COMPANION &&
		surfaceKind != runtimev1.CompanionParticipationSurfaceKind_COMPANION_PARTICIPATION_SURFACE_KIND_DESKTOP_COMPANION_PANEL &&
		surfaceKind != runtimev1.CompanionParticipationSurfaceKind_COMPANION_PARTICIPATION_SURFACE_KIND_AVATAR_DEBUG_WORKBENCH {
		return companionParticipationProjectionParams{}, status.Error(codes.InvalidArgument, "companion participation surface_kind is required")
	}
	if triggerSource != runtimev1.CompanionParticipationTriggerSource_COMPANION_PARTICIPATION_TRIGGER_SOURCE_USER_EXPLICIT &&
		triggerSource != runtimev1.CompanionParticipationTriggerSource_COMPANION_PARTICIPATION_TRIGGER_SOURCE_SCHEDULED_PROACTIVE &&
		triggerSource != runtimev1.CompanionParticipationTriggerSource_COMPANION_PARTICIPATION_TRIGGER_SOURCE_DOMAIN_EVENT {
		return companionParticipationProjectionParams{}, status.Error(codes.InvalidArgument, "companion participation trigger_source is required")
	}
	return companionParticipationProjectionParams{
		surfaceKind:          surfaceKind,
		triggerSource:        triggerSource,
		profileRef:           strings.TrimSpace(profileRef),
		roomOrchestrationRef: firstNonEmpty(strings.TrimSpace(roomOrchestrationRef), companionParticipationDefaultRoomOrchestrationRef),
	}, nil
}

func buildBlockedCompanionParticipationProjection(session publicChatAnchorState, params companionParticipationProjectionParams, refusalReason string) *runtimev1.CompanionParticipationProjection {
	return buildCompanionParticipationProjectionWithStatus(session, nil, params, runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_BLOCKED, refusalReason)
}

func buildCompanionParticipationProjection(
	session publicChatAnchorState,
	activeTurn *publicChatTurnProjectionState,
	lastTurn *publicChatTurnProjectionState,
	params companionParticipationProjectionParams,
	refusalReason string,
) *runtimev1.CompanionParticipationProjection {
	if strings.TrimSpace(refusalReason) != "" {
		return buildCompanionParticipationProjectionWithStatus(session, nil, params, runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_BLOCKED, refusalReason)
	}
	if activeTurn != nil && strings.TrimSpace(activeTurn.TurnID) != "" {
		return buildCompanionParticipationProjectionFromTurn(session, activeTurn, params, refusalReason)
	}
	if lastTurn != nil && strings.TrimSpace(lastTurn.TurnID) != "" {
		return buildCompanionParticipationProjectionFromTurn(session, lastTurn, params, refusalReason)
	}
	return buildCompanionParticipationProjectionWithStatus(session, nil, params, runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_IDLE, "")
}

func buildCompanionParticipationProjectionFromTurn(
	session publicChatAnchorState,
	turn *publicChatTurnProjectionState,
	params companionParticipationProjectionParams,
	refusalReason string,
) *runtimev1.CompanionParticipationProjection {
	statusValue := runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_RUNNING
	switch strings.TrimSpace(turn.Status) {
	case publicChatTurnStatusAccepted:
		statusValue = runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_ADMISSION_PENDING
	case publicChatTurnStatusStarted, publicChatTurnStatusStreaming:
		statusValue = runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_RUNNING
	case publicChatTurnStatusCompleted:
		statusValue = runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_COMMITTED_BY_OWNER
	case publicChatTurnStatusFailed:
		statusValue = runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_FAILED
	case publicChatTurnStatusInterrupted:
		statusValue = runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_CANCELED
	}
	if strings.TrimSpace(refusalReason) == "" && strings.TrimSpace(turn.Message) != "" &&
		(statusValue == runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_FAILED ||
			statusValue == runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_CANCELED) {
		refusalReason = strings.TrimSpace(turn.Message)
	}
	projection := buildCompanionParticipationProjectionWithStatus(session, turn, params, statusValue, refusalReason)
	if statusValue == runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_COMMITTED_BY_OWNER {
		projection.CandidateRef = "runtime.agent.public_chat.turn/" + strings.TrimSpace(turn.TurnID) + "/candidate"
		projection.CommitRef = "runtime.agent.public_chat.turn/" + strings.TrimSpace(turn.TurnID)
		if strings.TrimSpace(turn.MessageID) != "" {
			projection.CommitRef = "runtime.agent.public_chat.message/" + strings.TrimSpace(turn.MessageID)
		}
	}
	return projection
}

func buildCompanionParticipationProjectionWithStatus(
	session publicChatAnchorState,
	turn *publicChatTurnProjectionState,
	params companionParticipationProjectionParams,
	statusValue runtimev1.CompanionParticipationStatus,
	refusalReason string,
) *runtimev1.CompanionParticipationProjection {
	turnID := ""
	if turn != nil {
		turnID = strings.TrimSpace(turn.TurnID)
	}
	surfaceLabel := strings.ToLower(strings.TrimPrefix(params.surfaceKind.String(), "COMPANION_PARTICIPATION_SURFACE_KIND_"))
	projectionID := "companion_participation_projection/" + session.ConversationAnchorID + "/" + surfaceLabel + "/" + firstNonEmpty(turnID, "idle")
	profileRef := firstNonEmpty(params.profileRef, "runtime.agent.profile/"+session.LocalAgentRef)
	return &runtimev1.CompanionParticipationProjection{
		ProjectionId:         projectionID,
		AgentId:              session.AgentID,
		SurfaceKind:          params.surfaceKind,
		ProfileRef:           profileRef,
		RoomOrchestrationRef: params.roomOrchestrationRef,
		TriggerSource:        params.triggerSource,
		Status:               statusValue,
		RefusalReason:        strings.TrimSpace(refusalReason),
		PresentationRef:      companionParticipationDefaultPresentationRef,
		AuditRef:             "runtime.audit.companion_participation/" + projectionID,
		ObservedAt:           timestamppb.New(time.Now().UTC()),
		ConversationAnchorId: session.ConversationAnchorID,
		TurnId:               turnID,
	}
}

func companionParticipationRefusalReason(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(status.Convert(err).Message())
	if message == "" {
		return "companion_participation_request_blocked"
	}
	return strings.ReplaceAll(message, " ", "_")
}
