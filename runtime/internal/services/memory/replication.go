package memory

import (
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) RegisterReplicationObserver(handler func(*runtimev1.MemoryEvent)) func() {
	if handler == nil {
		return func() {}
	}
	s.mu.Lock()
	s.nextObserverID++
	observerID := s.nextObserverID
	s.observers[observerID] = handler
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.observers, observerID)
		s.mu.Unlock()
	}
}

func (s *Service) ApplyReplicationObservation(locator *runtimev1.MemoryBankLocator, memoryID string, replication *runtimev1.MemoryReplicationState, observedAt time.Time) error {
	if locator == nil || strings.TrimSpace(memoryID) == "" || replication == nil {
		return status.Error(codes.InvalidArgument, "replication observation requires locator, memory_id, and replication state")
	}
	if err := validateReplicationObservation(replication); err != nil {
		return err
	}
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	} else {
		observedAt = observedAt.UTC()
	}

	bankKey := locatorKey(locator)
	s.mu.Lock()
	state := s.banks[bankKey]
	if state == nil {
		s.mu.Unlock()
		return status.Error(codes.NotFound, "memory bank not found")
	}
	memoryID = strings.TrimSpace(memoryID)
	record := state.Records[memoryID]
	if record == nil {
		s.mu.Unlock()
		return status.Error(codes.NotFound, "memory record not found")
	}
	if locatorKey(record.GetBank()) != bankKey {
		s.mu.Unlock()
		return status.Error(codes.FailedPrecondition, "memory record bank does not match replication observation locator")
	}
	if err := validateReplicationTransition(record.GetReplication().GetOutcome(), replication.GetOutcome()); err != nil {
		s.mu.Unlock()
		return err
	}

	previousRecord := cloneRecord(record)
	previousBankUpdatedAt := cloneReplicationTimestamp(state.Bank.GetUpdatedAt())
	previousBacklog := cloneReplicationBacklogItem(s.replicationBacklog[replicationBacklogKey(record.GetBank(), record.GetMemoryId())])
	record.Replication = cloneReplicationState(replication)
	record.UpdatedAt = timestamppb.New(observedAt)
	state.Bank.UpdatedAt = timestamppb.New(observedAt)
	delete(s.replicationBacklog, replicationBacklogKey(record.GetBank(), record.GetMemoryId()))
	event := &runtimev1.MemoryEvent{
		EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_REPLICATION_UPDATED,
		Bank:      cloneLocator(record.GetBank()),
		Timestamp: timestamppb.New(observedAt),
		Detail: &runtimev1.MemoryEvent_ReplicationUpdated{
			ReplicationUpdated: &runtimev1.MemoryReplicationObservedDetail{
				MemoryId:    record.GetMemoryId(),
				Replication: cloneReplicationState(record.GetReplication()),
			},
		},
	}
	if err := s.persistLocked(); err != nil {
		state.Records[memoryID] = previousRecord
		state.Bank.UpdatedAt = previousBankUpdatedAt
		if previousBacklog != nil {
			s.replicationBacklog[previousBacklog.BacklogKey] = previousBacklog
		}
		s.mu.Unlock()
		return err
	}
	s.assignSequenceLocked(event)
	targets := s.matchingSubscribersLocked(event)
	observers := s.matchingReplicationObserversLocked(event)
	s.mu.Unlock()

	s.broadcast(event, targets)
	s.notifyReplicationObservers(event, observers)
	return nil
}

func matchingReplicationEvent(record *runtimev1.MemoryRecord) *runtimev1.MemoryEvent {
	if record == nil || record.GetBank() == nil || record.GetReplication() == nil {
		return nil
	}
	now := record.GetUpdatedAt()
	if now == nil {
		now = timestamppb.Now()
	}
	return &runtimev1.MemoryEvent{
		EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_REPLICATION_UPDATED,
		Bank:      cloneLocator(record.GetBank()),
		Timestamp: cloneReplicationTimestamp(now),
		Detail: &runtimev1.MemoryEvent_ReplicationUpdated{
			ReplicationUpdated: &runtimev1.MemoryReplicationObservedDetail{
				MemoryId:    record.GetMemoryId(),
				Replication: cloneReplicationState(record.GetReplication()),
			},
		},
	}
}

func (s *Service) matchingReplicationObserversLocked(event *runtimev1.MemoryEvent) []replicationObserver {
	if event == nil || event.GetEventType() != runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_REPLICATION_UPDATED {
		return nil
	}
	ids := make([]uint64, 0, len(s.observers))
	for id := range s.observers {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		return ids[i] < ids[j]
	})
	observers := make([]replicationObserver, 0, len(ids))
	for _, id := range ids {
		handler := s.observers[id]
		if handler == nil {
			continue
		}
		observers = append(observers, replicationObserver{id: id, handler: handler})
	}
	return observers
}

func (s *Service) notifyReplicationObservers(event *runtimev1.MemoryEvent, observers []replicationObserver) {
	if event == nil || len(observers) == 0 {
		return
	}
	for _, observer := range observers {
		if observer.handler == nil {
			continue
		}
		observer.handler(cloneEvent(event))
	}
}

func validateReplicationObservation(replication *runtimev1.MemoryReplicationState) error {
	if replication == nil {
		return status.Error(codes.InvalidArgument, "replication state is required")
	}
	if strings.TrimSpace(replication.GetLocalVersion()) == "" {
		return status.Error(codes.InvalidArgument, "replication state requires local_version")
	}
	switch replication.GetOutcome() {
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING:
		if replication.GetPending() == nil {
			return status.Error(codes.InvalidArgument, "pending replication observation requires pending detail")
		}
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED:
		if replication.GetSynced() == nil {
			return status.Error(codes.InvalidArgument, "synced replication observation requires synced detail")
		}
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT:
		if replication.GetConflict() == nil {
			return status.Error(codes.InvalidArgument, "conflict replication observation requires conflict detail")
		}
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED:
		if replication.GetInvalidation() == nil {
			return status.Error(codes.InvalidArgument, "invalidated replication observation requires invalidation detail")
		}
	default:
		return status.Error(codes.InvalidArgument, "replication observation requires admitted outcome")
	}
	return nil
}

func validateReplicationTransition(current runtimev1.MemoryReplicationOutcome, next runtimev1.MemoryReplicationOutcome) error {
	switch current {
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING:
		switch next {
		case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
			runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT,
			runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED:
			return nil
		}
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT:
		switch next {
		case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
			runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED:
			return nil
		}
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
		runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED:
		return status.Error(codes.FailedPrecondition, "terminal replication state is immutable")
	}
	return status.Error(codes.FailedPrecondition, fmt.Sprintf("illegal replication transition %s -> %s", current, next))
}

func cloneReplicationState(input *runtimev1.MemoryReplicationState) *runtimev1.MemoryReplicationState {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryReplicationState)
}

func cloneReplicationTimestamp(input *timestamppb.Timestamp) *timestamppb.Timestamp {
	if input == nil {
		return nil
	}
	return timestamppb.New(input.AsTime())
}

func replicationOutcome(record *runtimev1.MemoryRecord) runtimev1.MemoryReplicationOutcome {
	if record == nil || record.GetReplication() == nil {
		return runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_UNSPECIFIED
	}
	return record.GetReplication().GetOutcome()
}
