package memory

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	memoryMetaLegacyImportSourcePathKey          = "legacy_import_source_path"
	memoryMetaLegacyImportSourceSHA256Key        = "legacy_import_source_sha256"
	memoryMetaLegacyImportSourceSchemaVersionKey = "legacy_import_source_schema_version"
	memoryMetaLegacyImportedAtKey                = "legacy_imported_at"
	memoryMetaPendingEmbeddingCutoverPrefix      = "pending_embedding_cutover:"
)

func (s *Service) bankForLocator(locator *runtimev1.MemoryBankLocator) (*bankState, error) {
	if locator == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	s.mu.RLock()
	state := s.banks[locatorKey(locator)]
	s.mu.RUnlock()
	if state == nil {
		return nil, status.Error(codes.NotFound, "memory bank not found")
	}
	return cloneBankState(state), nil
}
func (s *Service) insertBank(bank *runtimev1.MemoryBank, event *runtimev1.MemoryEvent) error {
	s.mu.Lock()
	previousSequence := s.sequence
	s.banks[locatorKey(bank.GetLocator())] = &bankState{
		Bank:    cloneBank(bank),
		Records: make(map[string]*runtimev1.MemoryRecord),
		Order:   []string{},
	}
	s.assignSequenceLocked(event)
	if err := s.persistLocked(); err != nil {
		delete(s.banks, locatorKey(bank.GetLocator()))
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targets := s.matchingSubscribersLocked(event)
	s.mu.Unlock()
	s.broadcast(event, targets)
	return nil
}
func (s *Service) deleteBank(bankKey string, event *runtimev1.MemoryEvent) error {
	s.mu.Lock()
	previous := s.banks[bankKey]
	previousSequence := s.sequence
	previousBacklog := make(map[string]*ReplicationBacklogItem)
	for key, item := range s.replicationBacklog {
		if item == nil || locatorKey(item.Locator) != bankKey {
			continue
		}
		previousBacklog[key] = cloneReplicationBacklogItem(item)
	}
	delete(s.banks, bankKey)
	s.removeReplicationBacklogForBankLocked(bankKey)
	s.assignSequenceLocked(event)
	if err := s.persistLocked(); err != nil {
		s.banks[bankKey] = previous
		s.sequence = previousSequence
		for key, item := range previousBacklog {
			s.replicationBacklog[key] = item
		}
		s.mu.Unlock()
		return err
	}
	targets := s.matchingSubscribersLocked(event)
	s.mu.Unlock()
	s.broadcast(event, targets)
	return nil
}
func (s *Service) insertRecords(bankKey string, records []*runtimev1.MemoryRecord, events []*runtimev1.MemoryEvent) error {
	s.mu.Lock()
	previousSequence := s.sequence
	state := s.banks[bankKey]
	if state == nil {
		s.mu.Unlock()
		return status.Error(codes.NotFound, "memory bank not found")
	}
	for _, record := range records {
		if _, exists := state.Records[record.GetMemoryId()]; !exists {
			state.Order = append(state.Order, record.GetMemoryId())
		}
		state.Records[record.GetMemoryId()] = cloneRecord(record)
		state.Bank.UpdatedAt = timestamppb.Now()
	}
	s.enqueueReplicationBacklogRecordsLocked(state.Bank, records)
	targetsByEvent := make([][]*subscriber, 0, len(events))
	for _, event := range events {
		s.assignSequenceLocked(event)
		targetsByEvent = append(targetsByEvent, s.matchingSubscribersLocked(event))
	}
	if err := s.persistLocked(); err != nil {
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	s.mu.Unlock()
	for i, event := range events {
		s.broadcast(event, targetsByEvent[i])
	}
	return nil
}
func (s *Service) replaceBankRecords(bankKey string, records []*runtimev1.MemoryRecord, event *runtimev1.MemoryEvent) error {
	return s.replaceBankRecordsWithTxHook(bankKey, records, event, nil)
}
func (s *Service) replaceBankRecordsWithTxHook(bankKey string, records []*runtimev1.MemoryRecord, event *runtimev1.MemoryEvent, txHook persistTxHook) error {
	s.mu.Lock()
	previousSequence := s.sequence
	state := s.banks[bankKey]
	if state == nil {
		s.mu.Unlock()
		return status.Error(codes.NotFound, "memory bank not found")
	}
	previousState := cloneBankState(state)
	previousBacklog := make(map[string]*ReplicationBacklogItem)
	for key, item := range s.replicationBacklog {
		if item == nil || locatorKey(item.Locator) != bankKey {
			continue
		}
		previousBacklog[key] = cloneReplicationBacklogItem(item)
	}
	state.Records = make(map[string]*runtimev1.MemoryRecord, len(records))
	state.Order = make([]string, 0, len(records))
	for _, record := range records {
		state.Records[record.GetMemoryId()] = cloneRecord(record)
		state.Order = append(state.Order, record.GetMemoryId())
	}
	state.Bank.UpdatedAt = timestamppb.Now()
	s.syncReplicationBacklogForBankLocked(state.Bank, records)
	s.assignSequenceLocked(event)
	if err := s.persistLockedWithTxHook(txHook); err != nil {
		s.banks[bankKey] = previousState
		s.removeReplicationBacklogForBankLocked(bankKey)
		for key, item := range previousBacklog {
			s.replicationBacklog[key] = item
		}
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targets := s.matchingSubscribersLocked(event)
	s.mu.Unlock()
	s.broadcast(event, targets)
	return nil
}
func (s *Service) publishOnly(event *runtimev1.MemoryEvent) error {
	s.mu.Lock()
	previousSequence := s.sequence
	s.assignSequenceLocked(event)
	if err := s.persistLocked(); err != nil {
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targets := s.matchingSubscribersLocked(event)
	s.mu.Unlock()
	s.broadcast(event, targets)
	return nil
}
func (s *Service) assignSequenceLocked(event *runtimev1.MemoryEvent) {
	s.sequence++
	event.Sequence = s.sequence
}
func (s *Service) matchingSubscribersLocked(event *runtimev1.MemoryEvent) []*subscriber {
	targets := make([]*subscriber, 0, len(s.subscribers))
	for _, sub := range s.subscribers {
		if !subscriberMatchesEvent(sub, event) {
			continue
		}
		targets = append(targets, sub)
	}
	return targets
}
func (s *Service) broadcast(event *runtimev1.MemoryEvent, targets []*subscriber) {
	for _, sub := range targets {
		cloned := cloneEvent(event)
		select {
		case sub.ch <- cloned:
			continue
		default:
		}
		select {
		case <-sub.ch:
		default:
		}
		select {
		case sub.ch <- cloned:
		default:
		}
	}
}
func (s *Service) addSubscriber(req *runtimev1.SubscribeMemoryEventsRequest) *subscriber {
	sub := &subscriber{
		scopeFilters:    make(map[runtimev1.MemoryBankScope]struct{}),
		ownerFilterKeys: make(map[string]struct{}),
		ch:              make(chan *runtimev1.MemoryEvent, subscriberBuffer),
	}
	for _, scope := range req.GetScopeFilters() {
		sub.scopeFilters[scope] = struct{}{}
	}
	for _, owner := range req.GetOwnerFilters() {
		sub.ownerFilterKeys[ownerFilterKey(owner)] = struct{}{}
	}
	s.mu.Lock()
	s.nextSubscriberID++
	sub.id = s.nextSubscriberID
	s.subscribers[sub.id] = sub
	s.mu.Unlock()
	return sub
}
func (s *Service) removeSubscriber(id uint64) {
	s.mu.Lock()
	sub := s.subscribers[id]
	delete(s.subscribers, id)
	s.mu.Unlock()
	if sub != nil {
		close(sub.ch)
	}
}
func subscriberMatchesEvent(sub *subscriber, event *runtimev1.MemoryEvent) bool {
	if sub == nil || event == nil || event.GetBank() == nil {
		return false
	}
	if len(sub.scopeFilters) > 0 {
		if _, ok := sub.scopeFilters[event.GetBank().GetScope()]; !ok {
			return false
		}
	}
	if len(sub.ownerFilterKeys) > 0 {
		if _, ok := sub.ownerFilterKeys[locatorKey(event.GetBank())]; !ok {
			return false
		}
	}
	return true
}
