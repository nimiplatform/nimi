package runtimeagent

import (
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

type replicationRuntime struct {
	svc *Service
}

func (s *Service) replicationRuntime() replicationRuntime {
	return replicationRuntime{svc: s}
}

func (r replicationRuntime) handleCommittedMemoryReplication(event *runtimev1.MemoryEvent) {
	if r.svc == nil || event == nil || event.GetEventType() != runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_REPLICATION_UPDATED {
		return
	}
	detail := event.GetReplicationUpdated()
	if detail == nil || detail.GetReplication() == nil || strings.TrimSpace(detail.GetMemoryId()) == "" {
		return
	}
	agentIDs := r.targetAgentIDs(event.GetBank())
	if len(agentIDs) == 0 {
		return
	}
	observedAt := time.Now().UTC()
	if ts := event.GetTimestamp(); ts != nil {
		observedAt = ts.AsTime().UTC()
	}
	for _, agentID := range agentIDs {
		entry, err := r.svc.agentByID(agentID)
		if err != nil {
			continue
		}
		agentEvent := r.svc.newEventAt(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_REPLICATION, &runtimev1.AgentEvent_Replication{
			Replication: &runtimev1.AgentReplicationEventDetail{
				MemoryId:    detail.GetMemoryId(),
				Replication: proto.Clone(detail.GetReplication()).(*runtimev1.MemoryReplicationState),
			},
		}, observedAt)
		if err := r.svc.updateAgent(entry, agentEvent); err != nil && r.svc.logger != nil {
			r.svc.logger.Warn("runtime-agent replication projection failed", "agent_id", agentID, "memory_id", detail.GetMemoryId(), "error", err)
		}
	}
}

func (r replicationRuntime) targetAgentIDs(locator *runtimev1.MemoryBankLocator) []string {
	if r.svc == nil || locator == nil {
		return nil
	}
	seen := make(map[string]struct{})
	r.svc.mu.RLock()
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		if owner := locator.GetAgentCore(); owner != nil {
			agentID := strings.TrimSpace(owner.GetAgentId())
			if _, ok := r.svc.agents[agentID]; ok && agentID != "" {
				seen[agentID] = struct{}{}
			}
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		if owner := locator.GetAgentDyadic(); owner != nil {
			agentID := strings.TrimSpace(owner.GetAgentId())
			if _, ok := r.svc.agents[agentID]; ok && agentID != "" {
				seen[agentID] = struct{}{}
			}
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED:
		owner := locator.GetWorldShared()
		if owner != nil {
			worldID := strings.TrimSpace(owner.GetWorldId())
			for agentID, entry := range r.svc.agents {
				if entry == nil || entry.State == nil {
					continue
				}
				if strings.TrimSpace(entry.State.GetActiveWorldId()) == worldID && strings.TrimSpace(agentID) != "" {
					seen[agentID] = struct{}{}
				}
			}
		}
	}
	r.svc.mu.RUnlock()
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
