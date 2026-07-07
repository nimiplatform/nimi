package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) QueryAgentMemory(ctx context.Context, req *runtimev1.QueryAgentMemoryRequest) (*runtimev1.QueryAgentMemoryResponse, error) {
	return s.memoryPolicyRuntime().query(ctx, req)
}

func (s *Service) WriteAgentMemory(ctx context.Context, req *runtimev1.WriteAgentMemoryRequest) (*runtimev1.WriteAgentMemoryResponse, error) {
	return s.memoryPolicyRuntime().write(ctx, req)
}

func (s *Service) GetAgentCanonicalMemoryBankStatus(ctx context.Context, req *runtimev1.GetAgentCanonicalMemoryBankStatusRequest) (*runtimev1.GetAgentCanonicalMemoryBankStatusResponse, error) {
	status, err := s.agentCanonicalMemoryBankStatus(ctx, req.GetContext(), req.GetAgentId())
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentCanonicalMemoryBankStatusResponse{Status: status}, nil
}

func (s *Service) RequestAgentCanonicalMemoryBankBind(ctx context.Context, req *runtimev1.RequestAgentCanonicalMemoryBankBindRequest) (*runtimev1.RequestAgentCanonicalMemoryBankBindResponse, error) {
	identity, _, memoryContext, locator, err := s.agentCanonicalMemoryTarget(req.GetContext(), req.GetAgentId())
	if err != nil {
		return nil, err
	}
	result, err := s.memorySvc.RequestCanonicalMemoryEmbeddingBind(ctx, memoryservice.RequestCanonicalMemoryEmbeddingBindRequest{
		Context: memoryContext,
		Locator: locator,
	})
	if err != nil {
		return nil, err
	}
	status, err := s.agentCanonicalMemoryBankStatusForTarget(ctx, identity, memoryContext, locator)
	if err != nil {
		return nil, err
	}
	return &runtimev1.RequestAgentCanonicalMemoryBankBindResponse{
		Status:            status,
		Outcome:           strings.TrimSpace(result.Outcome),
		BlockedReasonCode: result.BlockedReasonCode,
	}, nil
}

func (s *Service) writeCandidate(ctx context.Context, entry *agentEntry, candidate *runtimev1.CanonicalMemoryCandidate) (*runtimev1.CanonicalMemoryView, *runtimev1.CanonicalMemoryRejection) {
	return s.memoryPolicyRuntime().writeCandidate(ctx, entry, candidate)
}

func (s *Service) queryLocatorsForAgent(entry *agentEntry, classes []runtimev1.MemoryCanonicalClass) []*runtimev1.MemoryBankLocator {
	return s.memoryPolicyRuntime().queryLocators(entry, classes)
}

func canonicalBankDisplayName(locator *runtimev1.MemoryBankLocator) string {
	if locator == nil {
		return "Agent Memory"
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		return "Agent Memory"
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		return "Agent Dyadic Memory"
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED:
		return "World Shared Memory"
	default:
		return "Memory Bank"
	}
}

func (s *Service) agentCanonicalMemoryTarget(ctx *runtimev1.AgentRequestContext, agentID string) (localAgentIdentity, *agentEntry, *runtimev1.MemoryRequestContext, *runtimev1.MemoryBankLocator, error) {
	identity, entry, err := s.agentEntryForIdentityContext(ctx)
	if err != nil {
		return localAgentIdentity{}, nil, nil, nil, err
	}
	if trimmed := strings.TrimSpace(agentID); trimmed == "" || trimmed != identity.LocalAgentRef {
		return localAgentIdentity{}, nil, nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return identity, entry, &runtimev1.MemoryRequestContext{
			AppId:         strings.TrimSpace(ctx.GetAppId()),
			SubjectUserId: identity.OwnerUserID,
		}, &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: identity.LocalAgentRef},
			},
		}, nil
}

func (s *Service) agentCanonicalMemoryBankStatus(ctx context.Context, agentContext *runtimev1.AgentRequestContext, agentID string) (*runtimev1.AgentCanonicalMemoryBankStatus, error) {
	identity, _, memoryContext, locator, err := s.agentCanonicalMemoryTarget(agentContext, agentID)
	if err != nil {
		return nil, err
	}
	return s.agentCanonicalMemoryBankStatusForTarget(ctx, identity, memoryContext, locator)
}

func (s *Service) agentCanonicalMemoryBankStatusForTarget(ctx context.Context, identity localAgentIdentity, memoryContext *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator) (*runtimev1.AgentCanonicalMemoryBankStatus, error) {
	state, err := s.memorySvc.InspectMemoryEmbeddingState(ctx, memoryservice.InspectMemoryEmbeddingStateRequest{
		Context: memoryContext,
		Locator: cloneLocator(locator),
	})
	if err != nil {
		return nil, err
	}
	var bankID string
	var bankProfile *runtimev1.MemoryEmbeddingProfile
	bankResp, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: cloneLocator(locator)})
	if err != nil && status.Code(err) != codes.NotFound {
		return nil, err
	}
	if bankResp.GetBank() != nil {
		bankID = strings.TrimSpace(bankResp.GetBank().GetBankId())
		bankProfile = bankResp.GetBank().GetEmbeddingProfile()
	}
	profile := bankProfile
	if profile == nil {
		profile = state.ResolvedProfileIdentity
	}
	return &runtimev1.AgentCanonicalMemoryBankStatus{
		Mode:                agentCanonicalMemoryBankMode(state),
		BankId:              bankID,
		EmbeddingProfile:    cloneMemoryEmbeddingProfile(profile),
		BindingSourceKind:   strings.TrimSpace(string(state.TextEmbedSourceKind)),
		BlockedReasonCode:   state.BlockedReasonCode,
		PendingCutover:      state.CanonicalBankStatus == "rebuild_pending" || state.CanonicalBankStatus == "cutover_ready",
		CanonicalBankStatus: strings.TrimSpace(state.CanonicalBankStatus),
		BindAllowed:         state.OperationReadiness.BindAllowed,
		CutoverAllowed:      state.OperationReadiness.CutoverAllowed,
	}, nil
}

func agentCanonicalMemoryBankMode(state *memoryservice.MemoryEmbeddingRuntimePrivateState) runtimev1.AgentCanonicalMemoryBankMode {
	if state == nil {
		return runtimev1.AgentCanonicalMemoryBankMode_AGENT_CANONICAL_MEMORY_BANK_MODE_UNAVAILABLE
	}
	switch strings.TrimSpace(state.CanonicalBankStatus) {
	case "bound_equivalent", "bound_profile_mismatch", "rebuild_pending", "cutover_ready":
		return runtimev1.AgentCanonicalMemoryBankMode_AGENT_CANONICAL_MEMORY_BANK_MODE_STANDARD
	default:
		if state.ResolutionState == "resolved" && state.TextEmbedIntentPresent {
			return runtimev1.AgentCanonicalMemoryBankMode_AGENT_CANONICAL_MEMORY_BANK_MODE_BASELINE
		}
		return runtimev1.AgentCanonicalMemoryBankMode_AGENT_CANONICAL_MEMORY_BANK_MODE_UNAVAILABLE
	}
}
