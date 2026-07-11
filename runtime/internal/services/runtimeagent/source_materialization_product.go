package runtimeagent

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// PrepareSourceMaterializationProduct prepares the Runtime-owned LocalAgent
// projection while holding the Agent state lock through the caller's SQLite
// commit. Readers therefore observe either no product at all or the complete
// Agent + snapshot + provenance + safe replay-ledger result.
func (s *Service) PrepareSourceMaterializationProduct(
	_ context.Context,
	localAgentRef string,
	accountID string,
	sourceRef *runtimev1.SourceMaterializationSourceRef,
	snapshot localAgentSourceSnapshotV1,
) (sourceMaterializationPreparedProduct, error) {
	if s == nil || s.stateRepo == nil || s.agentAIConfigRepo == nil {
		return nil, fmt.Errorf("source materialization product store is unavailable")
	}
	if s.isClosed() {
		return nil, fmt.Errorf("source materialization product store is closed")
	}
	localAgentRef = strings.TrimSpace(localAgentRef)
	accountID = strings.TrimSpace(accountID)
	if localAgentRef == "" || accountID == "" || localAgentRef != snapshot.LocalAgentRef {
		return nil, fmt.Errorf("source materialization product identity is invalid")
	}
	validatedSourceRef, err := validateSourceMaterializationSourceRef(sourceRef)
	if err != nil || !sameSourceMaterializationSourceRef(validatedSourceRef, sourceMaterializationProtoRefFromSnapshot(snapshot.SourceRef)) {
		return nil, fmt.Errorf("source materialization product source binding is invalid")
	}
	if err := validateLocalAgentSourceSnapshotV1(snapshot); err != nil {
		return nil, fmt.Errorf("source materialization product snapshot is invalid: %w", err)
	}
	capturedAt, err := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	if err != nil {
		return nil, fmt.Errorf("source materialization product captured_at is invalid")
	}
	capturedAt = capturedAt.UTC()
	runtimeSourceRef := runtimeSourceRefForMaterialization(validatedSourceRef)
	identity := localAgentIdentity{OwnerUserID: accountID, RuntimeSourceRef: runtimeSourceRef, LocalAgentRef: localAgentRef}
	agent := &runtimev1.AgentRecord{
		AgentId:             localAgentRef,
		LocalAgentRef:       localAgentRef,
		OwnerUserId:         accountID,
		RuntimeSourceRef:    runtimeSourceRef,
		DisplayName:         sourceMaterializationDisplayName(snapshot),
		LifecycleStatus:     runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		Autonomy:            buildInitialAutonomyState(nil, capturedAt),
		SourceContextStatus: localAgentSourceContextStatus(snapshot),
		CreatedAt:           timestamppb.New(capturedAt),
		UpdatedAt:           timestamppb.New(capturedAt),
	}
	state := &runtimev1.AgentStateProjection{
		ExecutionState: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE,
		ActiveWorldId:  validatedSourceRef.GetWorldId(),
		Attributes:     map[string]string{},
		UpdatedAt:      timestamppb.New(capturedAt),
	}
	entry := &agentEntry{Agent: agent, State: state, Hooks: make(map[string]*runtimev1.PendingHook)}
	lifecycleEvent := s.newEventForIdentityAt(identity, runtimev1.AgentEventType_AGENT_EVENT_TYPE_LIFECYCLE, &runtimev1.AgentEvent_Lifecycle{
		Lifecycle: &runtimev1.AgentLifecycleEventDetail{
			PreviousStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_UNSPECIFIED,
			CurrentStatus:  runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		},
	}, capturedAt)

	s.mu.Lock()
	previousEntry, hadEntry := s.agents[localAgentRef]
	if hadEntry {
		s.mu.Unlock()
		return nil, fmt.Errorf("source materialization product local_agent_ref already exists")
	}
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	s.agents[localAgentRef] = cloneAgentEntry(entry)
	committedEvents := s.eventStreamRuntime().appendEventsLocked(lifecycleEvent)
	persisted, err := s.stateRepo.snapshotStateLocked(s)
	if err != nil {
		delete(s.agents, localAgentRef)
		s.events = previousEvents
		s.sequence = previousSequence
		s.mu.Unlock()
		return nil, err
	}
	seed := seedRuntimeAgentAIConfig(localAgentRef)
	seed.UpdatedAt = timestamppb.New(capturedAt)
	return &preparedSourceMaterializationProduct{
		svc:              s,
		localAgentRef:    localAgentRef,
		previousEntry:    previousEntry,
		hadEntry:         hadEntry,
		previousEvents:   previousEvents,
		previousSequence: previousSequence,
		persisted:        persisted,
		committedEvents:  committedEvents,
		seedAIConfig:     seed,
	}, nil
}

type preparedSourceMaterializationProduct struct {
	svc              *Service
	localAgentRef    string
	previousEntry    *agentEntry
	hadEntry         bool
	previousEvents   []*runtimev1.AgentEvent
	previousSequence uint64
	persisted        persistedRuntimeAgentState
	committedEvents  []*runtimev1.AgentEvent
	seedAIConfig     *runtimev1.RuntimeAgentAIConfig
	finalizeOnce     sync.Once
}

func (p *preparedSourceMaterializationProduct) CommitSourceMaterializationProductTx(tx *sql.Tx) error {
	if p == nil || p.svc == nil || p.svc.stateRepo == nil || p.svc.agentAIConfigRepo == nil {
		return fmt.Errorf("prepared source materialization product is unavailable")
	}
	if err := p.svc.stateRepo.persistSnapshotTx(tx, p.persisted, nil); err != nil {
		return err
	}
	if err := p.svc.agentAIConfigRepo.commitSeedTx(tx, p.seedAIConfig); err != nil {
		return err
	}
	return nil
}

func (p *preparedSourceMaterializationProduct) SourceMaterializationProductCommitted() {
	if p == nil || p.svc == nil {
		return
	}
	p.finalizeOnce.Do(func() {
		targets := p.svc.eventStreamRuntime().matchingSubscribersLocked(p.committedEvents)
		p.svc.mu.Unlock()
		p.svc.eventStreamRuntime().broadcast(p.committedEvents, targets)
		p.svc.recordRuntimeAgentAIConfigAudit(p.seedAIConfig, runtimeAgentAIConfigSeededEventType)
		if err := p.svc.refreshRuntimeAgentAIConfigReadiness(p.localAgentRef); err != nil && p.svc.logger != nil {
			p.svc.logger.Warn("recompute runtime agent ai config readiness after source materialization failed", "local_agent_ref", p.localAgentRef, "error", err)
		}
	})
}

func (p *preparedSourceMaterializationProduct) SourceMaterializationProductRolledBack() {
	if p == nil || p.svc == nil {
		return
	}
	p.finalizeOnce.Do(func() {
		if p.hadEntry {
			p.svc.agents[p.localAgentRef] = p.previousEntry
		} else {
			delete(p.svc.agents, p.localAgentRef)
		}
		p.svc.events = p.previousEvents
		p.svc.sequence = p.previousSequence
		p.svc.mu.Unlock()
	})
}

func sourceMaterializationProtoRefFromSnapshot(sourceRef sourceMaterializationSourceRefV2) *runtimev1.SourceMaterializationSourceRef {
	kind, _ := sourceMaterializationProtoKind(sourceRef.Kind)
	return &runtimev1.SourceMaterializationSourceRef{
		Kind:              kind,
		WorldId:           sourceRef.WorldID,
		SourceId:          sourceRef.SourceID,
		SourceContentHash: sourceRef.SourceContentHash,
	}
}

func sourceMaterializationDisplayName(snapshot localAgentSourceSnapshotV1) string {
	if snapshot.Character != nil {
		return firstNonEmpty(
			strings.TrimSpace(snapshot.Character.Core.Presentation.DisplayName),
			strings.TrimSpace(snapshot.Character.Core.Identity.Name),
			strings.TrimSpace(snapshot.Character.ID),
			snapshot.LocalAgentRef,
		)
	}
	if snapshot.Persona != nil {
		return firstNonEmpty(
			strings.TrimSpace(snapshot.Persona.Core.Presentation.DisplayName),
			strings.TrimSpace(snapshot.Persona.Core.Identity.Name),
			strings.TrimSpace(snapshot.Persona.ID),
			snapshot.LocalAgentRef,
		)
	}
	return snapshot.LocalAgentRef
}
