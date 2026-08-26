package runtimeagent

import (
	"context"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
)

// @nimi-authority: rule.nimi.runtime.agent-service.r060
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r016
type sourceCognitionBridge interface {
	IngestAgentSource(context.Context, string, string, string, string, string, []cognitionservice.AgentSourceUnit, []cognitionservice.AgentSourceOmission) (cognitionservice.AgentSourceOutcome, error)
	SearchAgentSource(context.Context, string, string, string, string, string, int) (cognitionservice.AgentSourceOutcome, error)
	InspectAgentSource(context.Context, string, string, string) (cognitionservice.AgentSourceOutcome, error)
	DeleteAgentSource(context.Context, string, string, string) (cognitionservice.AgentSourceOutcome, error)
}

func validateSourceCognitionOutcomeBinding(outcome cognitionservice.AgentSourceOutcome, scopeID, snapshotIdentity string) error {
	if outcome.ScopeID != scopeID || outcome.SnapshotIdentity != snapshotIdentity {
		return fmt.Errorf("source Cognition outcome binding mismatch")
	}
	return nil
}

func validateSourceCognitionGenerationBinding(outcome cognitionservice.AgentSourceOutcome, binding localAgentSourcePartitionBindingV1) error {
	if outcome.Generation == 0 || outcome.PartitionIdentity != binding.PartitionHash || outcome.UnitCount != binding.UnitCount || outcome.OmissionCount != binding.OmissionCount {
		return fmt.Errorf("source Cognition generation partition binding mismatch")
	}
	return nil
}

func (s *Service) activeSourceCognitionNeedsRebuild(ctx context.Context, accountID string) bool {
	if s == nil || s.sourceCognitionBridge == nil || s.publicChatSourceSnapshotResolve == nil {
		return false
	}
	s.mu.RLock()
	refs := make([]string, 0)
	for ref, entry := range s.agents {
		if entry != nil && entry.Agent != nil && entry.Agent.GetOwnerUserId() == accountID && entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
			refs = append(refs, ref)
		}
	}
	s.mu.RUnlock()
	for _, localAgentRef := range refs {
		snapshot, found, err := s.publicChatSourceSnapshotResolve(ctx, localAgentRef)
		if err != nil || !found {
			return true
		}
		scopeID := sourceCognitionScopeID(localAgentRef)
		outcome, err := s.sourceCognitionBridge.InspectAgentSource(ctx, accountID, scopeID, snapshot.SnapshotHash)
		if err != nil || validateSourceCognitionOutcomeBinding(outcome, scopeID, snapshot.SnapshotHash) != nil || validateSourceCognitionGenerationBinding(outcome, snapshot.Partition) != nil || outcome.Status != "ready" {
			return true
		}
	}
	return false
}

func (s *Service) scheduleActiveSourceCognitionRebuild(ctx context.Context, accountID string, force bool) {
	if s == nil || s.sourceCognitionBridge == nil {
		return
	}
	_ = ctx
	s.mu.RLock()
	refs := make([]string, 0)
	for ref, entry := range s.agents {
		if entry != nil && entry.Agent != nil && entry.Agent.GetOwnerUserId() == accountID && entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
			refs = append(refs, ref)
		}
	}
	s.mu.RUnlock()
	for _, localAgentRef := range refs {
		s.scheduleSourceCognitionRebuild(accountID, localAgentRef, force)
	}
}

func (s *Service) scheduleSourceCognitionRebuild(accountID, localAgentRef string, force bool) {
	if s == nil || s.sourceCognitionBridge == nil {
		return
	}
	jobKey := accountID + "\x00" + localAgentRef
	s.sourceCognitionLifecycleMu.Lock()
	if s.isClosed() {
		s.sourceCognitionLifecycleMu.Unlock()
		return
	}
	if _, exists := s.sourceCognitionJobs[jobKey]; exists {
		s.sourceCognitionLifecycleMu.Unlock()
		return
	}
	if s.sourceCognitionJobs == nil {
		s.sourceCognitionJobs = make(map[string]struct{})
	}
	s.sourceCognitionJobs[jobKey] = struct{}{}
	s.sourceCognitionWG.Add(1)
	lifecycleCtx := s.sourceCognitionLifecycleCtx
	if lifecycleCtx == nil {
		lifecycleCtx = context.Background()
	}
	s.sourceCognitionLifecycleMu.Unlock()
	go func() {
		defer func() {
			s.sourceCognitionLifecycleMu.Lock()
			delete(s.sourceCognitionJobs, jobKey)
			s.sourceCognitionLifecycleMu.Unlock()
			s.sourceCognitionWG.Done()
		}()
		ctx, cancel := context.WithTimeout(lifecycleCtx, 5*time.Minute)
		defer cancel()
		if err := s.rebuildSourceCognition(ctx, accountID, localAgentRef, force); err != nil && s.logger != nil {
			s.logger.Warn("source Cognition snapshot replay did not complete", "status", "failure", "error", err)
		}
	}()
}

func (s *Service) rebuildActiveSourceCognition(ctx context.Context, accountID string) error {
	if s == nil || s.sourceCognitionBridge == nil || s.publicChatSourceSnapshotResolve == nil {
		return nil
	}
	s.mu.RLock()
	refs := make([]string, 0)
	for ref, entry := range s.agents {
		if entry == nil || entry.Agent == nil || entry.Agent.GetOwnerUserId() != accountID || entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
			continue
		}
		refs = append(refs, ref)
	}
	s.mu.RUnlock()
	for _, localAgentRef := range refs {
		if err := s.rebuildSourceCognition(ctx, accountID, localAgentRef, false); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) rebuildSourceCognition(ctx context.Context, accountID, localAgentRef string, force bool) error {
	if s == nil || s.sourceCognitionBridge == nil || s.publicChatSourceSnapshotResolve == nil {
		return fmt.Errorf("source Cognition rebuild owner is unavailable")
	}
	s.mu.RLock()
	entry := s.agents[localAgentRef]
	active := entry != nil && entry.Agent != nil && entry.Agent.GetOwnerUserId() == accountID && entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE
	s.mu.RUnlock()
	if !active {
		return fmt.Errorf("source Cognition rebuild LocalAgent binding is unavailable")
	}
	snapshot, found, err := s.publicChatSourceSnapshotResolve(ctx, localAgentRef)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("source Cognition rebuild snapshot is absent")
	}
	scopeID := sourceCognitionScopeID(localAgentRef)
	if !force {
		if outcome, inspectErr := s.sourceCognitionBridge.InspectAgentSource(ctx, accountID, scopeID, snapshot.SnapshotHash); inspectErr == nil &&
			validateSourceCognitionOutcomeBinding(outcome, scopeID, snapshot.SnapshotHash) == nil &&
			validateSourceCognitionGenerationBinding(outcome, snapshot.Partition) == nil && outcome.Status == "ready" {
			return nil
		}
	}
	partition, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		return err
	}
	if partition.PartitionHash != snapshot.Partition.PartitionHash || uint32(len(partition.CognitionUnits)) != snapshot.Partition.UnitCount || uint32(len(partition.Omissions)) != snapshot.Partition.OmissionCount {
		return fmt.Errorf("source Cognition rebuild partition binding changed")
	}
	outcome, err := s.ingestSourceCognitionWhileAgentActive(ctx, accountID, localAgentRef, snapshot, partition)
	if err != nil {
		return err
	}
	if err := validateSourceCognitionOutcomeBinding(outcome, scopeID, snapshot.SnapshotHash); err != nil {
		return err
	}
	if err := validateSourceCognitionGenerationBinding(outcome, snapshot.Partition); err != nil {
		return err
	}
	if outcome.Status != "building" {
		return fmt.Errorf("source Cognition rebuild did not start a building generation")
	}
	return nil
}

func (s *Service) SetSourceCognitionBridge(bridge sourceCognitionBridge) {
	if s != nil {
		s.sourceCognitionBridge = bridge
		if bridge == nil {
			return
		}
		s.mu.RLock()
		accounts := make(map[string]struct{})
		for _, entry := range s.agents {
			if entry != nil && entry.Agent != nil && entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
				accounts[entry.Agent.GetOwnerUserId()] = struct{}{}
			}
		}
		s.mu.RUnlock()
		for accountID := range accounts {
			s.scheduleActiveSourceCognitionRebuild(context.Background(), accountID, false)
		}
	}
}

func sourceCognitionScopeID(localAgentRef string) string {
	return "agent_source_" + sha256HexBytes([]byte("nimi.runtime.agent-source-scope/v1\x00"+localAgentRef))
}

func cognitionUnitsFromPartition(partition localAgentSourcePartitionV1) []cognitionservice.AgentSourceUnit {
	result := make([]cognitionservice.AgentSourceUnit, 0, len(partition.CognitionUnits))
	for _, unit := range partition.CognitionUnits {
		result = append(result, cognitionservice.AgentSourceUnit{UnitID: unit.StableID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: cognitionservice.AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority})
	}
	return result
}

func cognitionOmissionsFromPartition(partition localAgentSourcePartitionV1) []cognitionservice.AgentSourceOmission {
	result := make([]cognitionservice.AgentSourceOmission, 0, len(partition.Omissions))
	for _, omission := range partition.Omissions {
		result = append(result, cognitionservice.AgentSourceOmission{
			UnitID: omission.StableID, Category: omission.Category, SourcePath: omission.SourcePath,
			SourceRef:      cognitionservice.AgentSourceRef{Kind: omission.SourceRef.Kind, WorldID: omission.SourceRef.WorldID, RefID: omission.SourceRef.RefID, SchemaVersion: omission.SourceRef.SchemaVersion, ContentHash: omission.SourceRef.ContentHash},
			OmissionReason: omission.OmissionReason,
			ProvenanceRefs: append([]string{}, omission.ProvenanceRefs...),
		})
	}
	return result
}

func (s *Service) ingestSourceCognitionWhileAgentActive(
	ctx context.Context,
	accountID string,
	localAgentRef string,
	snapshot localAgentSourceSnapshotV2,
	partition localAgentSourcePartitionV1,
) (cognitionservice.AgentSourceOutcome, error) {
	if s == nil || s.sourceCognitionBridge == nil {
		return cognitionservice.AgentSourceOutcome{}, fmt.Errorf("source Cognition ingest owner is unavailable")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	entry := s.agents[localAgentRef]
	if s.isClosed() || entry == nil || entry.Agent == nil || entry.Agent.GetOwnerUserId() != accountID ||
		entry.Agent.GetLocalAgentRef() != localAgentRef || entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE ||
		entry.Agent.GetSourceContextStatus() == nil || entry.Agent.GetSourceContextStatus().GetSnapshotHash() != snapshot.SnapshotHash {
		return cognitionservice.AgentSourceOutcome{}, fmt.Errorf("source Cognition ingest LocalAgent binding is no longer active")
	}
	return s.sourceCognitionBridge.IngestAgentSource(
		ctx, accountID, localAgentRef, sourceCognitionScopeID(localAgentRef), snapshot.SnapshotHash,
		partition.PartitionHash, cognitionUnitsFromPartition(partition), cognitionOmissionsFromPartition(partition),
	)
}

func (s *Service) ingestPreparedSourceCognition(ctx context.Context, accountID string, prepared *preparedRealmSourceMaterializationProductV3) error {
	if s == nil || s.sourceCognitionBridge == nil || prepared == nil {
		return nil
	}
	scopeID := sourceCognitionScopeID(prepared.localAgentRef)
	outcome, err := s.ingestSourceCognitionWhileAgentActive(ctx, accountID, prepared.localAgentRef, prepared.snapshot, prepared.partition)
	if err != nil {
		return fmt.Errorf("ingest prepared source Cognition: %w", err)
	}
	if err := validateSourceCognitionOutcomeBinding(outcome, scopeID, prepared.snapshot.SnapshotHash); err != nil {
		return err
	}
	if err := validateSourceCognitionGenerationBinding(outcome, prepared.snapshot.Partition); err != nil {
		return err
	}
	if outcome.Status != "building" {
		return fmt.Errorf("prepared source Cognition did not start a building generation")
	}
	return nil
}
