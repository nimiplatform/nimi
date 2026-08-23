package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// @nimi-authority: rule.nimi.runtime.agent-participation.r178
// ReadConversationArtifact is the first-party counterpart of the protected
// opaque-handle read. It requires the same Agent/anchor membership and inline
// bounds while retaining first-party LocalAgent identity in the request.
func (s *Service) ReadConversationArtifact(
	ctx context.Context,
	req *runtimev1.ReadConversationArtifactRequest,
) (*runtimev1.ReadConversationArtifactResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "conversation artifact read request is required")
	}
	agentID := strings.TrimSpace(req.GetAgentId())
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	artifactID := strings.TrimSpace(req.GetArtifactId())
	if agentID == "" || !validLocalAppConversationSelector(anchorID) || !validLocalAppConversationSelector(artifactID) {
		return nil, status.Error(codes.InvalidArgument, "conversation artifact read input is invalid")
	}
	requestContext := req.GetContext()
	callerAppID := strings.TrimSpace(requestContext.GetAppId())
	if callerAppID == "" {
		return nil, status.Error(codes.InvalidArgument, "context.app_id is required")
	}
	identity, err := localAgentIdentityFromContext(requestContext)
	if err != nil {
		return nil, err
	}
	if identity.LocalAgentRef != agentID {
		return nil, status.Error(codes.FailedPrecondition, "conversation artifact Agent identity mismatch")
	}
	if !envelope.HasValidatedProtectedCapability(ctx, callerAppID, runtimeAgentReadScope) {
		if err := s.authorizeCurrentAccountLocalAgent(ctx, requestContext, identity, runtimeAgentReadScope); err != nil {
			return nil, err
		}
	}
	if err := s.authorizeBundledAvatarIdentity(ctx, requestContext, identity, runtimeAgentReadScope); err != nil {
		return nil, err
	}
	session, _, _, _, err := s.snapshotPublicChatAnchorForCaller(callerAppID, anchorID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(session.AgentID) != agentID {
		return nil, status.Error(codes.FailedPrecondition, "conversation anchor agent_id mismatch")
	}
	result, err := s.readConversationArtifact(identity.LocalAgentRef, anchorID, artifactID)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ReadConversationArtifactResponse{
		ArtifactId: result.ArtifactID,
		Data:       result.Bytes,
		MimeType:   result.MimeType,
		ByteLength: result.ByteLength,
	}, nil
}
