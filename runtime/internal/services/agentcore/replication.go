package agentcore

import (
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func (s *Service) handleCommittedMemoryReplication(event *runtimev1.MemoryEvent) {
	if s == nil || event == nil || event.GetEventType() != runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_REPLICATION_UPDATED {
		return
	}
	detail := event.GetReplicationUpdated()
	if detail == nil || detail.GetReplication() == nil || strings.TrimSpace(detail.GetMemoryId()) == "" {
		return
	}
	agentIDs := s.replicationTargetAgentIDs(event.GetBank())
	if len(agentIDs) == 0 {
		return
	}
	observedAt := time.Now().UTC()
	if ts := event.GetTimestamp(); ts != nil {
		observedAt = ts.AsTime().UTC()
	}
	for _, agentID := range agentIDs {
		entry, err := s.agentByID(agentID)
		if err != nil {
			continue
		}
		agentEvent := s.newEventAt(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_REPLICATION, &runtimev1.AgentEvent_Replication{
			Replication: &runtimev1.AgentReplicationEventDetail{
				MemoryId:    detail.GetMemoryId(),
				Replication: proto.Clone(detail.GetReplication()).(*runtimev1.MemoryReplicationState),
			},
		}, observedAt)
		if err := s.updateAgent(entry, agentEvent); err != nil && s.logger != nil {
			s.logger.Warn("agentcore replication projection failed", "agent_id", agentID, "memory_id", detail.GetMemoryId(), "error", err)
		}
	}
}

func (s *Service) replicationTargetAgentIDs(locator *runtimev1.MemoryBankLocator) []string {
	if s == nil || locator == nil {
		return nil
	}
	seen := make(map[string]struct{})
	s.mu.RLock()
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		if owner := locator.GetAgentCore(); owner != nil {
			agentID := strings.TrimSpace(owner.GetAgentId())
			if _, ok := s.agents[agentID]; ok && agentID != "" {
				seen[agentID] = struct{}{}
			}
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		if owner := locator.GetAgentDyadic(); owner != nil {
			agentID := strings.TrimSpace(owner.GetAgentId())
			if _, ok := s.agents[agentID]; ok && agentID != "" {
				seen[agentID] = struct{}{}
			}
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED:
		owner := locator.GetWorldShared()
		if owner != nil {
			worldID := strings.TrimSpace(owner.GetWorldId())
			for agentID, entry := range s.agents {
				if entry == nil || entry.State == nil {
					continue
				}
				if strings.TrimSpace(entry.State.GetActiveWorldId()) == worldID && strings.TrimSpace(agentID) != "" {
					seen[agentID] = struct{}{}
				}
			}
		}
	}
	s.mu.RUnlock()
	if len(seen) == 0 {
		return nil
	}
	agentIDs := make([]string, 0, len(seen))
	for agentID := range seen {
		agentIDs = append(agentIDs, agentID)
	}
	sort.Strings(agentIDs)
	return agentIDs
}
