package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	replicationLoopInterval         = time.Second
	defaultReplicationBacklogBatch  = 32
	replicationAttemptUnavailable   = "bridge_unavailable"
	replicationAttemptNoObservation = "bridge_no_observation"
)

type replicationBacklogStatus string

const (
	replicationBacklogStatusPending replicationBacklogStatus = "pending"
	replicationBacklogStatusClaimed replicationBacklogStatus = "claimed"
)

type persistedReplicationBacklogItem struct {
	BacklogKey         string          `json:"backlogKey"`
	Locator            json.RawMessage `json:"locator"`
	MemoryID           string          `json:"memoryId"`
	LocalVersion       string          `json:"localVersion"`
	BasisVersion       string          `json:"basisVersion"`
	EnqueuedAt         string          `json:"enqueuedAt"`
	LastAttemptAt      string          `json:"lastAttemptAt,omitempty"`
	AttemptCount       int32           `json:"attemptCount"`
	Status             string          `json:"status"`
	LastAttemptOutcome string          `json:"lastAttemptOutcome,omitempty"`
}

type ReplicationBacklogItem struct {
	BacklogKey         string
	Locator            *runtimev1.MemoryBankLocator
	MemoryID           string
	LocalVersion       string
	BasisVersion       string
	EnqueuedAt         time.Time
	LastAttemptAt      time.Time
	AttemptCount       int32
	Status             replicationBacklogStatus
	LastAttemptOutcome string
}

type ReplicationBridgeAdapter interface {
	SyncPendingMemory(context.Context, *ReplicationBacklogItem) (*runtimev1.MemoryReplicationState, error)
}

type unavailableReplicationBridgeAdapter struct{}

func (unavailableReplicationBridgeAdapter) SyncPendingMemory(_ context.Context, _ *ReplicationBacklogItem) (*runtimev1.MemoryReplicationState, error) {
	return nil, status.Error(codes.Unavailable, "runtime internal realm-sync bridge unavailable or not admitted")
}

func canonicalReplicationBacklogEligible(bank *runtimev1.MemoryBank, record *runtimev1.MemoryRecord) bool {
	if bank == nil || record == nil || record.GetReplication() == nil {
		return false
	}
	return bank.GetCanonicalAgentScope() &&
		record.GetReplication().GetOutcome() == runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING
}

func replicationBacklogKey(locator *runtimev1.MemoryBankLocator, memoryID string) string {
	return locatorKey(locator) + "::" + strings.TrimSpace(memoryID)
}

func cloneReplicationBacklogItem(input *ReplicationBacklogItem) *ReplicationBacklogItem {
	if input == nil {
		return nil
	}
	return &ReplicationBacklogItem{
		BacklogKey:         input.BacklogKey,
		Locator:            cloneLocator(input.Locator),
		MemoryID:           input.MemoryID,
		LocalVersion:       input.LocalVersion,
		BasisVersion:       input.BasisVersion,
		EnqueuedAt:         input.EnqueuedAt,
		LastAttemptAt:      input.LastAttemptAt,
		AttemptCount:       input.AttemptCount,
		Status:             input.Status,
		LastAttemptOutcome: input.LastAttemptOutcome,
	}
}

func normalizeReplicationBacklogStatus(input replicationBacklogStatus) replicationBacklogStatus {
	switch input {
	case replicationBacklogStatusClaimed:
		return replicationBacklogStatusClaimed
	default:
		return replicationBacklogStatusPending
	}
}

func backlogTimeString(ts time.Time) string {
	if ts.IsZero() {
		return ""
	}
	return ts.UTC().Format(time.RFC3339Nano)
}

func parseBacklogTime(raw string) (time.Time, error) {
	if strings.TrimSpace(raw) == "" {
		return time.Time{}, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}, err
	}
	return parsed.UTC(), nil
}

func (s *Service) loadReplicationBacklogItem(raw persistedReplicationBacklogItem) (*ReplicationBacklogItem, error) {
	if strings.TrimSpace(raw.BacklogKey) == "" || strings.TrimSpace(raw.MemoryID) == "" {
		return nil, fmt.Errorf("replication backlog item requires backlogKey and memoryId")
	}
	var locator runtimev1.MemoryBankLocator
	if err := protojson.Unmarshal(raw.Locator, &locator); err != nil {
		return nil, fmt.Errorf("restore replication backlog locator %s: %w", raw.BacklogKey, err)
	}
	enqueuedAt, err := parseBacklogTime(raw.EnqueuedAt)
	if err != nil {
		return nil, fmt.Errorf("restore replication backlog enqueuedAt %s: %w", raw.BacklogKey, err)
	}
	lastAttemptAt, err := parseBacklogTime(raw.LastAttemptAt)
	if err != nil {
		return nil, fmt.Errorf("restore replication backlog lastAttemptAt %s: %w", raw.BacklogKey, err)
	}
	item := &ReplicationBacklogItem{
		BacklogKey:         strings.TrimSpace(raw.BacklogKey),
		Locator:            cloneLocator(&locator),
		MemoryID:           strings.TrimSpace(raw.MemoryID),
		LocalVersion:       strings.TrimSpace(raw.LocalVersion),
		BasisVersion:       strings.TrimSpace(raw.BasisVersion),
		EnqueuedAt:         enqueuedAt,
		LastAttemptAt:      lastAttemptAt,
		AttemptCount:       raw.AttemptCount,
		Status:             normalizeReplicationBacklogStatus(replicationBacklogStatus(strings.TrimSpace(raw.Status))),
		LastAttemptOutcome: strings.TrimSpace(raw.LastAttemptOutcome),
	}
	return item, nil
}

func marshalReplicationBacklogItem(item *ReplicationBacklogItem) (persistedReplicationBacklogItem, error) {
	if item == nil || item.Locator == nil {
		return persistedReplicationBacklogItem{}, fmt.Errorf("replication backlog item requires locator")
	}
	locatorRaw, err := protojson.Marshal(item.Locator)
	if err != nil {
		return persistedReplicationBacklogItem{}, err
	}
	return persistedReplicationBacklogItem{
		BacklogKey:         item.BacklogKey,
		Locator:            locatorRaw,
		MemoryID:           item.MemoryID,
		LocalVersion:       item.LocalVersion,
		BasisVersion:       item.BasisVersion,
		EnqueuedAt:         backlogTimeString(item.EnqueuedAt),
		LastAttemptAt:      backlogTimeString(item.LastAttemptAt),
		AttemptCount:       item.AttemptCount,
		Status:             string(normalizeReplicationBacklogStatus(item.Status)),
		LastAttemptOutcome: item.LastAttemptOutcome,
	}, nil
}

func (s *Service) enqueueReplicationBacklogLocked(bank *runtimev1.MemoryBank, record *runtimev1.MemoryRecord) {
	if !canonicalReplicationBacklogEligible(bank, record) {
		return
	}
	key := replicationBacklogKey(record.GetBank(), record.GetMemoryId())
	if existing := s.replicationBacklog[key]; existing != nil &&
		existing.LocalVersion == record.GetReplication().GetLocalVersion() &&
		existing.BasisVersion == record.GetReplication().GetBasisVersion() {
		return
	}
	enqueuedAt := time.Now().UTC()
	if pending := record.GetReplication().GetPending(); pending != nil && pending.GetEnqueuedAt() != nil {
		enqueuedAt = pending.GetEnqueuedAt().AsTime().UTC()
	}
	s.replicationBacklog[key] = &ReplicationBacklogItem{
		BacklogKey:         key,
		Locator:            cloneLocator(record.GetBank()),
		MemoryID:           record.GetMemoryId(),
		LocalVersion:       record.GetReplication().GetLocalVersion(),
		BasisVersion:       record.GetReplication().GetBasisVersion(),
		EnqueuedAt:         enqueuedAt,
		Status:             replicationBacklogStatusPending,
		LastAttemptOutcome: "",
	}
}

func (s *Service) removeReplicationBacklogForBankLocked(bankKey string) {
	for key, item := range s.replicationBacklog {
		if item == nil || locatorKey(item.Locator) != bankKey {
			continue
		}
		delete(s.replicationBacklog, key)
	}
}

func (s *Service) syncReplicationBacklogForBankLocked(bank *runtimev1.MemoryBank, records []*runtimev1.MemoryRecord) {
	if bank == nil {
		return
	}
	keep := make(map[string]struct{}, len(records))
	for _, record := range records {
		if !canonicalReplicationBacklogEligible(bank, record) {
			continue
		}
		key := replicationBacklogKey(record.GetBank(), record.GetMemoryId())
		keep[key] = struct{}{}
		s.enqueueReplicationBacklogLocked(bank, record)
	}
	bankKey := locatorKey(bank.GetLocator())
	for key, item := range s.replicationBacklog {
		if item == nil || locatorKey(item.Locator) != bankKey {
			continue
		}
		if _, ok := keep[key]; ok {
			continue
		}
		delete(s.replicationBacklog, key)
	}
}

func (s *Service) enqueueReplicationBacklogRecordsLocked(bank *runtimev1.MemoryBank, records []*runtimev1.MemoryRecord) {
	for _, record := range records {
		s.enqueueReplicationBacklogLocked(bank, record)
	}
}

func sortReplicationBacklogItems(items []*ReplicationBacklogItem) {
	sort.Slice(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		if !left.EnqueuedAt.Equal(right.EnqueuedAt) {
			return left.EnqueuedAt.Before(right.EnqueuedAt)
		}
		leftLocator := locatorKey(left.Locator)
		rightLocator := locatorKey(right.Locator)
		if leftLocator != rightLocator {
			return leftLocator < rightLocator
		}
		return left.MemoryID < right.MemoryID
	})
}

func (s *Service) ListReplicationBacklog() []*ReplicationBacklogItem {
	s.mu.RLock()
	items := make([]*ReplicationBacklogItem, 0, len(s.replicationBacklog))
	for _, item := range s.replicationBacklog {
		if item == nil {
			continue
		}
		items = append(items, cloneReplicationBacklogItem(item))
	}
	s.mu.RUnlock()
	sortReplicationBacklogItems(items)
	return items
}

func (s *Service) ClaimReplicationBacklogBatch(limit int, now time.Time) ([]*ReplicationBacklogItem, error) {
	if limit <= 0 {
		limit = defaultReplicationBacklogBatch
	}
	if now.IsZero() {
		now = time.Now().UTC()
	} else {
		now = now.UTC()
	}
	s.mu.Lock()
	items := make([]*ReplicationBacklogItem, 0, len(s.replicationBacklog))
	previous := make(map[string]*ReplicationBacklogItem)
	for _, item := range s.replicationBacklog {
		if item == nil {
			continue
		}
		items = append(items, item)
	}
	sortReplicationBacklogItems(items)
	if len(items) > limit {
		items = items[:limit]
	}
	if len(items) == 0 {
		s.mu.Unlock()
		return nil, nil
	}
	for _, item := range items {
		previous[item.BacklogKey] = cloneReplicationBacklogItem(item)
		item.Status = replicationBacklogStatusClaimed
		item.LastAttemptAt = now
		item.AttemptCount++
	}
	if err := s.persistLocked(); err != nil {
		for _, item := range items {
			s.replicationBacklog[item.BacklogKey] = previous[item.BacklogKey]
		}
		s.mu.Unlock()
		return nil, err
	}
	cloned := make([]*ReplicationBacklogItem, 0, len(items))
	for _, item := range items {
		cloned = append(cloned, cloneReplicationBacklogItem(item))
	}
	s.mu.Unlock()
	return cloned, nil
}

func (s *Service) requeueReplicationBacklogItem(item *ReplicationBacklogItem, outcome string, now time.Time) error {
	if item == nil {
		return nil
	}
	if now.IsZero() {
		now = time.Now().UTC()
	} else {
		now = now.UTC()
	}
	s.mu.Lock()
	current := s.replicationBacklog[item.BacklogKey]
	if current == nil {
		s.mu.Unlock()
		return nil
	}
	prev := cloneReplicationBacklogItem(current)
	current.Status = replicationBacklogStatusPending
	current.LastAttemptAt = now
	current.LastAttemptOutcome = strings.TrimSpace(outcome)
	if err := s.persistLocked(); err != nil {
		s.replicationBacklog[item.BacklogKey] = prev
		s.mu.Unlock()
		return err
	}
	s.mu.Unlock()
	return nil
}

func (s *Service) currentReplicationBridgeAdapter() ReplicationBridgeAdapter {
	s.replicationLoopMu.Lock()
	defer s.replicationLoopMu.Unlock()
	if s.replicationBridgeAdapter == nil {
		return unavailableReplicationBridgeAdapter{}
	}
	return s.replicationBridgeAdapter
}

func (s *Service) SetReplicationBridgeAdapter(adapter ReplicationBridgeAdapter) {
	s.replicationLoopMu.Lock()
	defer s.replicationLoopMu.Unlock()
	if adapter == nil {
		s.replicationBridgeAdapter = unavailableReplicationBridgeAdapter{}
		return
	}
	s.replicationBridgeAdapter = adapter
}

func (s *Service) StartReplicationLoop(parent context.Context) error {
	if parent == nil {
		parent = context.Background()
	}
	s.replicationLoopMu.Lock()
	defer s.replicationLoopMu.Unlock()
	if s.replicationLoopDone != nil {
		return nil
	}
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	s.replicationLoopCancel = cancel
	s.replicationLoopDone = done
	go s.runReplicationLoop(ctx, done)
	return nil
}

func (s *Service) StopReplicationLoop() {
	s.replicationLoopMu.Lock()
	cancel := s.replicationLoopCancel
	done := s.replicationLoopDone
	s.replicationLoopCancel = nil
	s.replicationLoopDone = nil
	s.replicationLoopMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

func (s *Service) runReplicationLoop(ctx context.Context, done chan struct{}) {
	defer close(done)
	if err := s.runReplicationSweep(ctx, time.Now().UTC()); err != nil && ctx.Err() == nil && s.logger != nil {
		s.logger.Warn("memory replication sweep failed", "error", err)
	}
	ticker := time.NewTicker(replicationLoopInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case tickAt := <-ticker.C:
			if err := s.runReplicationSweep(ctx, tickAt.UTC()); err != nil && ctx.Err() == nil && s.logger != nil {
				s.logger.Warn("memory replication sweep failed", "error", err)
			}
		}
	}
}

func (s *Service) runReplicationSweep(ctx context.Context, now time.Time) error {
	items, err := s.ClaimReplicationBacklogBatch(defaultReplicationBacklogBatch, now)
	if err != nil || len(items) == 0 {
		return err
	}
	adapter := s.currentReplicationBridgeAdapter()
	for _, item := range items {
		replication, bridgeErr := adapter.SyncPendingMemory(ctx, cloneReplicationBacklogItem(item))
		if bridgeErr != nil {
			if s.logger != nil {
				s.logger.Warn("memory replication bridge attempt failed", "memory_id", item.MemoryID, "error", bridgeErr)
			}
			if err := s.requeueReplicationBacklogItem(item, replicationAttemptUnavailable, now); err != nil {
				return err
			}
			continue
		}
		if replication == nil {
			if err := s.requeueReplicationBacklogItem(item, replicationAttemptNoObservation, now); err != nil {
				return err
			}
			continue
		}
		if err := s.ApplyReplicationObservation(item.Locator, item.MemoryID, replication, replicationObservedAt(replication, now)); err != nil {
			if s.logger != nil {
				s.logger.Warn("memory replication observation apply failed", "memory_id", item.MemoryID, "error", err)
			}
			if requeueErr := s.requeueReplicationBacklogItem(item, "observation_apply_failed", now); requeueErr != nil {
				return requeueErr
			}
		}
	}
	return nil
}

func replicationObservedAt(replication *runtimev1.MemoryReplicationState, fallback time.Time) time.Time {
	if fallback.IsZero() {
		fallback = time.Now().UTC()
	} else {
		fallback = fallback.UTC()
	}
	if replication == nil {
		return fallback
	}
	switch replication.GetOutcome() {
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED:
		if detail := replication.GetSynced(); detail != nil && detail.GetSyncedAt() != nil {
			return detail.GetSyncedAt().AsTime().UTC()
		}
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT:
		if detail := replication.GetConflict(); detail != nil && detail.GetDetectedAt() != nil {
			return detail.GetDetectedAt().AsTime().UTC()
		}
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED:
		if detail := replication.GetInvalidation(); detail != nil && detail.GetInvalidatedAt() != nil {
			return detail.GetInvalidatedAt().AsTime().UTC()
		}
	case runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING:
		if detail := replication.GetPending(); detail != nil && detail.GetEnqueuedAt() != nil {
			return detail.GetEnqueuedAt().AsTime().UTC()
		}
	}
	return fallback
}
