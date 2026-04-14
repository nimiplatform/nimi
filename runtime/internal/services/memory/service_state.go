package memory

import (
	"context"
	"crypto/sha256"
	"database/sql"
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

const (
	memoryMetaLegacyImportSourcePathKey          = "legacy_import_source_path"
	memoryMetaLegacyImportSourceSHA256Key        = "legacy_import_source_sha256"
	memoryMetaLegacyImportSourceSchemaVersionKey = "legacy_import_source_schema_version"
	memoryMetaLegacyImportedAtKey                = "legacy_imported_at"
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
	s.mu.Lock()
	previousSequence := s.sequence
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

func (s *Service) loadState() error {
	if s.backend == nil {
		return nil
	}
	initialized, err := s.memoryMetaValue("state_initialized")
	if err != nil {
		return err
	}
	if initialized != "1" {
		if err := s.importLegacyStateIfPresent(); err != nil {
			return err
		}
	}
	return s.loadStateFromDB()
}

func (s *Service) persistLocked() error {
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
	_ = payload
	return s.persistSnapshot(snapshot)
}

func (s *Service) importLegacyStateIfPresent() error {
	path := strings.TrimSpace(s.statePath)
	if path == "" {
		return s.markMemoryStateInitialized(0)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s.markMemoryStateInitialized(0)
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
	if err := s.persistSnapshot(snapshot); err != nil {
		return err
	}
	if err := s.validateImportedSnapshot(snapshot); err != nil {
		_ = s.resetImportedState()
		return err
	}
	if err := s.recordLegacyImportMetadata(path, raw, snapshot.SchemaVersion); err != nil {
		_ = s.resetImportedState()
		return err
	}
	return renameImportedLegacyState(path)
}

func (s *Service) loadStateFromDB() error {
	for key := range s.banks {
		delete(s.banks, key)
	}
	for key := range s.replicationBacklog {
		delete(s.replicationBacklog, key)
	}
	rows, err := s.backend.DB().Query(`
		SELECT locator_key, bank_json
		FROM memory_bank
		ORDER BY locator_key
	`)
	if err != nil {
		return fmt.Errorf("load memory banks: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var locatorKeyValue string
		var bankRaw string
		if err := rows.Scan(&locatorKeyValue, &bankRaw); err != nil {
			return fmt.Errorf("scan memory bank: %w", err)
		}
		var bank runtimev1.MemoryBank
		if err := protojson.Unmarshal([]byte(bankRaw), &bank); err != nil {
			return fmt.Errorf("unmarshal memory bank %s: %w", locatorKeyValue, err)
		}
		s.banks[locatorKeyValue] = &bankState{
			Bank:    cloneBank(&bank),
			Records: make(map[string]*runtimev1.MemoryRecord),
			Order:   []string{},
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	recordRows, err := s.backend.DB().Query(`
		SELECT locator_key, record_json
		FROM memory_record
		ORDER BY locator_key, created_at, memory_id
	`)
	if err != nil {
		return fmt.Errorf("load memory records: %w", err)
	}
	defer recordRows.Close()
	for recordRows.Next() {
		var locatorKeyValue string
		var recordRaw string
		if err := recordRows.Scan(&locatorKeyValue, &recordRaw); err != nil {
			return fmt.Errorf("scan memory record: %w", err)
		}
		state := s.banks[locatorKeyValue]
		if state == nil {
			continue
		}
		var record runtimev1.MemoryRecord
		if err := protojson.Unmarshal([]byte(recordRaw), &record); err != nil {
			return fmt.Errorf("unmarshal memory record for bank %s: %w", locatorKeyValue, err)
		}
		cloned := cloneRecord(&record)
		state.Records[cloned.GetMemoryId()] = cloned
		state.Order = append(state.Order, cloned.GetMemoryId())
	}
	if err := recordRows.Err(); err != nil {
		return err
	}
	backlogRows, err := s.backend.DB().Query(`
		SELECT item_json
		FROM memory_replication_backlog
		ORDER BY enqueued_at, backlog_key
	`)
	if err != nil {
		return fmt.Errorf("load replication backlog: %w", err)
	}
	defer backlogRows.Close()
	for backlogRows.Next() {
		var raw string
		if err := backlogRows.Scan(&raw); err != nil {
			return fmt.Errorf("scan replication backlog: %w", err)
		}
		var persisted persistedReplicationBacklogItem
		if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
			return fmt.Errorf("unmarshal replication backlog: %w", err)
		}
		item, err := s.loadReplicationBacklogItem(persisted)
		if err != nil {
			return err
		}
		s.replicationBacklog[item.BacklogKey] = item
	}
	if err := backlogRows.Err(); err != nil {
		return err
	}
	seq, err := s.memoryMetaValue("memory_event_sequence")
	if err != nil {
		return err
	}
	if strings.TrimSpace(seq) != "" {
		value, err := decodeSequenceValue(seq)
		if err != nil {
			return err
		}
		s.sequence = value
	}
	return nil
}

func (s *Service) persistSnapshot(snapshot persistedMemoryState) error {
	if s.backend == nil {
		return nil
	}
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM memory_record_fts`); err != nil {
			return fmt.Errorf("clear memory_record_fts: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM memory_record`); err != nil {
			return fmt.Errorf("clear memory_record: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM memory_bank`); err != nil {
			return fmt.Errorf("clear memory_bank: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM memory_replication_backlog`); err != nil {
			return fmt.Errorf("clear memory_replication_backlog: %w", err)
		}
		liveRecordIDs := make(map[string]struct{})
		for _, item := range snapshot.Banks {
			var bank runtimev1.MemoryBank
			if err := protojson.Unmarshal(item.Bank, &bank); err != nil {
				return fmt.Errorf("persist memory bank %s: %w", item.LocatorKey, err)
			}
			if _, err := tx.Exec(`
				INSERT INTO memory_bank(locator_key, scope, bank_id, updated_at, canonical_agent_scope, public_api_writable, embedding_bound, bank_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`, item.LocatorKey, int(bank.GetLocator().GetScope()), bank.GetBankId(), timestampString(bank.GetUpdatedAt()), boolToInt(bank.GetCanonicalAgentScope()), boolToInt(bank.GetPublicApiWritable()), boolToInt(bank.GetEmbeddingProfile() != nil), string(item.Bank)); err != nil {
				return fmt.Errorf("insert memory bank %s: %w", item.LocatorKey, err)
			}
			for _, recordRaw := range item.Records {
				var record runtimev1.MemoryRecord
				if err := protojson.Unmarshal(recordRaw, &record); err != nil {
					return fmt.Errorf("persist memory record in %s: %w", item.LocatorKey, err)
				}
				liveRecordIDs[record.GetMemoryId()] = struct{}{}
				searchText, searchTokens := buildSearchDocument(&record)
				if _, err := tx.Exec(`
					INSERT INTO memory_record(memory_id, locator_key, kind, canonical_class, created_at, updated_at, replication_outcome, search_text, search_tokens, record_json)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`, record.GetMemoryId(), item.LocatorKey, int(record.GetKind()), int(record.GetCanonicalClass()), timestampString(record.GetCreatedAt()), timestampString(record.GetUpdatedAt()), int(replicationOutcome(&record)), searchText, searchTokens, string(recordRaw)); err != nil {
					return fmt.Errorf("insert memory record %s: %w", record.GetMemoryId(), err)
				}
				if _, err := tx.Exec(`
					INSERT INTO memory_record_fts(memory_id, locator_key, content, tokens)
					VALUES (?, ?, ?, ?)
				`, record.GetMemoryId(), item.LocatorKey, searchText, searchTokens); err != nil {
					return fmt.Errorf("insert memory_record_fts %s: %w", record.GetMemoryId(), err)
				}
				if bank.GetEmbeddingProfile() != nil && embeddingProfilesMatch(s.managedEmbeddingProfile, bank.GetEmbeddingProfile()) {
					vector := computeEmbeddingVectorForRecord(&record, bank.GetEmbeddingProfile().GetDimension())
					if _, err := tx.Exec(`
						INSERT OR REPLACE INTO memory_record_embedding(memory_id, locator_key, dimension, vector_json, updated_at)
						VALUES (?, ?, ?, ?, ?)
					`, record.GetMemoryId(), item.LocatorKey, int(bank.GetEmbeddingProfile().GetDimension()), marshalFloatVector(vector), time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
						return fmt.Errorf("upsert memory_record_embedding %s: %w", record.GetMemoryId(), err)
					}
				}
			}
		}
		for _, backlog := range snapshot.ReplicationBacklog {
			raw, err := json.Marshal(backlog)
			if err != nil {
				return fmt.Errorf("marshal backlog item %s: %w", backlog.BacklogKey, err)
			}
			if _, err := tx.Exec(`
				INSERT INTO memory_replication_backlog(backlog_key, locator_key, memory_id, enqueued_at, item_json)
				VALUES (?, ?, ?, ?, ?)
			`, backlog.BacklogKey, locatorKeyFromPersistedBacklog(backlog), backlog.MemoryID, backlog.EnqueuedAt, string(raw)); err != nil {
				return fmt.Errorf("insert backlog item %s: %w", backlog.BacklogKey, err)
			}
		}
		if err := deleteMissingEmbeddings(tx, liveRecordIDs); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO memory_meta(key, value) VALUES ('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO memory_meta(key, value) VALUES ('memory_event_sequence', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, encodeSequenceValue(snapshot.Sequence)); err != nil {
			return err
		}
		return nil
	})
}

func (s *Service) memoryMetaValue(key string) (string, error) {
	if s.backend == nil {
		return "", nil
	}
	var value string
	err := s.backend.DB().QueryRow(`SELECT value FROM memory_meta WHERE key = ?`, key).Scan(&value)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("load memory_meta[%s]: %w", key, err)
	}
	return value, nil
}

func (s *Service) markMemoryStateInitialized(sequence uint64) error {
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO memory_meta(key, value) VALUES ('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO memory_meta(key, value) VALUES ('memory_event_sequence', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, encodeSequenceValue(sequence)); err != nil {
			return err
		}
		return nil
	})
}

func (s *Service) validateImportedSnapshot(snapshot persistedMemoryState) error {
	if s.backend == nil {
		return nil
	}
	expectedBankCount := len(snapshot.Banks)
	expectedRecordCount := 0
	for _, bank := range snapshot.Banks {
		expectedRecordCount += len(bank.Records)
	}
	expectedBacklogCount := len(snapshot.ReplicationBacklog)
	var actualBankCount int
	if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM memory_bank`).Scan(&actualBankCount); err != nil {
		return fmt.Errorf("validate imported memory banks: %w", err)
	}
	if actualBankCount != expectedBankCount {
		return fmt.Errorf("validate imported memory banks: got %d want %d", actualBankCount, expectedBankCount)
	}
	var actualRecordCount int
	if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM memory_record`).Scan(&actualRecordCount); err != nil {
		return fmt.Errorf("validate imported memory records: %w", err)
	}
	if actualRecordCount != expectedRecordCount {
		return fmt.Errorf("validate imported memory records: got %d want %d", actualRecordCount, expectedRecordCount)
	}
	var actualBacklogCount int
	if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM memory_replication_backlog`).Scan(&actualBacklogCount); err != nil {
		return fmt.Errorf("validate imported memory backlog: %w", err)
	}
	if actualBacklogCount != expectedBacklogCount {
		return fmt.Errorf("validate imported memory backlog: got %d want %d", actualBacklogCount, expectedBacklogCount)
	}
	seq, err := s.memoryMetaValue("memory_event_sequence")
	if err != nil {
		return err
	}
	value, err := decodeSequenceValue(seq)
	if err != nil {
		return err
	}
	if value != snapshot.Sequence {
		return fmt.Errorf("validate imported memory sequence: got %d want %d", value, snapshot.Sequence)
	}
	return nil
}

func (s *Service) recordLegacyImportMetadata(path string, raw []byte, schemaVersion int) error {
	importedAt := time.Now().UTC().Format(time.RFC3339Nano)
	digest := sha256.Sum256(raw)
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		values := map[string]string{
			memoryMetaLegacyImportSourcePathKey:          strings.TrimSpace(path),
			memoryMetaLegacyImportSourceSHA256Key:        fmt.Sprintf("%x", digest[:]),
			memoryMetaLegacyImportSourceSchemaVersionKey: fmt.Sprintf("%d", schemaVersion),
			memoryMetaLegacyImportedAtKey:                importedAt,
		}
		for key, value := range values {
			if _, err := tx.Exec(`INSERT INTO memory_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) resetImportedState() error {
	if s.backend == nil {
		return nil
	}
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		statements := []string{
			`DELETE FROM memory_record_fts`,
			`DELETE FROM memory_record_embedding`,
			`DELETE FROM memory_narrative_embedding`,
			`DELETE FROM memory_narrative_alias`,
			`DELETE FROM memory_recall_feedback_event`,
			`DELETE FROM memory_recall_feedback_summary`,
			`DELETE FROM memory_replication_backlog`,
			`DELETE FROM memory_record`,
			`DELETE FROM memory_bank`,
			`DELETE FROM memory_narrative`,
			`DELETE FROM narrative_source`,
			`DELETE FROM memory_relation`,
			`DELETE FROM agent_truth`,
			`DELETE FROM truth_source`,
			`DELETE FROM memory_review_commit`,
			`DELETE FROM memory_review_checkpoint`,
			`DELETE FROM memory_meta WHERE key IN ('state_initialized', 'memory_event_sequence', ?, ?, ?, ?)`,
		}
		for idx, stmt := range statements {
			if idx == len(statements)-1 {
				if _, err := tx.Exec(stmt,
					memoryMetaLegacyImportSourcePathKey,
					memoryMetaLegacyImportSourceSHA256Key,
					memoryMetaLegacyImportSourceSchemaVersionKey,
					memoryMetaLegacyImportedAtKey,
				); err != nil {
					return err
				}
				continue
			}
			if _, err := tx.Exec(stmt); err != nil {
				return err
			}
		}
		return nil
	})
}

func renameImportedLegacyState(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	backupPath := path + ".wave3-imported.json.bak"
	if err := os.Rename(path, backupPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("rename legacy imported state: %w", err)
	}
	return nil
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
