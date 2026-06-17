package runtimeagent

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) validateAvatarDebugControlRequest(ctx *runtimev1.AgentRequestContext, agentID string, anchorID string, requiredScope string) (string, string, error) {
	if s == nil || s.isClosed() {
		return "", "", status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	identity, entry, err := s.agentEntryForIdentityContext(ctx)
	if err != nil {
		return "", "", err
	}
	trimmedAgentID := strings.TrimSpace(agentID)
	if trimmedAgentID == "" {
		return "", "", status.Error(codes.InvalidArgument, "agent_id is required")
	}
	if trimmedAgentID != identity.LocalAgentRef {
		return "", "", status.Error(codes.FailedPrecondition, "agent_id must match local_agent_ref")
	}
	callerAppID := strings.TrimSpace(ctx.GetAppId())
	if callerAppID == "" {
		return "", "", status.Error(codes.InvalidArgument, "context.app_id is required")
	}
	scopedBinding := ctx.GetScopedBinding()
	if scopedBinding == nil {
		return "", "", runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	trimmedAnchorID := strings.TrimSpace(anchorID)
	if trimmedAnchorID == "" {
		return "", "", status.Error(codes.InvalidArgument, "conversation_anchor_id is required")
	}
	if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, trimmedAgentID, requiredScope); err != nil {
		return "", "", err
	}
	if err := s.validateAvatarDebugAnchor(identity, entry, trimmedAnchorID); err != nil {
		return "", "", err
	}
	if s.auditStore == nil {
		return "", "", status.Error(codes.FailedPrecondition, "runtime audit store is required for avatar debug replay")
	}
	return trimmedAgentID, trimmedAnchorID, nil
}

func (s *Service) validateAvatarDebugAnchor(identity localAgentIdentity, entry *agentEntry, anchorID string) error {
	if entry == nil {
		return status.Error(codes.NotFound, "agent not found")
	}
	if err := validateAgentRecordIdentity(entry.Agent, identity); err != nil {
		return err
	}
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil {
		s.chatSurfaceMu.Unlock()
		return status.Error(codes.NotFound, "conversation anchor not found")
	}
	cloned := *anchor
	s.chatSurfaceMu.Unlock()
	if cloned.AgentID != identity.LocalAgentRef ||
		cloned.OwnerUserID != identity.OwnerUserID ||
		cloned.RuntimeSourceRef != identity.RuntimeSourceRef ||
		cloned.LocalAgentRef != identity.LocalAgentRef {
		return status.Error(codes.FailedPrecondition, "conversation anchor local identity mismatch")
	}
	return nil
}
