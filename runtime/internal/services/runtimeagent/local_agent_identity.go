package runtimeagent

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const localAgentRefPrefix = "local-agent:"
const runtimeGeneratedLocalAgentRefPrefix = localAgentRefPrefix + "runtime-"

type localAgentIdentity struct {
	OwnerUserID      string
	RuntimeSourceRef string
	LocalAgentRef    string
}

func validateLocalAgentIdentity(ownerUserID string, runtimeSourceRef string, localAgentRef string) (localAgentIdentity, error) {
	identity := localAgentIdentity{
		OwnerUserID:      strings.TrimSpace(ownerUserID),
		RuntimeSourceRef: strings.TrimSpace(runtimeSourceRef),
		LocalAgentRef:    strings.TrimSpace(localAgentRef),
	}
	if identity.OwnerUserID == "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "owner_user_id is required")
	}
	if identity.RuntimeSourceRef == "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "runtime_source_ref is required")
	}
	if identity.LocalAgentRef == "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "local_agent_ref is required")
	}
	if !strings.HasPrefix(identity.LocalAgentRef, localAgentRefPrefix) {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "local_agent_ref is malformed")
	}
	if identity.LocalAgentRef == identity.RuntimeSourceRef {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "local_agent_ref must not be bare runtime_source_ref")
	}
	return identity, nil
}

func localAgentIdentityFromContext(ctx *runtimev1.AgentRequestContext) (localAgentIdentity, error) {
	if ctx == nil {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "agent request context is required")
	}
	return validateLocalAgentIdentity(ctx.GetOwnerUserId(), ctx.GetRuntimeSourceRef(), ctx.GetLocalAgentRef())
}

func localAgentIdentityFromInitializeRequest(req *runtimev1.InitializeAgentRequest) (localAgentIdentity, error) {
	if req == nil {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "initialize agent request is required")
	}
	ownerUserID := firstNonEmpty(strings.TrimSpace(req.GetOwnerUserId()), strings.TrimSpace(req.GetContext().GetOwnerUserId()))
	runtimeSourceRef := firstNonEmpty(strings.TrimSpace(req.GetRuntimeSourceRef()), strings.TrimSpace(req.GetContext().GetRuntimeSourceRef()))
	localAgentRef := firstNonEmpty(strings.TrimSpace(req.GetLocalAgentRef()), strings.TrimSpace(req.GetContext().GetLocalAgentRef()))
	if strings.TrimSpace(req.GetAgentId()) != "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "agent_id is not local execution identity; use local_agent_ref")
	}
	if localAgentRef == "" {
		generated, err := generateRuntimeLocalAgentRef()
		if err != nil {
			return localAgentIdentity{}, err
		}
		localAgentRef = generated
	}
	return validateLocalAgentIdentity(ownerUserID, runtimeSourceRef, localAgentRef)
}

func generateRuntimeLocalAgentRef() (string, error) {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", status.Errorf(codes.Internal, "generate local_agent_ref: %v", err)
	}
	return runtimeGeneratedLocalAgentRefPrefix + hex.EncodeToString(nonce[:]), nil
}

func localAgentIdentityFromOpenAnchorRequest(req *runtimev1.OpenConversationAnchorRequest) (localAgentIdentity, error) {
	if req == nil {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "open conversation anchor request is required")
	}
	ownerUserID := firstNonEmpty(strings.TrimSpace(req.GetOwnerUserId()), strings.TrimSpace(req.GetContext().GetOwnerUserId()))
	runtimeSourceRef := firstNonEmpty(strings.TrimSpace(req.GetRuntimeSourceRef()), strings.TrimSpace(req.GetContext().GetRuntimeSourceRef()))
	localAgentRef := firstNonEmpty(strings.TrimSpace(req.GetLocalAgentRef()), strings.TrimSpace(req.GetContext().GetLocalAgentRef()))
	if strings.TrimSpace(req.GetAgentId()) != "" {
		return localAgentIdentity{}, status.Error(codes.InvalidArgument, "agent_id is not local execution identity; use local_agent_ref")
	}
	return validateLocalAgentIdentity(ownerUserID, runtimeSourceRef, localAgentRef)
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
	if strings.TrimSpace(agent.GetRuntimeSourceRef()) != identity.RuntimeSourceRef {
		return status.Error(codes.FailedPrecondition, "runtime_source_ref mismatch")
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
