package memory

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	s.banks[locatorKey(bank.GetLocator())] = &bankState{
		Bank:    cloneBank(bank),
		Records: make(map[string]*runtimev1.MemoryRecord),
		Order:   []string{},
	}
	if err := s.persistLocked(); err != nil {
		delete(s.banks, locatorKey(bank.GetLocator()))
		s.mu.Unlock()
		return err
	}
	s.assignSequenceLocked(event)
	targets := s.matchingSubscribersLocked(event)
	s.mu.Unlock()
	s.broadcast(event, targets)
	return nil
}

func (s *Service) deleteBank(bankKey string, event *runtimev1.MemoryEvent) error {
	s.mu.Lock()
	previous := s.banks[bankKey]
	previousBacklog := make(map[string]*ReplicationBacklogItem)
	for key, item := range s.replicationBacklog {
		if item == nil || locatorKey(item.Locator) != bankKey {
			continue
		}
		previousBacklog[key] = cloneReplicationBacklogItem(item)
	}
	delete(s.banks, bankKey)
	s.removeReplicationBacklogForBankLocked(bankKey)
	if err := s.persistLocked(); err != nil {
		s.banks[bankKey] = previous
		for key, item := range previousBacklog {
			s.replicationBacklog[key] = item
		}
		s.mu.Unlock()
		return err
	}
	s.assignSequenceLocked(event)
	targets := s.matchingSubscribersLocked(event)
	s.mu.Unlock()
	s.broadcast(event, targets)
	return nil
}

func (s *Service) insertRecords(bankKey string, records []*runtimev1.MemoryRecord, events []*runtimev1.MemoryEvent) error {
	s.mu.Lock()
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
	if err := s.persistLocked(); err != nil {
		s.mu.Unlock()
		return err
	}
	targetsByEvent := make([][]*subscriber, 0, len(events))
	for _, event := range events {
		s.assignSequenceLocked(event)
		targetsByEvent = append(targetsByEvent, s.matchingSubscribersLocked(event))
	}
	s.mu.Unlock()
	for i, event := range events {
		s.broadcast(event, targetsByEvent[i])
	}
	return nil
}

func (s *Service) replaceBankRecords(bankKey string, records []*runtimev1.MemoryRecord, event *runtimev1.MemoryEvent) error {
	s.mu.Lock()
	state := s.banks[bankKey]
	if state == nil {
		s.mu.Unlock()
		return status.Error(codes.NotFound, "memory bank not found")
	}
	state.Records = make(map[string]*runtimev1.MemoryRecord, len(records))
	state.Order = make([]string, 0, len(records))
	for _, record := range records {
		state.Records[record.GetMemoryId()] = cloneRecord(record)
		state.Order = append(state.Order, record.GetMemoryId())
	}
	state.Bank.UpdatedAt = timestamppb.Now()
	s.syncReplicationBacklogForBankLocked(state.Bank, records)
	if err := s.persistLocked(); err != nil {
		s.mu.Unlock()
		return err
	}
	s.assignSequenceLocked(event)
	targets := s.matchingSubscribersLocked(event)
	s.mu.Unlock()
	s.broadcast(event, targets)
	return nil
}

func (s *Service) publishOnly(event *runtimev1.MemoryEvent) error {
	s.mu.Lock()
	s.assignSequenceLocked(event)
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

func (s *Service) loadState() error {
	path := strings.TrimSpace(s.statePath)
	if path == "" {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("read memory state: %w", err)
	}
	var snapshot persistedMemoryState
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return fmt.Errorf("parse memory state: %w", err)
	}
	if snapshot.SchemaVersion != memoryStateSchemaVersion {
		return fmt.Errorf("unsupported memory state schemaVersion=%d", snapshot.SchemaVersion)
	}
	for _, item := range snapshot.Banks {
		var bank runtimev1.MemoryBank
		if err := protojson.Unmarshal(item.Bank, &bank); err != nil {
			return fmt.Errorf("restore memory bank %s: %w", item.LocatorKey, err)
		}
		state := &bankState{
			Bank:    cloneBank(&bank),
			Records: make(map[string]*runtimev1.MemoryRecord),
			Order:   []string{},
		}
		for _, rawRecord := range item.Records {
			var record runtimev1.MemoryRecord
			if err := protojson.Unmarshal(rawRecord, &record); err != nil {
				return fmt.Errorf("restore memory record for bank %s: %w", item.LocatorKey, err)
			}
			cloned := cloneRecord(&record)
			state.Records[cloned.GetMemoryId()] = cloned
			state.Order = append(state.Order, cloned.GetMemoryId())
		}
		s.banks[item.LocatorKey] = state
	}
	for _, raw := range snapshot.ReplicationBacklog {
		item, err := s.loadReplicationBacklogItem(raw)
		if err != nil {
			return err
		}
		s.replicationBacklog[item.BacklogKey] = item
	}
	s.sequence = snapshot.Sequence
	return nil
}

func (s *Service) persistLocked() error {
	path := strings.TrimSpace(s.statePath)
	if path == "" {
		return nil
	}
	snapshot := persistedMemoryState{
		SchemaVersion:      memoryStateSchemaVersion,
		SavedAt:            time.Now().UTC().Format(time.RFC3339Nano),
		Sequence:           s.sequence,
		Banks:              make([]persistedBankState, 0, len(s.banks)),
		ReplicationBacklog: make([]persistedReplicationBacklogItem, 0, len(s.replicationBacklog)),
	}
	keys := make([]string, 0, len(s.banks))
	for key := range s.banks {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		state := s.banks[key]
		bankRaw, err := protojson.Marshal(state.Bank)
		if err != nil {
			return fmt.Errorf("marshal memory bank %s: %w", key, err)
		}
		recordRaws := make([]json.RawMessage, 0, len(state.Order))
		for _, recordID := range state.Order {
			record := state.Records[recordID]
			if record == nil {
				continue
			}
			recordRaw, err := protojson.Marshal(record)
			if err != nil {
				return fmt.Errorf("marshal memory record %s: %w", recordID, err)
			}
			recordRaws = append(recordRaws, recordRaw)
		}
		snapshot.Banks = append(snapshot.Banks, persistedBankState{
			LocatorKey: key,
			Bank:       bankRaw,
			Records:    recordRaws,
		})
	}
	backlogKeys := make([]string, 0, len(s.replicationBacklog))
	for key := range s.replicationBacklog {
		backlogKeys = append(backlogKeys, key)
	}
	sort.Strings(backlogKeys)
	for _, key := range backlogKeys {
		item := s.replicationBacklog[key]
		if item == nil {
			continue
		}
		raw, err := marshalReplicationBacklogItem(item)
		if err != nil {
			return fmt.Errorf("marshal replication backlog %s: %w", key, err)
		}
		snapshot.ReplicationBacklog = append(snapshot.ReplicationBacklog, raw)
	}
	payload, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal memory state snapshot: %w", err)
	}
	payload = append(payload, '\n')
	return writeAtomicFile(path, payload, 0o600)
}

func memoryStatePath(localStatePath string) string {
	if trimmed := strings.TrimSpace(localStatePath); trimmed != "" {
		return filepath.Join(filepath.Dir(trimmed), "memory-state.json")
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".nimi", "runtime", "memory-state.json")
}

func writeAtomicFile(path string, content []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create memory state directory: %w", err)
	}
	tmpFile, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp memory state file: %w", err)
	}
	tmpPath := tmpFile.Name()
	cleanup := func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}
	if err := tmpFile.Chmod(mode); err != nil {
		cleanup()
		return fmt.Errorf("chmod temp memory state file: %w", err)
	}
	if _, err := tmpFile.Write(content); err != nil {
		cleanup()
		return fmt.Errorf("write temp memory state file: %w", err)
	}
	if err := tmpFile.Sync(); err != nil {
		cleanup()
		return fmt.Errorf("sync temp memory state file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("close temp memory state file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp memory state file: %w", err)
	}
	return nil
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
