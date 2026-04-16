package cognition

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
)

// Save persists a memory record.
func (s *MemoryService) Save(rec memory.Record) error {
	if err := memory.ValidateRecord(rec); err != nil {
		return fmt.Errorf("memory save: %w", err)
	}
	if err := ensureRefsExist(s.store, rec.ScopeID, rec.ArtifactRefs); err != nil {
		return fmt.Errorf("memory save: %w", err)
	}
	raw, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("memory save: marshal: %w", err)
	}
	return s.store.Save(rec.ScopeID, storage.KindMemory, string(rec.RecordID), raw)
}

// Load loads a memory record.
func (s *MemoryService) Load(scopeID string, recordID memory.RecordID) (*memory.Record, error) {
	rec, err := s.loadOptional(scopeID, recordID)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		return nil, fmt.Errorf("memory load: record %s does not exist in scope %s", recordID, scopeID)
	}
	return rec, nil
}

// LoadView loads a memory record plus live support metadata.
func (s *MemoryService) LoadView(scopeID string, recordID memory.RecordID) (*memory.View, error) {
	rec, err := s.Load(scopeID, recordID)
	if err != nil || rec == nil {
		return nil, err
	}
	view, err := s.viewForRecord(*rec)
	if err != nil {
		return nil, err
	}
	return &view, nil
}

// List returns all memory records for a scope.
func (s *MemoryService) List(scopeID string) ([]memory.Record, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	records, err := s.store.LoadMemoryRecords(scopeID)
	if err != nil {
		return nil, err
	}
	return validateVisibleMemoryRecords(records)
}

// ListViews returns all memory views for a scope.
func (s *MemoryService) ListViews(scopeID string) ([]memory.View, error) {
	records, err := s.List(scopeID)
	if err != nil {
		return nil, err
	}
	return s.viewsForRecords(records)
}

// SearchLexical performs lexical retrieval over raw memory records.
func (s *MemoryService) SearchLexical(scopeID string, query string, limit int) ([]memory.Record, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateQueryRequired("memory search", query); err != nil {
		return nil, err
	}
	records, err := s.store.SearchMemory(scopeID, query, limit)
	if err != nil {
		return nil, err
	}
	return validateVisibleMemoryRecords(records)
}

// SearchViews performs lexical retrieval and decorates results with live support-derived serving metadata.
func (s *MemoryService) SearchViews(scopeID string, query string, limit int) ([]memory.View, error) {
	records, err := s.SearchLexical(scopeID, query, limit)
	if err != nil {
		return nil, err
	}
	views, err := s.viewsForRecords(records)
	if err != nil {
		return nil, err
	}
	sortMemoryViews(views)
	return views, nil
}

// Delete removes a memory record and preserves explicit local lifecycle history.
func (s *MemoryService) Delete(scopeID string, recordID memory.RecordID) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	if strings.TrimSpace(string(recordID)) == "" {
		return errors.New("memory delete: record_id is required")
	}
	if rec, err := s.loadOptional(scopeID, recordID); err != nil {
		return err
	} else if rec == nil {
		return fmt.Errorf("memory delete: record %s does not exist in scope %s", recordID, scopeID)
	}
	blockers, err := s.refgraph.RemoveBlockers(scopeID, artifactref.KindMemoryRecord, string(recordID))
	if err != nil {
		return err
	}
	blocking := blockingDeleteBlockers(blockers)
	if len(blocking) > 0 {
		return fmt.Errorf("memory delete: record %s is blocked by %s", recordID, formatDeleteBlockers(blocking))
	}
	return s.store.Delete(scopeID, storage.KindMemory, string(recordID))
}

// History returns explicit local lifecycle history for one record.
func (s *MemoryService) History(scopeID string, recordID memory.RecordID) ([]memory.HistoryEntry, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(recordID)) == "" {
		return nil, errors.New("memory history: record_id is required")
	}
	history, err := s.store.LoadMemoryHistory(scopeID, string(recordID))
	if err != nil {
		return nil, err
	}
	if len(history) == 0 {
		rec, err := s.loadOptional(scopeID, recordID)
		if err != nil {
			return nil, err
		}
		if rec == nil {
			return nil, fmt.Errorf("memory history: record %s does not exist in scope %s", recordID, scopeID)
		}
	}
	return history, nil
}

// ListIDs lists memory record IDs.
func (s *MemoryService) ListIDs(scopeID string) ([]string, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	records, err := s.List(scopeID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(records))
	for _, rec := range records {
		ids = append(ids, string(rec.RecordID))
	}
	return ids, nil
}

func (s *MemoryService) viewsForRecords(records []memory.Record) ([]memory.View, error) {
	views := make([]memory.View, 0, len(records))
	for _, rec := range records {
		view, err := s.viewForRecord(rec)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *MemoryService) viewForRecord(rec memory.Record) (memory.View, error) {
	summary, err := s.refgraph.SupportSummary(rec.ScopeID, artifactref.KindMemoryRecord, string(rec.RecordID))
	if err != nil {
		return memory.View{}, err
	}
	lineage, err := s.refgraph.LiveIncomingRefs(rec.ScopeID, artifactref.KindMemoryRecord, string(rec.RecordID))
	if err != nil {
		return memory.View{}, err
	}
	invalidation, err := s.refgraph.InvalidationReasons(rec.ScopeID, rec.ArtifactRefs)
	if err != nil {
		return memory.View{}, err
	}
	sortArtifactRefs(lineage)
	sortStrings(invalidation)
	return memory.View{
		Record:              rec,
		Support:             summary,
		Lineage:             lineage,
		InvalidationReasons: invalidation,
		CleanupSignals:      cleanupSignals(rec, summary, invalidation),
	}, nil
}

func cleanupSignals(rec memory.Record, summary memory.SupportSummary, invalidation []string) []string {
	var signals []string
	if summary.Score == 0 {
		signals = append(signals, "no_support")
	}
	if summary.Strong == 0 && summary.Weak > 0 {
		signals = append(signals, "weak_only_support")
	}
	if len(invalidation) > 0 {
		signals = append(signals, "invalidated_dependencies")
	}
	if rec.Lifecycle == memory.RecordLifecycleArchived {
		signals = append(signals, "archived")
	}
	if rec.Lifecycle == memory.RecordLifecycleRemoved {
		signals = append(signals, "removed")
	}
	return signals
}

func (s *MemoryService) loadOptional(scopeID string, recordID memory.RecordID) (*memory.Record, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(recordID)) == "" {
		return nil, errors.New("memory load: record_id is required")
	}
	raw, err := s.store.Load(scopeID, storage.KindMemory, string(recordID))
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, nil
	}
	var rec memory.Record
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, fmt.Errorf("memory load: %w", err)
	}
	if err := memory.ValidateRecord(rec); err != nil {
		return nil, fmt.Errorf("memory load: %w", err)
	}
	return &rec, nil
}

func (s *MemoryService) archive(scopeID string, recordID memory.RecordID, now time.Time) error {
	record, err := s.Load(scopeID, recordID)
	if err != nil {
		return err
	}
	if record.Lifecycle != memory.RecordLifecycleActive {
		return fmt.Errorf("memory archive: record %s cannot transition from %s", recordID, record.Lifecycle)
	}
	record.Lifecycle = memory.RecordLifecycleArchived
	record.UpdatedAt = now
	return s.persistRecord(*record)
}

func (s *MemoryService) remove(scopeID string, recordID memory.RecordID, now time.Time) error {
	record, err := s.Load(scopeID, recordID)
	if err != nil {
		return err
	}
	if record.Lifecycle != memory.RecordLifecycleArchived {
		return fmt.Errorf("memory remove: record %s must be archived before remove", recordID)
	}
	blockers, err := s.refgraph.RemoveBlockers(scopeID, artifactref.KindMemoryRecord, string(recordID))
	if err != nil {
		return err
	}
	blocking := blockingDeleteBlockers(blockers)
	if len(blocking) > 0 {
		return fmt.Errorf("memory remove: record %s is blocked by %s", recordID, formatDeleteBlockers(blocking))
	}
	record.Lifecycle = memory.RecordLifecycleRemoved
	record.UpdatedAt = now
	return s.persistRecord(*record)
}

func (s *MemoryService) persistRecord(record memory.Record) error {
	if err := memory.ValidateRecord(record); err != nil {
		return fmt.Errorf("memory persist: %w", err)
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("memory persist: %w", err)
	}
	return s.store.Save(record.ScopeID, storage.KindMemory, string(record.RecordID), raw)
}
