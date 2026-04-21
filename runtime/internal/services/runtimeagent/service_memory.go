package runtimeagent

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) QueryAgentMemory(ctx context.Context, req *runtimev1.QueryAgentMemoryRequest) (*runtimev1.QueryAgentMemoryResponse, error) {
	return s.memoryPolicyRuntime().query(ctx, req)
}

func (s *Service) WriteAgentMemory(ctx context.Context, req *runtimev1.WriteAgentMemoryRequest) (*runtimev1.WriteAgentMemoryResponse, error) {
	return s.memoryPolicyRuntime().write(ctx, req)
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
