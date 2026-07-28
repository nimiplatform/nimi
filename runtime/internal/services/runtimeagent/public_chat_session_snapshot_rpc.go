package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
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
	localDecision, localAppAuthorized := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !localAppAuthorized {
		if connection, protected := protectedlocal.LocalAppConnectionFromContext(ctx); protected && connection != nil {
			if s.localAppOperationAuth == nil {
				return nil, status.Error(codes.PermissionDenied, "local-app operation authorizer unavailable")
			}
			var authorizeErr error
			localDecision, authorizeErr = s.localAppOperationAuth.AuthorizeLocalAppProtectedOperation(ctx, accountservice.LocalAppOperationConversationSnapshot, localappop.Selector{AgentID: agentID, ConversationAnchorID: anchorID})
			if authorizeErr != nil {
				return nil, localAppConversationAuthorizationError(authorizeErr)
			}
			ctx = accountservice.ContextWithAuthorizedLocalAppDecision(ctx, localDecision)
			localAppAuthorized = true
		}
	}
	if localAppAuthorized {
		if localDecision.Operation != accountservice.LocalAppOperationConversationSnapshot || requestContext != nil {
			return nil, status.Error(codes.PermissionDenied, "local-app conversation snapshot selector is invalid")
		}
		callerAppID = localDecision.AppID
		agentID = localDecision.OwnerSelectedAgentID
		if strings.TrimSpace(agentID) == "" {
			return nil, status.Error(codes.PermissionDenied, "local-app owner Agent selector is unavailable")
		}
	}
	if localAppAuthorized {
		if err := s.ValidateLocalAppConversationScope(ctx, agentID, anchorID); err != nil {
			return nil, err
		}
	}
	if callerAppID == "" {
		return nil, status.Error(codes.InvalidArgument, "context.app_id is required")
	}
	var identity localAgentIdentity
	if localAppAuthorized {
		entry, identityErr := s.agentByID(agentID)
		if identityErr != nil {
			return nil, identityErr
		}
		identity, identityErr = validateLocalAgentIdentity(entry.Agent.GetOwnerUserId(), entry.Agent.GetRuntimeSourceRef(), entry.Agent.GetLocalAgentRef())
		if identityErr != nil || identity.OwnerUserID != localDecision.AccountID {
			return nil, status.Error(codes.PermissionDenied, "conversation Agent is not owned by the current account")
		}
	} else {
		var identityErr error
		identity, identityErr = localAgentIdentityFromContext(requestContext)
		if identityErr != nil {
			return nil, identityErr
		}
		if !envelope.HasValidatedProtectedCapability(ctx, callerAppID, runtimeAgentReadScope) {
			if err := s.authorizeCurrentAccountLocalAgent(ctx, requestContext, identity, runtimeAgentReadScope); err != nil {
				return nil, err
			}
		}
	}
	if err := s.authorizeBundledAvatarIdentity(ctx, requestContext, identity, runtimeAgentReadScope); err != nil {
		return nil, err
	}
	var snapshot *structpb.Struct
	var session publicChatAnchorState
	var err error
	if localAppAuthorized {
		snapshot, session, _, _, _, err = s.publicChatRuntime().buildAvatarLiveInstanceSessionSnapshot(callerAppID, anchorID, req.GetRequestId(), identity)
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
