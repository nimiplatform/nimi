package runtimeagent

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const localAgentRefPrefix = "local-agent:"

type localAgentIdentity struct {
	OwnerUserID   string
	RealmAgentID  string
	LocalAgentRef string
}

func buildLocalAgentRef(ownerUserID string, realmAgentID string) string {
	return localAgentRefPrefix + strings.TrimSpace(ownerUserID) + ":" + strings.TrimSpace(realmAgentID)
}

func validateLocalAgentIdentity(ownerUserID string, realmAgentID string, localAgentRef string) (localAgentIdentity, error) {
	identity := localAgentIdentity{
		OwnerUserID:   strings.TrimSpace(ownerUserID),
		RealmAgentID:  strings.TrimSpace(realmAgentID),
		LocalAgentRef: strings.TrimSpace(localAgentRef),
	}
	if identity.OwnerUserID == "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "owner_user_id is required")
	}
	if identity.RealmAgentID == "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "realm_agent_id is required")
	}
	if identity.LocalAgentRef == "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "local_agent_ref is required")
	}
	if !strings.HasPrefix(identity.LocalAgentRef, localAgentRefPrefix) {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "local_agent_ref is malformed")
	}
	if identity.LocalAgentRef == identity.RealmAgentID {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "local_agent_ref must not be bare realm_agent_id")
	}
	expected := buildLocalAgentRef(identity.OwnerUserID, identity.RealmAgentID)
	if identity.LocalAgentRef != expected {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "local_agent_ref does not match owner_user_id and realm_agent_id")
	}
	return identity, nil
}

func localAgentIdentityFromContext(ctx *runtimev1.AgentRequestContext) (localAgentIdentity, error) {
	if ctx == nil {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "agent request context is required")
	}
	return validateLocalAgentIdentity(ctx.GetOwnerUserId(), ctx.GetRealmAgentId(), ctx.GetLocalAgentRef())
}

func localAgentIdentityFromInitializeRequest(req *runtimev1.InitializeAgentRequest) (localAgentIdentity, error) {
	if req == nil {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "initialize agent request is required")
	}
	ownerUserID := firstNonEmpty(strings.TrimSpace(req.GetOwnerUserId()), strings.TrimSpace(req.GetContext().GetOwnerUserId()))
	realmAgentID := firstNonEmpty(strings.TrimSpace(req.GetRealmAgentId()), strings.TrimSpace(req.GetContext().GetRealmAgentId()))
	localAgentRef := firstNonEmpty(strings.TrimSpace(req.GetLocalAgentRef()), strings.TrimSpace(req.GetContext().GetLocalAgentRef()))
	if strings.TrimSpace(req.GetAgentId()) != "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "agent_id is not local execution identity; use local_agent_ref")
	}
	return validateLocalAgentIdentity(ownerUserID, realmAgentID, localAgentRef)
}

func localAgentIdentityFromOpenAnchorRequest(req *runtimev1.OpenConversationAnchorRequest) (localAgentIdentity, error) {
	if req == nil {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "open conversation anchor request is required")
	}
	ownerUserID := firstNonEmpty(strings.TrimSpace(req.GetOwnerUserId()), strings.TrimSpace(req.GetContext().GetOwnerUserId()))
	realmAgentID := firstNonEmpty(strings.TrimSpace(req.GetRealmAgentId()), strings.TrimSpace(req.GetContext().GetRealmAgentId()))
	localAgentRef := firstNonEmpty(strings.TrimSpace(req.GetLocalAgentRef()), strings.TrimSpace(req.GetContext().GetLocalAgentRef()))
	if strings.TrimSpace(req.GetAgentId()) != "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "agent_id is not local execution identity; use local_agent_ref")
	}
	return validateLocalAgentIdentity(ownerUserID, realmAgentID, localAgentRef)
}

func validateAgentRecordIdentity(agent *runtimev1.AgentRecord, identity localAgentIdentity) error {
	if agent == nil {
		return status.Error(codes.NotFound, "agent not found")
	}
	if strings.TrimSpace(agent.GetLocalAgentRef()) != identity.LocalAgentRef {
		return status.Error(codes.FailedPrecondition, "local_agent_ref mismatch")
	}
	if strings.TrimSpace(agent.GetOwnerUserId()) != identity.OwnerUserID {
		return status.Error(codes.FailedPrecondition, "owner_user_id mismatch")
	}
	if strings.TrimSpace(agent.GetRealmAgentId()) != identity.RealmAgentID {
		return status.Error(codes.FailedPrecondition, "realm_agent_id mismatch")
	}
	return nil
}

func (s *Service) agentEntryForIdentityContext(ctx *runtimev1.AgentRequestContext) (localAgentIdentity, *agentEntry, error) {
	identity, err := localAgentIdentityFromContext(ctx)
	if err != nil {
		return localAgentIdentity{}, nil, err
	}
	entry, err := s.agentByID(identity.LocalAgentRef)
	if err != nil {
		return localAgentIdentity{}, nil, err
	}
	if err := validateAgentRecordIdentity(entry.Agent, identity); err != nil {
		return localAgentIdentity{}, nil, err
	}
	return identity, entry, nil
}

func localAgentRefForEntry(entry *agentEntry) (string, error) {
	if entry == nil || entry.Agent == nil {
		return "", fmt.Errorf("agent entry is required")
	}
	localAgentRef := strings.TrimSpace(entry.Agent.GetLocalAgentRef())
	if localAgentRef == "" {
		return "", fmt.Errorf("local_agent_ref is required")
	}
	return localAgentRef, nil
}
