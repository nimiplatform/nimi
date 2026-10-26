package aitelemetry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: definition.nimi.runtime.rpc-foundations.home-ai-observation
// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-accounting
// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-coverage
type Store struct {
	mu                 sync.RWMutex
	backend            Backend
	logger             *slog.Logger
	now                func() time.Time
	generation         string
	startedAt          time.Time
	initialized        bool
	writeGap           bool
	closed             bool
	revision           uint64
	active             map[string]Record
	activeOverflow     bool
	sources            map[string]*runtimev1.DesktopAISourceCoverage
	subscribers        map[uint64]chan struct{}
	nextSubscriber     uint64
	activity           func(int32)
	writes             chan accountingWrite
	writerDone         chan struct{}
	progress           chan struct{}
	accepted           uint64
	completed          uint64
	writerError        error
	closeAt            time.Time
	recoveryIncomplete bool
}

func Open(backend Backend, logger *slog.Logger) *Store {
	return openWithClock(backend, logger, time.Now)
}

func openWithClock(backend Backend, logger *slog.Logger, clock func() time.Time) *Store {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Store{backend: backend, logger: logger, now: clock, generation: ulid.Make().String(), startedAt: clock().UTC(), active: make(map[string]Record), sources: make(map[string]*runtimev1.DesktopAISourceCoverage), subscribers: make(map[uint64]chan struct{}), writes: make(chan accountingWrite, MaxPendingWrites), writerDone: make(chan struct{}), progress: make(chan struct{})}
	for _, name := range sourceNames() {
		s.sources[name] = &runtimev1.DesktopAISourceCoverage{Source: name}
	}
	if err := s.initialize(s.startedAt); err != nil {
		s.noteWriteFailureLocked(err)
	}
	go s.runWriter()
	return s
}

func (s *Store) initialize(started time.Time) error {
	s.mu.RLock()
	initialized := s.initialized
	s.mu.RUnlock()
	if initialized {
		return nil
	}
	if s.backend == nil {
		return fmt.Errorf("AI accounting persistence is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var recovered []Record
	err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		for _, statement := range runtimepersistence.AIObservationStorageSchema() {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("initialize optional AI accounting schema: %w", err)
			}
		}
		rows, err := tx.QueryContext(ctx, `SELECT generation_id, started_ns FROM runtime_ai_accounting_generation WHERE ended_ns = 0`)
		if err != nil {
			return err
		}
		type unclean struct {
			id   string
			from int64
		}
		var previous []unclean
		for rows.Next() {
			var item unclean
			if err := rows.Scan(&item.id, &item.from); err != nil {
				_ = rows.Close()
				return err
			}
			previous = append(previous, item)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, item := range previous {
			if _, err := tx.ExecContext(ctx, `UPDATE runtime_ai_accounting_generation SET ended_ns = ?, clean = 0 WHERE generation_id = ?`, started.UnixNano(), item.id); err != nil {
				return err
			}
			if err := insertGapTx(ctx, tx, "all", item.from, started.UnixNano(), "unclean_generation"); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO runtime_ai_accounting_generation(generation_id, started_ns) VALUES (?, ?)`, s.generation, started.UnixNano()); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO runtime_ai_accounting_boundary(source, accept_from_ns, coverage_from_ns) VALUES ('all', 0, ?)`, started.UnixNano()); err != nil {
			return err
		}
		pending, err := tx.QueryContext(ctx, `SELECT record FROM runtime_ai_usage_attempt WHERE terminal_ns=0 ORDER BY started_ns DESC,attempt_id LIMIT ?`, MaxActive+1)
		if err != nil {
			return err
		}
		for pending.Next() {
			var encoded []byte
			if err := pending.Scan(&encoded); err != nil {
				_ = pending.Close()
				return err
			}
			record, err := decodeRecord(encoded)
			if err != nil {
				_ = pending.Close()
				return err
			}
			record.ObservationUnknown = true
			recovered = append(recovered, record)
		}
		if err := pending.Err(); err != nil {
			_ = pending.Close()
			return err
		}
		if err := pending.Close(); err != nil {
			return err
		}
		return s.enforceRetentionTx(ctx, tx, started)
	})
	if err != nil {
		return fmt.Errorf("initialize AI accounting generation: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startedAt = started
	s.initialized = true
	// Recovery reads may finish after new live facts were accepted while the
	// optional database was unavailable. Never overwrite those facts with an
	// older disk image; retained unconfirmed work keeps this view partial.
	if s.accepted > 0 && len(recovered) > 0 {
		s.recoveryIncomplete = true
		return nil
	}
	if len(recovered) > MaxActive {
		s.activeOverflow = true
		recovered = recovered[:MaxActive]
	}
	for _, record := range recovered {
		if _, exists := s.active[record.ID]; !exists {
			s.active[record.ID] = record
		}
	}
	return nil
}

func (s *Store) SetActivityObserver(observer func(int32)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activity = observer
}

func (s *Store) SetSourceCoverage(source string, activity, usage bool) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if value := s.sources[source]; value != nil {
		value.ActivityComplete = activity
		value.UsageComplete = usage
		s.changedLocked()
	}
}

func (s *Store) MarkGap(source string, from time.Time, reason string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if value := s.sources[source]; value != nil {
		value.ActivityComplete = false
	}
	if from.IsZero() {
		from = s.startedAt
	}
	_ = s.enqueueLocked(accountingWrite{at: s.now().UTC(), gap: &accountingGap{source: source, from: from, reason: reason}})
	s.changedLocked()
}

func (s *Store) noteWriteFailureLocked(err error) {
	s.writeGap = true
	s.writerError = err
}

// Record consumes cumulative facts from an execution owner. Errors affect
// accounting completeness, never the caller's execution outcome.
func (s *Store) Record(record Record) error {
	return s.record(record, false)
}

// Only Begin introduces a new live dispatch. Cumulative writes and retries
// may update an existing live record or remove it, but cannot revive work.
func (s *Store) record(record Record, liveStart bool) error {
	if s == nil {
		return nil
	}
	if record.ID == "" || strings.TrimSpace(record.AccountID) == "" || record.StartedAt.IsZero() || record.Revision == 0 {
		return fmt.Errorf("AI attempt requires admitted owner and immutable dispatch identity")
	}
	record.Facts = cloneFacts(record.Facts)
	record.Usage = cloneUsage(record.Usage)
	encoded, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encode AI attempt: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("AI accounting is closed")
	}
	if previous, ok := s.active[record.ID]; ok {
		if previous.Revision >= record.Revision {
			return nil
		}
		if !sameAttemptIdentity(previous, record) {
			return fmt.Errorf("AI attempt immutable identity changed")
		}
	}
	if len(encoded) > MaxAttemptBytes {
		s.activeOverflow = true
		err := fmt.Errorf("AI attempt exceeds safe projection size")
		s.noteWriteFailureLocked(err)
		s.changedLocked()
		return err
	}
	// Real terminal observation is independent of the durable retention floor.
	// Even a dropped/evicted accounting record must leave the live set now.
	s.observeRecordLocked(record, liveStart)
	return s.enqueueLocked(accountingWrite{at: s.now().UTC(), record: &record, encoded: encoded})
}

func (s *Store) observeRecordLocked(record Record, liveStart bool) {
	if record.TerminalAt.IsZero() {
		_, exists := s.active[record.ID]
		if !exists && !liveStart {
			return
		}
		if exists || len(s.active) < MaxActive {
			s.active[record.ID] = record
		} else {
			s.activeOverflow = true
		}
	} else {
		delete(s.active, record.ID)
	}
	s.changedLocked()
}

func sameAttemptIdentity(left, right Record) bool {
	if left.ConnectorRef != right.ConnectorRef {
		return false
	}
	if left.AccountID != right.AccountID || left.OperationID != right.OperationID || left.Source != right.Source || left.Price != right.Price || left.Capability != right.Capability || left.Route != right.Route || !left.StartedAt.Equal(right.StartedAt) || len(left.Models) != len(right.Models) {
		return false
	}
	for index := range left.Models {
		if !proto.Equal(left.Models[index], right.Models[index]) {
			return false
		}
	}
	return true
}

func (s *Store) changedLocked() {
	s.revision++
	for _, updates := range s.subscribers {
		select {
		case updates <- struct{}{}:
		default:
		}
	}
	if s.activity != nil {
		s.activity(int32(len(s.active)))
	}
}

// FinishOperation settles only outstanding dispatches of this exact owner
// operation. An aggregate Job usage cannot be assigned to several attempts.
func (s *Store) FinishOperation(operationID string, usage *runtimev1.UsageStats) {
	s.finishOperation(operationID, usage, runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNSPECIFIED, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED)
}

// ObserveOperationOutcome is used only for a directly observed remote task
// terminal. It assigns that observation only when the operation has one attempt.
func (s *Store) ObserveOperationOutcome(operationID string, usage *runtimev1.UsageStats, outcome runtimev1.DesktopAICloudAttemptOutcome, reason runtimev1.ReasonCode) {
	s.finishOperation(operationID, usage, outcome, reason)
}

func (s *Store) finishOperation(operationID string, usage *runtimev1.UsageStats, outcome runtimev1.DesktopAICloudAttemptOutcome, reason runtimev1.ReasonCode) {
	if s == nil || operationID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	at := s.now().UTC()
	for _, record := range s.active {
		if record.OperationID == operationID {
			record.Revision++
			record.TerminalAt = at
			record.ObservedAt = at
			s.observeRecordLocked(record, false)
		}
	}
	_ = s.enqueueLocked(accountingWrite{at: at, operationID: operationID, usage: cloneUsage(usage), outcome: outcome, reasonCode: reason})
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-execution
func (s *Store) Snapshot(accountID string, limit int) *runtimev1.DesktopAIActivitySnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	result := &runtimev1.DesktopAIActivitySnapshot{GenerationId: s.generation, Revision: s.revision, ObservedAt: timestamppb.New(s.now().UTC()), RecordsComplete: !s.activeOverflow, WorkCountKnown: !s.activeOverflow, SourceCoverage: s.sourceCoverageLocked()}
	if s.recoveryIncomplete {
		result.RecordsComplete = false
		result.WorkCountKnown = false
		result.PartialReasons = append(result.PartialReasons, "execution_recovery_unconfirmed")
	}
	for _, source := range result.SourceCoverage {
		if !source.ActivityComplete {
			result.PartialReasons = append(result.PartialReasons, "source_uncovered:"+source.Source)
			result.WorkCountKnown = false
		}
	}
	var records []Record
	for _, record := range s.active {
		if record.AccountID == accountID {
			records = append(records, record)
		}
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].StartedAt.Equal(records[j].StartedAt) {
			return records[i].ID < records[j].ID
		}
		return records[i].StartedAt.Before(records[j].StartedAt)
	})
	parents := make(map[string]struct{})
	for _, record := range records {
		if record.ObservationUnknown {
			result.RecordsComplete = false
			result.PartialReasons = append(result.PartialReasons, "execution_observation_unknown")
		} else {
			result.KnownActiveAttemptCount++
		}
		if record.Source.ParentID == "" || record.ObservationUnknown {
			result.WorkCountKnown = false
		} else {
			parents[record.Source.ParentKind+":"+record.Source.ParentID] = struct{}{}
		}
	}
	result.KnownWorkCount = int64(len(parents))
	truncated := len(records) > limit
	if truncated {
		records = records[:limit]
		result.RecordsComplete = false
	}
	if s.activeOverflow || truncated {
		result.PartialReasons = append(result.PartialReasons, "activity_capacity")
	}
	for _, record := range records {
		state := runtimev1.DesktopAIExecutionState_DESKTOP_AI_EXECUTION_STATE_RUNNING
		if record.ObservationUnknown {
			state = runtimev1.DesktopAIExecutionState_DESKTOP_AI_EXECUTION_STATE_OBSERVATION_UNKNOWN
		}
		result.Executions = append(result.Executions, &runtimev1.DesktopAIExecution{AttemptId: record.ID, ParentWorkId: record.Source.ParentID, ParentWorkKind: record.Source.ParentKind, SourceKind: record.Source.Kind, SourceId: record.Source.ID, SourceLabel: record.Source.Label, Capability: record.Capability, Models: cloneFacts(record.Facts).Models, Route: record.Route, State: state, StartedAt: timestamppb.New(record.StartedAt), ObservedAt: timestamppb.New(record.ObservedAt)})
	}
	return result
}

func (s *Store) sourceCoverageLocked() []*runtimev1.DesktopAISourceCoverage {
	result := make([]*runtimev1.DesktopAISourceCoverage, 0, len(s.sources))
	for _, name := range sourceNames() {
		value := s.sources[name]
		result = append(result, &runtimev1.DesktopAISourceCoverage{Source: name, ActivityComplete: value.ActivityComplete, UsageComplete: value.UsageComplete})
	}
	return result
}

func (s *Store) Subscribe() (<-chan struct{}, func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || len(s.subscribers) >= 128 {
		return nil, nil, fmt.Errorf("AI activity subscription capacity is unavailable")
	}
	s.nextSubscriber++
	id := s.nextSubscriber
	updates := make(chan struct{}, 1)
	s.subscribers[id] = updates
	updates <- struct{}{}
	var once sync.Once
	return updates, func() { once.Do(func() { s.mu.Lock(); delete(s.subscribers, id); s.mu.Unlock() }) }, nil
}

func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		s.closeAt = s.now().UTC()
		for id, channel := range s.subscribers {
			close(channel)
			delete(s.subscribers, id)
		}
		close(s.writes)
	}
	s.mu.Unlock()
	select {
	case <-s.writerDone:
		s.mu.RLock()
		defer s.mu.RUnlock()
		return s.writerError
	case <-time.After(5 * time.Second):
		s.mu.Lock()
		s.noteWriteFailureLocked(fmt.Errorf("AI accounting shutdown did not flush"))
		s.mu.Unlock()
		return fmt.Errorf("AI accounting shutdown did not flush")
	}
}

func decodeRecord(encoded []byte) (Record, error) {
	var record Record
	err := json.Unmarshal(encoded, &record)
	return record, err
}

func insertGapTx(ctx context.Context, tx *sql.Tx, source string, from, to int64, reason string) error {
	if to <= from {
		to = from + 1
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO runtime_ai_accounting_gap(source, from_ns, to_ns, reason) VALUES (?, ?, ?, ?)`, source, from, to, reason)
	return err
}

func noRows(err error) bool { return errors.Is(err, sql.ErrNoRows) }
