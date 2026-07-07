package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

const runtimeAgentTurnReadScope = "runtime.agent.turn.read"
const runtimeAgentTurnWriteScope = "runtime.agent.turn.write"
const runtimeAgentReadScope = "runtime.agent.read"

func (s *Service) GetPublicChatSessionSnapshot(ctx context.Context, req *runtimev1.GetPublicChatSessionSnapshotRequest) (*runtimev1.GetPublicChatSessionSnapshotResponse, error) {
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
	var identity localAgentIdentity
	if scopedBinding == nil {
		if !envelope.HasValidatedProtectedCapability(ctx, callerAppID, runtimeAgentReadScope) {
			return nil, runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
		}
		var identityErr error
		identity, identityErr = localAgentIdentityFromContext(requestContext)
		if identityErr != nil {
			return nil, identityErr
		}
	} else {
		if scopedBindingAttachmentConversationAnchorMismatches(scopedBinding, anchorID) {
			return nil, status.Error(codes.PermissionDenied, "public chat scoped binding conversation_anchor_id mismatch")
		}
		if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, agentID, runtimeAgentTurnReadScope); err != nil {
			return nil, err
		}
	}
	var snapshot *structpb.Struct
	var session publicChatAnchorState
	var err error
	if scopedBinding != nil {
		snapshot, session, _, _, _, err = s.publicChatRuntime().buildScopedBindingSessionSnapshot(callerAppID, anchorID, req.GetRequestId())
	} else {
		snapshot, session, _, _, _, err = s.publicChatRuntime().buildAvatarLiveInstanceSessionSnapshot(callerAppID, anchorID, req.GetRequestId(), identity)
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(session.AgentID) != agentID {
		return nil, status.Error(codes.FailedPrecondition, "conversation anchor agent_id mismatch")
	}
	return &runtimev1.GetPublicChatSessionSnapshotResponse{Snapshot: snapshot}, nil
}
