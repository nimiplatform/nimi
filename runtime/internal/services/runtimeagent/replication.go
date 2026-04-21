package runtimeagent

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func (s *Service) handleCommittedMemoryReplication(event *runtimev1.MemoryEvent) {
	s.replicationRuntime().handleCommittedMemoryReplication(event)
}

func (s *Service) replicationTargetAgentIDs(locator *runtimev1.MemoryBankLocator) []string {
	return s.replicationRuntime().targetAgentIDs(locator)
}
