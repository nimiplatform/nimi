package runtimeagent

import (
	"context"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

// OwnsActiveLocalAgent supplies the live ownership check required whenever an
// app presents an opaque Agent handle.
func (s *Service) OwnsActiveLocalAgent(_ context.Context, accountID string, localAgentID string) (bool, error) {
	if s == nil || accountID == "" || accountID != strings.TrimSpace(accountID) || localAgentID == "" || localAgentID != strings.TrimSpace(localAgentID) {
		return false, nil
	}
	entry, err := s.agentByID(localAgentID)
	if err != nil {
		return false, nil
	}
	return entry.Agent != nil && strings.TrimSpace(entry.Agent.GetOwnerUserId()) == accountID &&
		entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, nil
}

// ListOwnedActiveLocalAgents supplies the canonical current membership of the
// granted account scope. Account service turns these owner projections into
// app-bound opaque handles only after the durable grant is revalidated.
func (s *Service) ListOwnedActiveLocalAgents(_ context.Context, accountID string) ([]accountservice.LocalAgentOwnerProjection, error) {
	if s == nil || accountID == "" || accountID != strings.TrimSpace(accountID) {
		return nil, fmt.Errorf("invalid Agent account scope")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	agents := make([]accountservice.LocalAgentOwnerProjection, 0, len(s.agents))
	for _, entry := range s.agents {
		if entry == nil || entry.Agent == nil ||
			strings.TrimSpace(entry.Agent.GetOwnerUserId()) != accountID ||
			entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
			continue
		}
		localAgentID := entry.Agent.GetLocalAgentRef()
		displayName := entry.Agent.GetDisplayName()
		if localAgentID == "" || localAgentID != strings.TrimSpace(localAgentID) ||
			displayName == "" || displayName != strings.TrimSpace(displayName) {
			return nil, fmt.Errorf("active Agent account projection is incomplete")
		}
		agents = append(agents, accountservice.LocalAgentOwnerProjection{
			LocalAgentID: localAgentID,
			DisplayName:  displayName,
		})
	}
	sort.Slice(agents, func(i, j int) bool {
		if agents[i].DisplayName == agents[j].DisplayName {
			return agents[i].LocalAgentID < agents[j].LocalAgentID
		}
		return agents[i].DisplayName < agents[j].DisplayName
	})
	return agents, nil
}
