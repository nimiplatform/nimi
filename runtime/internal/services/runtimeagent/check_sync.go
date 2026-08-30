package runtimeagent

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

type DataRootCheckResource struct {
	Kind   string
	Status string
	Reason string
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007e
func (s *Service) CheckSyncDataRoot(ctx context.Context, dataRoot string) ([]DataRootCheckResource, error) {
	if s == nil || s.backend == nil || s.backend.DB() == nil {
		return nil, errors.New("Runtime Agent owner store is unavailable")
	}
	expected := filepath.Join(filepath.Clean(strings.TrimSpace(dataRoot)), "accounts", "runtime")
	relative, err := filepath.Rel(expected, s.backend.Path())
	if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nil, errors.New("Runtime Agent owner store is not bound to current data root")
	}
	if err := s.backend.DB().PingContext(ctx); err != nil {
		return nil, err
	}
	if s.runtimeAccountProjection == nil {
		return []DataRootCheckResource{{Kind: "runtime_owner_store", Status: "unavailable", Reason: "RUNTIME_OWNER_ACCOUNT_REAUTH_REQUIRED"}}, nil
	}
	projection, ok := s.runtimeAccountProjection.AuthenticatedRuntimeProjection(ctx)
	accountID := ""
	if ok && projection != nil {
		accountID = strings.TrimSpace(projection.GetAccountId())
	}
	if accountID == "" {
		return []DataRootCheckResource{{Kind: "runtime_owner_store", Status: "unavailable", Reason: "RUNTIME_OWNER_ACCOUNT_REAUTH_REQUIRED"}}, nil
	}

	resources := make([]DataRootCheckResource, 0)
	s.mu.RLock()
	agentRefs := make([]string, 0)
	accountAgents := make(map[string]*agentEntry)
	for ref, entry := range s.agents {
		if entry == nil || entry.Agent == nil || strings.TrimSpace(entry.Agent.GetOwnerUserId()) != accountID {
			continue
		}
		agentRefs = append(agentRefs, ref)
		accountAgents[ref] = cloneAgentEntry(entry)
	}
	s.mu.RUnlock()
	sort.Strings(agentRefs)
	for _, ref := range agentRefs {
		entry := accountAgents[ref]
		if entry == nil || entry.Agent == nil || strings.TrimSpace(ref) == "" ||
			strings.TrimSpace(entry.Agent.GetLocalAgentRef()) != ref || strings.TrimSpace(entry.Agent.GetRuntimeSourceRef()) == "" ||
			strings.TrimSpace(entry.Agent.GetOwnerUserId()) != accountID {
			resources = append(resources, DataRootCheckResource{Kind: "local_agent", Status: "conflict", Reason: "LOCAL_AGENT_OWNER_RECORD_INVALID"})
			continue
		}
		resources = append(resources, DataRootCheckResource{Kind: "local_agent", Status: "available", Reason: "LOCAL_AGENT_OWNER_RECORD_REOPENED"})
		resources = append(resources, s.checkSyncCognitionMemoryBinding(ctx, ref))
		resources = append(resources, s.checkSyncAgentSourceBinding(ctx, accountID, ref))
	}

	s.chatSurfaceMu.Lock()
	anchorIDs := make([]string, 0)
	accountAnchors := make(map[string]*publicChatAnchorState)
	for anchorID, anchor := range s.chatAnchors {
		if anchor == nil || strings.TrimSpace(anchor.OwnerUserID) != accountID {
			continue
		}
		anchorIDs = append(anchorIDs, anchorID)
		accountAnchors[anchorID] = clonePublicChatAnchorState(anchor)
	}
	s.chatSurfaceMu.Unlock()
	sort.Strings(anchorIDs)
	for _, anchorID := range anchorIDs {
		anchor := accountAnchors[anchorID]
		var entry *agentEntry
		if anchor != nil {
			entry = accountAgents[anchor.LocalAgentRef]
		}
		if anchor == nil || strings.TrimSpace(anchorID) == "" || anchor.ConversationAnchorID != anchorID ||
			anchor.OwnerUserID != accountID || anchor.SubjectUserID != accountID || anchor.AgentID != anchor.LocalAgentRef || strings.TrimSpace(anchor.LocalAgentRef) == "" ||
			strings.TrimSpace(anchor.RuntimeSourceRef) == "" || entry == nil || entry.Agent == nil ||
			entry.Agent.GetOwnerUserId() != accountID || entry.Agent.GetRuntimeSourceRef() != anchor.RuntimeSourceRef {
			resources = append(resources, DataRootCheckResource{Kind: "conversation", Status: "conflict", Reason: "CONVERSATION_OWNER_RECORD_INVALID"})
			continue
		}
		resources = append(resources, DataRootCheckResource{Kind: "conversation", Status: "available", Reason: "CONVERSATION_OWNER_RECORD_REOPENED"})
	}
	if len(resources) == 0 {
		resources = append(resources, DataRootCheckResource{Kind: "runtime_owner_store", Status: "available", Reason: "RUNTIME_OWNER_STORE_EMPTY"})
	}
	return resources, nil
}

func (s *Service) checkSyncCognitionMemoryBinding(ctx context.Context, localAgentRef string) DataRootCheckResource {
	resource := DataRootCheckResource{Kind: "cognition_memory_binding", Status: "unavailable", Reason: "COGNITION_MEMORY_BINDING_UNAVAILABLE"}
	if s.cognitionMemoryFacade == nil {
		return resource
	}
	projection, err := s.cognitionMemoryFacade.InspectBinding(ctx, localAgentRef)
	if err != nil {
		return resource
	}
	switch projection.Outcome {
	case memoryv1.OutcomeReady:
		resource.Status = "available"
		resource.Reason = "COGNITION_MEMORY_BINDING_REOPENED"
	case memoryv1.OutcomeUnconfigured:
		resource.Reason = "COGNITION_MEMORY_BINDING_UNCONFIGURED"
	default:
		resource.Reason = "COGNITION_MEMORY_BINDING_UNAVAILABLE"
	}
	return resource
}

func (s *Service) checkSyncAgentSourceBinding(ctx context.Context, accountID, localAgentRef string) DataRootCheckResource {
	resource := DataRootCheckResource{Kind: "agent_source_binding", Status: "unavailable", Reason: "AGENT_SOURCE_BINDING_UNAVAILABLE"}
	if s.sourceCognitionBridge == nil || s.publicChatSourceSnapshotResolve == nil {
		return resource
	}
	snapshot, found, err := s.publicChatSourceSnapshotResolve(ctx, localAgentRef)
	if err != nil || !found {
		resource.Reason = "AGENT_SOURCE_SNAPSHOT_UNAVAILABLE"
		return resource
	}
	scopeID := sourceCognitionScopeID(localAgentRef)
	outcome, err := s.sourceCognitionBridge.InspectAgentSource(ctx, accountID, scopeID, snapshot.SnapshotHash)
	if err != nil {
		return resource
	}
	if validateSourceCognitionOutcomeBinding(outcome, scopeID, snapshot.SnapshotHash) != nil {
		resource.Status = "conflict"
		resource.Reason = "AGENT_SOURCE_BINDING_CONFLICT"
		return resource
	}
	if outcome.Status == "ready" {
		if validateSourceCognitionGenerationBinding(outcome, snapshot.Partition) != nil {
			resource.Status = "conflict"
			resource.Reason = "AGENT_SOURCE_BINDING_CONFLICT"
			return resource
		}
		resource.Status = "available"
		resource.Reason = "AGENT_SOURCE_BINDING_REOPENED"
		return resource
	}
	if outcome.Generation > 0 && validateSourceCognitionGenerationBinding(outcome, snapshot.Partition) != nil {
		resource.Status = "conflict"
		resource.Reason = "AGENT_SOURCE_BINDING_CONFLICT"
		return resource
	}
	resource.Reason = "AGENT_SOURCE_BINDING_NOT_READY"
	return resource
}
