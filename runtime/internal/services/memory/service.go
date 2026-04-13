package memory

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	memoryStateSchemaVersion = 1
	defaultHistoryPageSize   = 50
	maxHistoryPageSize       = 200
	defaultBankPageSize      = 50
	maxBankPageSize          = 200
	subscriberBuffer         = 32
)

type persistedMemoryState struct {
	SchemaVersion      int                               `json:"schemaVersion"`
	SavedAt            string                            `json:"savedAt"`
	Sequence           uint64                            `json:"sequence"`
	Banks              []persistedBankState              `json:"banks"`
	ReplicationBacklog []persistedReplicationBacklogItem `json:"replicationBacklog,omitempty"`
}

type persistedBankState struct {
	LocatorKey string            `json:"locatorKey"`
	Bank       json.RawMessage   `json:"bank"`
	Records    []json.RawMessage `json:"records"`
}

type bankState struct {
	Bank    *runtimev1.MemoryBank
	Records map[string]*runtimev1.MemoryRecord
	Order   []string
}

type subscriber struct {
	id              uint64
	scopeFilters    map[runtimev1.MemoryBankScope]struct{}
	ownerFilterKeys map[string]struct{}
	ch              chan *runtimev1.MemoryEvent
}

type replicationObserver struct {
	id      uint64
	handler func(*runtimev1.MemoryEvent)
}

type Service struct {
	runtimev1.UnimplementedRuntimeMemoryServiceServer

	logger    *slog.Logger
	statePath string

	mu                      sync.RWMutex
	banks                   map[string]*bankState
	replicationBacklog      map[string]*ReplicationBacklogItem
	managedEmbeddingProfile *runtimev1.MemoryEmbeddingProfile
	sequence                uint64
	nextSubscriberID        uint64
	subscribers             map[uint64]*subscriber
	nextObserverID          uint64
	observers               map[uint64]func(*runtimev1.MemoryEvent)

	replicationLoopMu        sync.Mutex
	replicationBridgeAdapter ReplicationBridgeAdapter
	replicationLoopCancel    context.CancelFunc
	replicationLoopDone      chan struct{}
}

func New(logger *slog.Logger, cfg config.Config) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	svc := &Service{
		logger:                   logger,
		statePath:                memoryStatePath(cfg.LocalStatePath),
		banks:                    make(map[string]*bankState),
		replicationBacklog:       make(map[string]*ReplicationBacklogItem),
		subscribers:              make(map[uint64]*subscriber),
		observers:                make(map[uint64]func(*runtimev1.MemoryEvent)),
		replicationBridgeAdapter: unavailableReplicationBridgeAdapter{},
	}
	if err := svc.loadState(); err != nil {
		return nil, err
	}
	return svc, nil
}

func (s *Service) CreateBank(ctx context.Context, req *runtimev1.CreateBankRequest) (*runtimev1.CreateBankResponse, error) {
	locator, err := fullLocatorFromPublic(req.GetLocator())
	if err != nil {
		return nil, err
	}
	if err := validateCreateBankRequest(req, locator); err != nil {
		return nil, err
	}

	key := locatorKey(locator)
	s.mu.RLock()
	existing := s.banks[key]
	s.mu.RUnlock()
	if existing != nil {
		return &runtimev1.CreateBankResponse{Bank: cloneBank(existing.Bank)}, nil
	}

	now := time.Now().UTC()
	bankID := deriveBankID(locator)
	bank := &runtimev1.MemoryBank{
		BankId:              bankID,
		Locator:             cloneLocator(locator),
		EmbeddingProfile:    cloneEmbeddingProfile(req.GetEmbeddingProfile()),
		DisplayName:         firstNonEmpty(strings.TrimSpace(req.GetDisplayName()), defaultBankDisplayName(locator)),
		CanonicalAgentScope: false,
		PublicApiWritable:   true,
		Metadata:            cloneStruct(req.GetMetadata()),
		CreatedAt:           timestamppb.New(now),
		UpdatedAt:           timestamppb.New(now),
	}

	event := &runtimev1.MemoryEvent{
		EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_BANK_CREATED,
		Bank:      cloneLocator(locator),
		Timestamp: timestamppb.New(now),
		Detail: &runtimev1.MemoryEvent_BankCreated{
			BankCreated: cloneBank(bank),
		},
	}
	if err := s.insertBank(bank, event); err != nil {
		return nil, err
	}
	return &runtimev1.CreateBankResponse{Bank: cloneBank(bank)}, nil
}

func (s *Service) GetBank(_ context.Context, req *runtimev1.GetBankRequest) (*runtimev1.GetBankResponse, error) {
	if req.GetLocator() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	s.mu.RLock()
	state := s.banks[locatorKey(req.GetLocator())]
	s.mu.RUnlock()
	if state == nil {
		return nil, status.Error(codes.NotFound, "memory bank not found")
	}
	return &runtimev1.GetBankResponse{Bank: cloneBank(state.Bank)}, nil
}

func (s *Service) ListBanks(_ context.Context, req *runtimev1.ListBanksRequest) (*runtimev1.ListBanksResponse, error) {
	s.mu.RLock()
	items := make([]*runtimev1.MemoryBank, 0, len(s.banks))
	for _, state := range s.banks {
		if !matchesBankFilters(state.Bank, req.GetScopeFilters(), req.GetOwnerFilters()) {
			continue
		}
		items = append(items, cloneBank(state.Bank))
	}
	s.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool {
		if items[i].GetLocator().GetScope() == items[j].GetLocator().GetScope() {
			return items[i].GetBankId() < items[j].GetBankId()
		}
		return items[i].GetLocator().GetScope() < items[j].GetLocator().GetScope()
	})
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultBankPageSize, maxBankPageSize)
	start := offset
	if start > len(items) {
		start = len(items)
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	next := ""
	if end < len(items) {
		next = encodePageToken(end)
	}
	return &runtimev1.ListBanksResponse{
		Banks:         items[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) DeleteBank(ctx context.Context, req *runtimev1.DeleteBankRequest) (*runtimev1.DeleteBankResponse, error) {
	locator, err := fullLocatorFromPublic(req.GetLocator())
	if err != nil {
		return nil, err
	}
	key := locatorKey(locator)
	s.mu.RLock()
	state := s.banks[key]
	s.mu.RUnlock()
	if state == nil {
		return nil, status.Error(codes.NotFound, "memory bank not found")
	}
	now := time.Now().UTC()
	event := &runtimev1.MemoryEvent{
		EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_BANK_DELETED,
		Bank:      cloneLocator(locator),
		Timestamp: timestamppb.New(now),
		Detail: &runtimev1.MemoryEvent_BankDeleted{
			BankDeleted: cloneBank(state.Bank),
		},
	}
	if err := s.deleteBank(key, event); err != nil {
		return nil, err
	}
	return &runtimev1.DeleteBankResponse{Ack: okAck()}, nil
}

func (s *Service) Retain(ctx context.Context, req *runtimev1.RetainRequest) (*runtimev1.RetainResponse, error) {
	if len(req.GetRecords()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	bankState, err := s.bankForLocator(req.GetBank())
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	retained := make([]*runtimev1.MemoryRecord, 0, len(req.GetRecords()))
	for _, input := range req.GetRecords() {
		record := buildRuntimeRecord(bankState.Bank, input, now)
		retained = append(retained, record)
	}
	events := make([]*runtimev1.MemoryEvent, 0, len(retained))
	for _, record := range retained {
		events = append(events, &runtimev1.MemoryEvent{
			EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_RECORD_RETAINED,
			Bank:      cloneLocator(bankState.Bank.GetLocator()),
			Timestamp: timestamppb.New(now),
			Detail: &runtimev1.MemoryEvent_RecordRetained{
				RecordRetained: cloneRecord(record),
			},
		})
	}
	if err := s.insertRecords(locatorKey(bankState.Bank.GetLocator()), retained, events); err != nil {
		return nil, err
	}
	return &runtimev1.RetainResponse{Records: retained}, nil
}

func (s *Service) Recall(ctx context.Context, req *runtimev1.RecallRequest) (*runtimev1.RecallResponse, error) {
	if strings.TrimSpace(req.GetQuery().GetQuery()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	bankState, err := s.bankForLocator(req.GetBank())
	if err != nil {
		return nil, err
	}

	limit := int(req.GetQuery().GetLimit())
	records := s.historyRecords(bankState, &runtimev1.MemoryHistoryQuery{
		Kinds:              append([]runtimev1.MemoryRecordKind(nil), req.GetQuery().GetKinds()...),
		StartTime:          req.GetQuery().GetStartTime(),
		EndTime:            req.GetQuery().GetEndTime(),
		IncludeInvalidated: req.GetQuery().GetIncludeInvalidated(),
	})
	if limit <= 0 || limit > len(records) {
		limit = len(records)
	}
	type scoredHit struct {
		record *runtimev1.MemoryRecord
		score  float32
		reason string
	}
	scored := make([]scoredHit, 0, len(records))
	for _, record := range records {
		score, reason, ok := localRecallScore(record, req.GetQuery())
		if !ok {
			continue
		}
		scored = append(scored, scoredHit{record: record, score: score, reason: reason})
	}
	sort.Slice(scored, func(i, j int) bool {
		if scored[i].score == scored[j].score {
			leftUpdated := scored[i].record.GetUpdatedAt().AsTime()
			rightUpdated := scored[j].record.GetUpdatedAt().AsTime()
			if !leftUpdated.Equal(rightUpdated) {
				return leftUpdated.After(rightUpdated)
			}
			return scored[i].record.GetMemoryId() < scored[j].record.GetMemoryId()
		}
		return scored[i].score > scored[j].score
	})
	hits := make([]*runtimev1.MemoryRecallHit, 0, minInt(limit, len(scored)))
	for _, item := range scored {
		hits = append(hits, &runtimev1.MemoryRecallHit{
			Record:         cloneRecord(item.record),
			RelevanceScore: float64(item.score),
			MatchReason:    item.reason,
		})
		if len(hits) >= limit {
			break
		}
	}
	return &runtimev1.RecallResponse{Hits: hits}, nil
}

func (s *Service) History(_ context.Context, req *runtimev1.HistoryRequest) (*runtimev1.HistoryResponse, error) {
	bankState, err := s.bankForLocator(req.GetBank())
	if err != nil {
		return nil, err
	}
	records := s.historyRecords(bankState, req.GetQuery())
	offset, err := decodePageToken(req.GetQuery().GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetQuery().GetPageSize(), defaultHistoryPageSize, maxHistoryPageSize)
	start := offset
	if start > len(records) {
		start = len(records)
	}
	end := start + pageSize
	if end > len(records) {
		end = len(records)
	}
	next := ""
	if end < len(records) {
		next = encodePageToken(end)
	}
	return &runtimev1.HistoryResponse{
		Records:       records[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) Reflect(_ context.Context, _ *runtimev1.ReflectRequest) (*runtimev1.ReflectResponse, error) {
	return nil, memoryProviderUnavailableError()
}

func (s *Service) DeleteMemory(ctx context.Context, req *runtimev1.DeleteMemoryRequest) (*runtimev1.DeleteMemoryResponse, error) {
	if len(req.GetMemoryIds()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	bankState, err := s.bankForLocator(req.GetBank())
	if err != nil {
		return nil, err
	}
	remaining, deleted := partitionRecords(bankState, req.GetMemoryIds())
	if len(deleted) == 0 {
		return &runtimev1.DeleteMemoryResponse{Ack: okAck(), DeletedMemoryIds: []string{}}, nil
	}
	now := time.Now().UTC()
	event := &runtimev1.MemoryEvent{
		EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_RECORD_DELETED,
		Bank:      cloneLocator(bankState.Bank.GetLocator()),
		Timestamp: timestamppb.New(now),
		Detail: &runtimev1.MemoryEvent_RecordDeleted{
			RecordDeleted: &runtimev1.MemoryDeletedDetail{
				MemoryIds: append([]string(nil), req.GetMemoryIds()...),
				Reason:    strings.TrimSpace(req.GetReason()),
			},
		},
	}
	if err := s.replaceBankRecords(locatorKey(bankState.Bank.GetLocator()), remaining, event); err != nil {
		return nil, err
	}
	return &runtimev1.DeleteMemoryResponse{
		Ack:              okAck(),
		DeletedMemoryIds: append([]string(nil), req.GetMemoryIds()...),
	}, nil
}

func (s *Service) SubscribeMemoryEvents(req *runtimev1.SubscribeMemoryEventsRequest, stream runtimev1.RuntimeMemoryService_SubscribeMemoryEventsServer) error {
	sub := s.addSubscriber(req)
	defer s.removeSubscriber(sub.id)
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case event, ok := <-sub.ch:
			if !ok {
				return nil
			}
			if err := stream.Send(cloneEvent(event)); err != nil {
				return err
			}
		}
	}
}

func memoryProviderUnavailableError() error {
	return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
		Message:    "no runtime memory provider is installed in this build",
		ActionHint: "install_or_attach_memory_provider",
	})
}

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

func (s *Service) historyRecords(state *bankState, query *runtimev1.MemoryHistoryQuery) []*runtimev1.MemoryRecord {
	records := make([]*runtimev1.MemoryRecord, 0, len(state.Order))
	for _, recordID := range state.Order {
		record := state.Records[recordID]
		if record == nil {
			continue
		}
		if !matchesHistoryFilters(record, query) {
			continue
		}
		records = append(records, cloneRecord(record))
	}
	sort.Slice(records, func(i, j int) bool {
		left := recordTimestamp(records[i])
		right := recordTimestamp(records[j])
		if left.Equal(right) {
			return records[i].GetMemoryId() < records[j].GetMemoryId()
		}
		return left.After(right)
	})
	return records
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

func buildRuntimeRecord(bank *runtimev1.MemoryBank, input *runtimev1.MemoryRecordInput, now time.Time) *runtimev1.MemoryRecord {
	recordID := ulid.Make().String()
	replication := &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING,
		LocalVersion: recordID,
		BasisVersion: "",
		Detail: &runtimev1.MemoryReplicationState_Pending{
			Pending: &runtimev1.MemoryReplicationPending{
				BasisVersion: "",
				EnqueuedAt:   timestamppb.New(now),
			},
		},
	}
	record := &runtimev1.MemoryRecord{
		MemoryId:       recordID,
		Bank:           cloneLocator(bank.GetLocator()),
		Kind:           input.GetKind(),
		CanonicalClass: input.GetCanonicalClass(),
		Provenance:     cloneProvenance(input.GetProvenance()),
		Replication:    replication,
		Metadata:       cloneStruct(input.GetMetadata()),
		Extensions:     cloneStruct(input.GetExtensions()),
		CreatedAt:      timestamppb.New(now),
		UpdatedAt:      timestamppb.New(now),
	}
	switch payload := input.GetPayload().(type) {
	case *runtimev1.MemoryRecordInput_Episodic:
		record.Payload = &runtimev1.MemoryRecord_Episodic{Episodic: proto.Clone(payload.Episodic).(*runtimev1.EpisodicMemoryRecord)}
	case *runtimev1.MemoryRecordInput_Semantic:
		record.Payload = &runtimev1.MemoryRecord_Semantic{Semantic: proto.Clone(payload.Semantic).(*runtimev1.SemanticMemoryRecord)}
	case *runtimev1.MemoryRecordInput_Observational:
		record.Payload = &runtimev1.MemoryRecord_Observational{Observational: proto.Clone(payload.Observational).(*runtimev1.ObservationalMemoryRecord)}
	}
	return record
}

func recordContent(record *runtimev1.MemoryRecord) string {
	switch payload := record.GetPayload().(type) {
	case *runtimev1.MemoryRecord_Episodic:
		return strings.TrimSpace(payload.Episodic.GetSummary())
	case *runtimev1.MemoryRecord_Semantic:
		return strings.TrimSpace(strings.Join([]string{
			payload.Semantic.GetSubject(),
			payload.Semantic.GetPredicate(),
			payload.Semantic.GetObject(),
		}, " "))
	case *runtimev1.MemoryRecord_Observational:
		return strings.TrimSpace(payload.Observational.GetObservation())
	default:
		return ""
	}
}

func recordContext(record *runtimev1.MemoryRecord) string {
	switch payload := record.GetPayload().(type) {
	case *runtimev1.MemoryRecord_Episodic:
		return strings.Join(payload.Episodic.GetParticipants(), ",")
	case *runtimev1.MemoryRecord_Semantic:
		return "semantic"
	case *runtimev1.MemoryRecord_Observational:
		return strings.TrimSpace(payload.Observational.GetSourceRef())
	default:
		return ""
	}
}

func recordTimestamp(record *runtimev1.MemoryRecord) time.Time {
	switch payload := record.GetPayload().(type) {
	case *runtimev1.MemoryRecord_Episodic:
		if ts := payload.Episodic.GetOccurredAt(); ts != nil {
			return ts.AsTime()
		}
	case *runtimev1.MemoryRecord_Observational:
		if ts := payload.Observational.GetObservedAt(); ts != nil {
			return ts.AsTime()
		}
	}
	if ts := record.GetProvenance().GetCommittedAt(); ts != nil {
		return ts.AsTime()
	}
	if ts := record.GetCreatedAt(); ts != nil {
		return ts.AsTime()
	}
	return time.Time{}
}

func validateCreateBankRequest(req *runtimev1.CreateBankRequest, locator *runtimev1.MemoryBankLocator) error {
	if req.GetLocator() == nil || locator == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if req.GetEmbeddingProfile() == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if profile := req.GetEmbeddingProfile(); strings.TrimSpace(profile.GetProvider()) == "" || strings.TrimSpace(profile.GetModelId()) == "" || profile.GetDimension() <= 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if ctxApp := strings.TrimSpace(req.GetContext().GetAppId()); ctxApp != "" && locator.GetAppPrivate() != nil && ctxApp != strings.TrimSpace(locator.GetAppPrivate().GetAppId()) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func fullLocatorFromPublic(locator *runtimev1.PublicMemoryBankLocator) (*runtimev1.MemoryBankLocator, error) {
	if locator == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if app := locator.GetAppPrivate(); app != nil {
		if strings.TrimSpace(app.GetAccountId()) == "" || strings.TrimSpace(app.GetAppId()) == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE,
			Owner: &runtimev1.MemoryBankLocator_AppPrivate{AppPrivate: cloneAppPrivateOwner(app)},
		}, nil
	}
	if workspace := locator.GetWorkspacePrivate(); workspace != nil {
		if strings.TrimSpace(workspace.GetAccountId()) == "" || strings.TrimSpace(workspace.GetWorkspaceId()) == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE,
			Owner: &runtimev1.MemoryBankLocator_WorkspacePrivate{WorkspacePrivate: cloneWorkspacePrivateOwner(workspace)},
		}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
}

func locatorKey(locator *runtimev1.MemoryBankLocator) string {
	if locator == nil {
		return ""
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		if owner := locator.GetAgentCore(); owner != nil {
			return "agent-core::" + strings.TrimSpace(owner.GetAgentId())
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		if owner := locator.GetAgentDyadic(); owner != nil {
			return "agent-dyadic::" + strings.TrimSpace(owner.GetAgentId()) + "::" + strings.TrimSpace(owner.GetUserId())
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED:
		if owner := locator.GetWorldShared(); owner != nil {
			return "world-shared::" + strings.TrimSpace(owner.GetWorldId())
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE:
		if owner := locator.GetAppPrivate(); owner != nil {
			return "app-private::" + strings.TrimSpace(owner.GetAccountId()) + "::" + strings.TrimSpace(owner.GetAppId())
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE:
		if owner := locator.GetWorkspacePrivate(); owner != nil {
			return "workspace-private::" + strings.TrimSpace(owner.GetAccountId()) + "::" + strings.TrimSpace(owner.GetWorkspaceId())
		}
	}
	return ""
}

func ownerFilterKey(filter *runtimev1.MemoryBankOwnerFilter) string {
	if filter == nil {
		return ""
	}
	switch {
	case filter.GetAgentCore() != nil:
		return "agent-core::" + strings.TrimSpace(filter.GetAgentCore().GetAgentId())
	case filter.GetAgentDyadic() != nil:
		return "agent-dyadic::" + strings.TrimSpace(filter.GetAgentDyadic().GetAgentId()) + "::" + strings.TrimSpace(filter.GetAgentDyadic().GetUserId())
	case filter.GetWorldShared() != nil:
		return "world-shared::" + strings.TrimSpace(filter.GetWorldShared().GetWorldId())
	case filter.GetAppPrivate() != nil:
		return "app-private::" + strings.TrimSpace(filter.GetAppPrivate().GetAccountId()) + "::" + strings.TrimSpace(filter.GetAppPrivate().GetAppId())
	case filter.GetWorkspacePrivate() != nil:
		return "workspace-private::" + strings.TrimSpace(filter.GetWorkspacePrivate().GetAccountId()) + "::" + strings.TrimSpace(filter.GetWorkspacePrivate().GetWorkspaceId())
	default:
		return ""
	}
}

func matchesBankFilters(bank *runtimev1.MemoryBank, scopes []runtimev1.MemoryBankScope, owners []*runtimev1.MemoryBankOwnerFilter) bool {
	if bank == nil || bank.GetLocator() == nil {
		return false
	}
	if len(scopes) > 0 {
		match := false
		for _, scope := range scopes {
			if bank.GetLocator().GetScope() == scope {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	if len(owners) > 0 {
		key := locatorKey(bank.GetLocator())
		for _, owner := range owners {
			if key == ownerFilterKey(owner) {
				return true
			}
		}
		return false
	}
	return true
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

func deriveBankID(locator *runtimev1.MemoryBankLocator) string {
	sum := sha256.Sum256([]byte(locatorKey(locator)))
	prefix := strings.TrimPrefix(strings.ToLower(locator.GetScope().String()), "memory_bank_scope_")
	return "nimi-" + prefix + "-" + hex.EncodeToString(sum[:8])
}

func defaultBankDisplayName(locator *runtimev1.MemoryBankLocator) string {
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE:
		return "App Private Memory"
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE:
		return "Workspace Private Memory"
	default:
		return "Memory Bank"
	}
}

func matchesRecallLocalFilters(record *runtimev1.MemoryRecord, query *runtimev1.MemoryRecallQuery) bool {
	if record == nil {
		return false
	}
	if replicationOutcome(record) == runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED &&
		(query == nil || !query.GetIncludeInvalidated()) {
		return false
	}
	if query == nil {
		return true
	}
	if len(query.GetKinds()) > 0 {
		match := false
		for _, kind := range query.GetKinds() {
			if record.GetKind() == kind {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	if len(query.GetCanonicalClasses()) > 0 {
		match := false
		for _, class := range query.GetCanonicalClasses() {
			if record.GetCanonicalClass() == class {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	timestamp := recordTimestamp(record)
	if query.GetStartTime() != nil && !timestamp.IsZero() && timestamp.Before(query.GetStartTime().AsTime()) {
		return false
	}
	if query.GetEndTime() != nil && !timestamp.IsZero() && timestamp.After(query.GetEndTime().AsTime()) {
		return false
	}
	return true
}

func localRecallScore(record *runtimev1.MemoryRecord, query *runtimev1.MemoryRecallQuery) (float32, string, bool) {
	if !matchesRecallLocalFilters(record, query) {
		return 0, "", false
	}
	if query == nil {
		return 0, "", false
	}
	content := strings.ToLower(strings.TrimSpace(recordContent(record)))
	contextValue := strings.ToLower(strings.TrimSpace(recordContext(record)))
	corpus := strings.TrimSpace(content + " " + contextValue)
	rawQuery := strings.ToLower(strings.TrimSpace(query.GetQuery()))
	if corpus == "" || rawQuery == "" {
		return 0, "", false
	}
	score := float32(0)
	if strings.Contains(corpus, rawQuery) {
		score += 4
	}
	for _, token := range strings.Fields(rawQuery) {
		if len(token) < 2 {
			continue
		}
		if strings.Contains(content, token) {
			score += 2
			continue
		}
		if strings.Contains(contextValue, token) {
			score += 1
		}
	}
	if score == 0 {
		// Without a semantic provider, fall back to recency-ordered lexical history
		// so generic prompts like "what do you know?" still surface retained facts.
		score = 0.1
	}
	return score, firstNonEmpty(recordContent(record), recordContext(record)), true
}

func matchesHistoryFilters(record *runtimev1.MemoryRecord, query *runtimev1.MemoryHistoryQuery) bool {
	if record == nil {
		return false
	}
	if replicationOutcome(record) == runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED &&
		(query == nil || !query.GetIncludeInvalidated()) {
		return false
	}
	if query == nil {
		return true
	}
	if len(query.GetKinds()) > 0 {
		match := false
		for _, kind := range query.GetKinds() {
			if record.GetKind() == kind {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	timestamp := recordTimestamp(record)
	if query.GetStartTime() != nil && !timestamp.IsZero() && timestamp.Before(query.GetStartTime().AsTime()) {
		return false
	}
	if query.GetEndTime() != nil && !timestamp.IsZero() && timestamp.After(query.GetEndTime().AsTime()) {
		return false
	}
	return true
}

func partitionRecords(state *bankState, ids []string) ([]*runtimev1.MemoryRecord, []*runtimev1.MemoryRecord) {
	removeSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		removeSet[strings.TrimSpace(id)] = struct{}{}
	}
	remaining := make([]*runtimev1.MemoryRecord, 0, len(state.Order))
	deleted := make([]*runtimev1.MemoryRecord, 0, len(ids))
	for _, recordID := range state.Order {
		record := state.Records[recordID]
		if record == nil {
			continue
		}
		if _, ok := removeSet[recordID]; ok {
			deleted = append(deleted, cloneRecord(record))
			continue
		}
		remaining = append(remaining, cloneRecord(record))
	}
	return remaining, deleted
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

func okAck() *runtimev1.Ack {
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
}

func cloneBank(input *runtimev1.MemoryBank) *runtimev1.MemoryBank {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryBank)
}

func cloneRecord(input *runtimev1.MemoryRecord) *runtimev1.MemoryRecord {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryRecord)
}

func cloneReflectionResult(input *runtimev1.MemoryReflectionResult) *runtimev1.MemoryReflectionResult {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryReflectionResult)
}

func cloneEvent(input *runtimev1.MemoryEvent) *runtimev1.MemoryEvent {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryEvent)
}

func cloneLocator(input *runtimev1.MemoryBankLocator) *runtimev1.MemoryBankLocator {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryBankLocator)
}

func cloneEmbeddingProfile(input *runtimev1.MemoryEmbeddingProfile) *runtimev1.MemoryEmbeddingProfile {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryEmbeddingProfile)
}

func cloneProvenance(input *runtimev1.MemoryProvenance) *runtimev1.MemoryProvenance {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryProvenance)
}

func cloneStruct(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*structpb.Struct)
}

func cloneAppPrivateOwner(input *runtimev1.AppPrivateBankOwner) *runtimev1.AppPrivateBankOwner {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AppPrivateBankOwner)
}

func cloneWorkspacePrivateOwner(input *runtimev1.WorkspacePrivateBankOwner) *runtimev1.WorkspacePrivateBankOwner {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.WorkspacePrivateBankOwner)
}

func cloneBankState(input *bankState) *bankState {
	if input == nil {
		return nil
	}
	out := &bankState{
		Bank:    cloneBank(input.Bank),
		Records: make(map[string]*runtimev1.MemoryRecord, len(input.Records)),
		Order:   append([]string(nil), input.Order...),
	}
	for key, record := range input.Records {
		out.Records[key] = cloneRecord(record)
	}
	return out
}

func clampPageSize(raw int32, fallback int, max int) int {
	value := int(raw)
	if value <= 0 {
		return fallback
	}
	if value > max {
		return max
	}
	return value
}

func decodePageToken(raw string) (int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(trimmed)
	if err != nil || value < 0 {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return value, nil
}

func encodePageToken(offset int) string {
	if offset <= 0 {
		return ""
	}
	return strconv.Itoa(offset)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstStringFromStruct(input *structpb.Struct, field string) string {
	if input == nil {
		return ""
	}
	value := input.GetFields()[field]
	if value == nil {
		return ""
	}
	return strings.TrimSpace(value.GetStringValue())
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
