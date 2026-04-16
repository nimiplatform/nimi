package cognition

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	cognitionmemory "github.com/nimiplatform/nimi/nimi-cognition/memory"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) Retain(ctx context.Context, req *runtimev1.RetainRequest) (*runtimev1.RetainResponse, error) {
	if err := validatePublicRuntimeMemoryLocator(req.GetBank()); err != nil {
		return nil, err
	}
	if len(req.GetRecords()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	bankResp, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{
		Context: req.GetContext(),
		Locator: req.GetBank(),
	})
	if err != nil {
		return nil, err
	}
	if err := s.memorySvc.EnsurePublicBankEmbeddingAvailability(bankResp.GetBank()); err != nil {
		return nil, err
	}
	scopeID := memoryScopeID(bankResp.GetBank().GetBankId())
	now := time.Now().UTC()
	records := make([]*runtimev1.MemoryRecord, 0, len(req.GetRecords()))
	for _, input := range req.GetRecords() {
		record, cognitionRecord, err := runtimeRecordToCognition(bankResp.GetBank(), input, now)
		if err != nil {
			return nil, err
		}
		cognitionRecord.ScopeID = scopeID
		if err := s.cognitionCore.MemoryService().Save(cognitionRecord); err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		records = append(records, record)
	}
	if len(records) > 0 {
		for _, record := range records {
			s.publishMemoryEvent(&runtimev1.MemoryEvent{
				EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_RECORD_RETAINED,
				Bank:      cloneMemoryLocator(record.GetBank()),
				Timestamp: timestamppb.Now(),
				Detail: &runtimev1.MemoryEvent_RecordRetained{
					RecordRetained: cloneMemoryRecord(record),
				},
			})
		}
	}
	return &runtimev1.RetainResponse{Records: records}, nil
}

func (s *Service) Recall(ctx context.Context, req *runtimev1.RecallRequest) (*runtimev1.RecallResponse, error) {
	if err := validatePublicRuntimeMemoryLocator(req.GetBank()); err != nil {
		return nil, err
	}
	if req.GetQuery() == nil || strings.TrimSpace(req.GetQuery().GetQuery()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	bankResp, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{
		Context: req.GetContext(),
		Locator: req.GetBank(),
	})
	if err != nil {
		return nil, err
	}
	if err := s.memorySvc.EnsurePublicBankEmbeddingAvailability(bankResp.GetBank()); err != nil {
		return nil, err
	}
	scopeID := memoryScopeID(bankResp.GetBank().GetBankId())
	views, err := s.cognitionCore.MemoryService().SearchViews(scopeID, req.GetQuery().GetQuery(), int(req.GetQuery().GetLimit()))
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	hits := make([]*runtimev1.MemoryRecallHit, 0, len(views))
	for _, view := range views {
		record, err := cognitionRecordToRuntime(bankResp.GetBank().GetLocator(), view.Record)
		if err != nil {
			return nil, err
		}
		if !matchesRecallQuery(record, req.GetQuery()) {
			continue
		}
		hits = append(hits, &runtimev1.MemoryRecallHit{
			Record:         record,
			RelevanceScore: view.Support.Score,
			MatchReason:    "runtime_cognition_lexical",
		})
	}
	limit := int(req.GetQuery().GetLimit())
	if limit > 0 && len(hits) > limit {
		hits = hits[:limit]
	}
	return &runtimev1.RecallResponse{
		Hits:          hits,
		NarrativeHits: []*runtimev1.NarrativeRecallHit{},
	}, nil
}

func (s *Service) History(ctx context.Context, req *runtimev1.HistoryRequest) (*runtimev1.HistoryResponse, error) {
	if err := validatePublicRuntimeMemoryLocator(req.GetBank()); err != nil {
		return nil, err
	}
	bankResp, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{
		Context: req.GetContext(),
		Locator: req.GetBank(),
	})
	if err != nil {
		return nil, err
	}
	scopeID := memoryScopeID(bankResp.GetBank().GetBankId())
	items, err := s.cognitionCore.MemoryService().List(scopeID)
	if err != nil {
		return nil, err
	}
	records := make([]*runtimev1.MemoryRecord, 0, len(items))
	for _, item := range items {
		record, err := cognitionRecordToRuntime(bankResp.GetBank().GetLocator(), item)
		if err != nil {
			return nil, err
		}
		if !matchesHistoryQuery(record, req.GetQuery()) {
			continue
		}
		records = append(records, record)
	}
	sortMemoryRecords(records)
	offset, err := decodePageToken(req.GetQuery().GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetQuery().GetPageSize(), defaultMemoryHistoryPageSize, maxMemoryHistoryPageSize)
	start, end, next := pageWindow(len(records), offset, pageSize)
	return &runtimev1.HistoryResponse{
		Records:       records[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) DeleteMemory(ctx context.Context, req *runtimev1.DeleteMemoryRequest) (*runtimev1.DeleteMemoryResponse, error) {
	if err := validatePublicRuntimeMemoryLocator(req.GetBank()); err != nil {
		return nil, err
	}
	if len(req.GetMemoryIds()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	bankResp, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{
		Context: req.GetContext(),
		Locator: req.GetBank(),
	})
	if err != nil {
		return nil, err
	}
	scopeID := memoryScopeID(bankResp.GetBank().GetBankId())
	deleted := make([]string, 0, len(req.GetMemoryIds()))
	for _, memoryID := range req.GetMemoryIds() {
		if err := s.cognitionCore.MemoryService().Delete(scopeID, cognitionmemory.RecordID(strings.TrimSpace(memoryID))); err != nil {
			continue
		}
		deleted = append(deleted, strings.TrimSpace(memoryID))
	}
	if len(deleted) > 0 {
		s.publishMemoryEvent(&runtimev1.MemoryEvent{
			EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_RECORD_DELETED,
			Bank:      cloneMemoryLocator(req.GetBank()),
			Timestamp: timestamppb.Now(),
			Detail: &runtimev1.MemoryEvent_RecordDeleted{
				RecordDeleted: &runtimev1.MemoryDeletedDetail{
					MemoryIds: deleted,
					Reason:    strings.TrimSpace(req.GetReason()),
				},
			},
		})
	}
	return &runtimev1.DeleteMemoryResponse{
		Ack:              okAck(),
		DeletedMemoryIds: deleted,
	}, nil
}

func runtimeRecordToCognition(bank *runtimev1.MemoryBank, input *runtimev1.MemoryRecordInput, now time.Time) (*runtimev1.MemoryRecord, cognitionmemory.Record, error) {
	if bank == nil || bank.GetLocator() == nil || input == nil {
		return nil, cognitionmemory.Record{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	record := &runtimev1.MemoryRecord{
		MemoryId:       newULID(),
		Bank:           cloneMemoryLocator(bank.GetLocator()),
		Kind:           input.GetKind(),
		CanonicalClass: input.GetCanonicalClass(),
		Provenance:     cloneMemoryProvenance(input.GetProvenance()),
		Metadata:       cloneStruct(input.GetMetadata()),
		Extensions:     cloneStruct(input.GetExtensions()),
		CreatedAt:      timestamppb.New(now),
		UpdatedAt:      timestamppb.New(now),
		Replication:    &runtimev1.MemoryReplicationState{Outcome: runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_UNSPECIFIED},
	}
	switch payload := input.GetPayload().(type) {
	case *runtimev1.MemoryRecordInput_Episodic:
		record.Payload = &runtimev1.MemoryRecord_Episodic{Episodic: cloneEpisodicRecord(payload.Episodic)}
	case *runtimev1.MemoryRecordInput_Semantic:
		record.Payload = &runtimev1.MemoryRecord_Semantic{Semantic: cloneSemanticRecord(payload.Semantic)}
	case *runtimev1.MemoryRecordInput_Observational:
		record.Payload = &runtimev1.MemoryRecord_Observational{Observational: cloneObservationalRecord(payload.Observational)}
	default:
		return nil, cognitionmemory.Record{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	content, kind, err := buildStoredMemoryContent(record)
	if err != nil {
		return nil, cognitionmemory.Record{}, err
	}
	return record, cognitionmemory.Record{
		RecordID:  cognitionmemory.RecordID(record.GetMemoryId()),
		Kind:      kind,
		Version:   1,
		Content:   content,
		Lifecycle: cognitionmemory.RecordLifecycleActive,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

func buildStoredMemoryContent(record *runtimev1.MemoryRecord) (json.RawMessage, cognitionmemory.RecordKind, error) {
	stored := storedMemoryContent{Runtime: mustProtoJSON(record)}
	kind := cognitionmemory.RecordKindEvent
	switch payload := record.GetPayload().(type) {
	case *runtimev1.MemoryRecord_Episodic:
		kind = cognitionmemory.RecordKindExperience
		stored.Summary = payload.Episodic.GetSummary()
		stored.Participants = append([]string(nil), payload.Episodic.GetParticipants()...)
		stored.Context = payload.Episodic.GetOccurredAt().AsTime().UTC().Format(time.RFC3339Nano)
	case *runtimev1.MemoryRecord_Semantic:
		kind = cognitionmemory.RecordKindObservation
		stored.Subject = payload.Semantic.GetSubject()
		stored.Predicate = payload.Semantic.GetPredicate()
		stored.Object = payload.Semantic.GetObject()
		stored.Confidence = payload.Semantic.GetConfidence()
	case *runtimev1.MemoryRecord_Observational:
		kind = cognitionmemory.RecordKindEvent
		stored.EventType = "observation"
		stored.Summary = payload.Observational.GetObservation()
		stored.Source = payload.Observational.GetSourceRef()
		stored.ObservedAt = payload.Observational.GetObservedAt().AsTime().UTC().Format(time.RFC3339Nano)
	default:
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return nil, "", err
	}
	return raw, kind, nil
}

func cognitionRecordToRuntime(locator *runtimev1.MemoryBankLocator, record cognitionmemory.Record) (*runtimev1.MemoryRecord, error) {
	var stored storedMemoryContent
	if err := json.Unmarshal(record.Content, &stored); err != nil {
		return nil, err
	}
	if len(stored.Runtime) > 0 {
		var out runtimev1.MemoryRecord
		if err := protojson.Unmarshal(stored.Runtime, &out); err == nil {
			out.Bank = cloneMemoryLocator(locator)
			out.UpdatedAt = timestamppb.New(record.UpdatedAt)
			return &out, nil
		}
	}
	out := &runtimev1.MemoryRecord{
		MemoryId:  string(record.RecordID),
		Bank:      cloneMemoryLocator(locator),
		CreatedAt: timestamppb.New(record.CreatedAt),
		UpdatedAt: timestamppb.New(record.UpdatedAt),
		Replication: &runtimev1.MemoryReplicationState{
			Outcome: runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_UNSPECIFIED,
		},
	}
	switch record.Kind {
	case cognitionmemory.RecordKindExperience:
		out.Kind = runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_EPISODIC
		out.Payload = &runtimev1.MemoryRecord_Episodic{
			Episodic: &runtimev1.EpisodicMemoryRecord{
				Summary:      stored.Summary,
				Participants: append([]string(nil), stored.Participants...),
			},
		}
	case cognitionmemory.RecordKindObservation:
		out.Kind = runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC
		out.Payload = &runtimev1.MemoryRecord_Semantic{
			Semantic: &runtimev1.SemanticMemoryRecord{
				Subject:    stored.Subject,
				Predicate:  stored.Predicate,
				Object:     stored.Object,
				Confidence: stored.Confidence,
			},
		}
	default:
		out.Kind = runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL
		out.Payload = &runtimev1.MemoryRecord_Observational{
			Observational: &runtimev1.ObservationalMemoryRecord{
				Observation: stored.Summary,
				SourceRef:   stored.Source,
			},
		}
	}
	return out, nil
}

func matchesRecallQuery(record *runtimev1.MemoryRecord, query *runtimev1.MemoryRecallQuery) bool {
	if record == nil || query == nil {
		return false
	}
	if len(query.GetKinds()) > 0 {
		match := false
		for _, kind := range query.GetKinds() {
			if kind == record.GetKind() {
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
			if class == record.GetCanonicalClass() {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	updatedAt := record.GetUpdatedAt().AsTime()
	if start := query.GetStartTime(); start != nil && !start.AsTime().IsZero() && updatedAt.Before(start.AsTime()) {
		return false
	}
	if end := query.GetEndTime(); end != nil && !end.AsTime().IsZero() && updatedAt.After(end.AsTime()) {
		return false
	}
	return true
}

func matchesHistoryQuery(record *runtimev1.MemoryRecord, query *runtimev1.MemoryHistoryQuery) bool {
	if record == nil || query == nil {
		return true
	}
	if len(query.GetKinds()) > 0 {
		match := false
		for _, kind := range query.GetKinds() {
			if kind == record.GetKind() {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	updatedAt := record.GetUpdatedAt().AsTime()
	if start := query.GetStartTime(); start != nil && !start.AsTime().IsZero() && updatedAt.Before(start.AsTime()) {
		return false
	}
	if end := query.GetEndTime(); end != nil && !end.AsTime().IsZero() && updatedAt.After(end.AsTime()) {
		return false
	}
	return true
}

func cloneMemoryProvenance(value *runtimev1.MemoryProvenance) *runtimev1.MemoryProvenance {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.MemoryProvenance)
	return cloned
}

func cloneEpisodicRecord(value *runtimev1.EpisodicMemoryRecord) *runtimev1.EpisodicMemoryRecord {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.EpisodicMemoryRecord)
	return cloned
}

func cloneSemanticRecord(value *runtimev1.SemanticMemoryRecord) *runtimev1.SemanticMemoryRecord {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.SemanticMemoryRecord)
	return cloned
}

func cloneObservationalRecord(value *runtimev1.ObservationalMemoryRecord) *runtimev1.ObservationalMemoryRecord {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.ObservationalMemoryRecord)
	return cloned
}
