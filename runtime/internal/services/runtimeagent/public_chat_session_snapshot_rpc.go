package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const runtimeAgentTurnReadScope = "runtime.agent.turn.read"

func (s *Service) GetPublicChatSessionSnapshot(_ context.Context, req *runtimev1.GetPublicChatSessionSnapshotRequest) (*runtimev1.GetPublicChatSessionSnapshotResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "get public chat session snapshot request is required")
	}
	agentID := strings.TrimSpace(req.GetAgentId())
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if agentID == "" {
		return nil, status.Error(codes.InvalidArgument, "agent_id is required")
	}
	if anchorID == "" {
		return nil, status.Error(codes.InvalidArgument, "conversation_anchor_id is required")
	}
	requestContext := req.GetContext()
	callerAppID := strings.TrimSpace(requestContext.GetAppId())
	if callerAppID == "" {
		return nil, status.Error(codes.InvalidArgument, "context.app_id is required")
	}
	scopedBinding := requestContext.GetScopedBinding()
	if scopedBinding == nil && strings.TrimSpace(requestContext.GetSubjectUserId()) == "" {
		return nil, runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	if scopedBinding != nil {
		if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, agentID, runtimeAgentTurnReadScope); err != nil {
			return nil, err
		}
	}
	snapshot, session, _, _, _, err := s.publicChatRuntime().buildSessionSnapshot(callerAppID, anchorID, req.GetRequestId())
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(session.AgentID) != agentID {
		return nil, status.Error(codes.FailedPrecondition, "conversation anchor agent_id mismatch")
	}
	return &runtimev1.GetPublicChatSessionSnapshotResponse{Snapshot: snapshot}, nil
}
