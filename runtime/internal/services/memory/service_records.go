package memory

import (
	"context"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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

func memoryProviderUnavailableError() error {
	return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
		Message:    "no runtime memory provider is installed in this build",
		ActionHint: "install_or_attach_memory_provider",
	})
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
