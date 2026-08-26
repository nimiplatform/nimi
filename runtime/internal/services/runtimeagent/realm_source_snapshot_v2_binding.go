package runtimeagent

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

// validateLoadedSourceSnapshotBindings is the restart fail-closed gate for the
// active Realm v3 source domain. Every v3 source-backed LocalAgent has exactly
// one valid SnapshotV2/provenance membership, and no ordinary LocalAgent may
// carry a source-context projection.
func (s *Service) validateLoadedSourceSnapshotBindings(ctx context.Context) error {
	if s == nil || s.realmSourceSnapshotStoreV2 == nil || s.backend == nil {
		return fmt.Errorf("Realm source SnapshotV2 store is unavailable")
	}
	s.mu.RLock()
	agents := make([]*runtimev1.LocalAgentRecord, 0, len(s.agents))
	for _, entry := range s.agents {
		if entry != nil && entry.Agent != nil {
			agents = append(agents, cloneLocalAgentRecord(entry.Agent))
		}
	}
	s.mu.RUnlock()

	materializedCount := 0
	turnSourceViews := make(map[string]localAgentTurnSourceViewV1)
	for _, agent := range agents {
		runtimeSourceRef := strings.TrimSpace(agent.GetRuntimeSourceRef())
		if !strings.HasPrefix(runtimeSourceRef, localAgentRealmRuntimeSourceRefPrefixV3) {
			if strings.HasPrefix(runtimeSourceRef, "runtime-source:") {
				return fmt.Errorf("source_materialization_data_reset_required: LocalAgent %s uses a pre-v3 source identity", agent.GetLocalAgentRef())
			}
			if agent.GetSourceContextStatus() != nil {
				return fmt.Errorf("ordinary LocalAgent %s carries Realm source context status", agent.GetLocalAgentRef())
			}
			continue
		}
		materializedCount++
		snapshot, found, err := s.realmSourceSnapshotStoreV2.sourceSnapshot(ctx, agent.GetLocalAgentRef())
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("Realm-derived LocalAgent %s has no immutable SnapshotV2", agent.GetLocalAgentRef())
		}
		expectedRuntimeSourceRef, err := runtimeSourceRefForRealmSourceV3(snapshot.Semantic.SourceRef)
		if err != nil || runtimeSourceRef != expectedRuntimeSourceRef {
			return fmt.Errorf("Realm-derived LocalAgent %s source identity does not match SnapshotV2", agent.GetLocalAgentRef())
		}
		if !proto.Equal(agent.GetSourceContextStatus(), localAgentSourceContextStatusV2(snapshot)) {
			return fmt.Errorf("Realm-derived LocalAgent %s bounded source status does not match SnapshotV2", agent.GetLocalAgentRef())
		}
		view, err := localAgentTurnSourceViewFromSnapshotV1(snapshot)
		if err != nil {
			return fmt.Errorf("hydrate Realm-derived LocalAgent %s turn source view: %w", agent.GetLocalAgentRef(), err)
		}
		turnSourceViews[agent.GetLocalAgentRef()] = view
	}

	var snapshotCount int
	if err := s.backend.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM runtime_local_agent_source_snapshot_v2`).Scan(&snapshotCount); err != nil {
		return fmt.Errorf("count persisted Realm source SnapshotV2 records: %w", err)
	}
	if snapshotCount != materializedCount {
		return fmt.Errorf("Realm source SnapshotV2 1:1 count mismatch: agents=%d snapshots=%d", materializedCount, snapshotCount)
	}
	s.mu.Lock()
	s.turnSourceViews = turnSourceViews
	s.mu.Unlock()
	return nil
}

func deleteLocalAgentSourceSnapshotV2Tx(tx *sql.Tx, localAgentRef string) error {
	if tx == nil {
		return fmt.Errorf("Realm source SnapshotV2 deletion transaction is required")
	}
	ref := strings.TrimSpace(localAgentRef)
	if ref == "" {
		return fmt.Errorf("Realm source SnapshotV2 local_agent_ref is required")
	}
	if _, err := tx.Exec(`DELETE FROM runtime_local_agent_source_snapshot_v2 WHERE local_agent_ref = ?`, ref); err != nil {
		return fmt.Errorf("delete Realm source SnapshotV2: %w", err)
	}
	return nil
}

func localAgentSourceCoverageSection(path string) runtimev1.AgentLocalSourceCoverageSection {
	switch strings.TrimSpace(path) {
	case "source.core.identity":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_IDENTITY
	case "source.core.presentation":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_PRESENTATION
	case "source.core.narrative":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_BIOGRAPHY
	case "source.core.psychology":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_PSYCHOLOGY
	case "source.core.knowledge":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_KNOWLEDGE
	case "source.core.relationships":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_RELATIONSHIPS
	case "source.core.capabilities":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_CAPABILITIES
	case "source.core.interactionProfile":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_INTERACTION_PROFILE
	case "source.core.assets":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_ASSETS
	case "source.core.authoring":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_AUTHORING
	case "world.core":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_WORLD_CORE
	case "closure.boundEntity":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_BOUND_ENTITY
	case "closure":
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_DEPENDENCY_CLOSURE
	default:
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_UNSPECIFIED
	}
}
