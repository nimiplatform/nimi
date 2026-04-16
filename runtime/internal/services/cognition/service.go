package cognition

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	nimicognition "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	knowledgeservice "github.com/nimiplatform/nimi/runtime/internal/services/knowledge"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultMemoryHistoryPageSize = 50
	maxMemoryHistoryPageSize     = 200
	defaultKnowledgePageSize     = 50
	maxKnowledgePageSize         = 100
	defaultSearchTopK            = 5
	maxSearchTopK                = 50
	defaultSearchPageSize        = 10
	maxSearchPageSize            = 100
	defaultGraphPageSize         = 25
	maxGraphPageSize             = 100
	defaultGraphTraversalDepth   = 2
	maxGraphTraversalDepth       = 5
	subscriberBuffer             = 32
)

type Service struct {
	runtimev1.UnimplementedRuntimeCognitionServiceServer

	logger        *slog.Logger
	memorySvc     *memoryservice.Service
	knowledgeSvc  *knowledgeservice.Service
	cognitionCore *nimicognition.Cognition

	mu               sync.RWMutex
	sequence         uint64
	nextSubscriberID uint64
	subscribers      map[uint64]*subscriber
	ingestTasks      map[string]ingestTaskProjection
}

type subscriber struct {
	id           uint64
	scopeFilters map[runtimev1.MemoryBankScope]struct{}
	ownerFilters []*runtimev1.MemoryBankOwnerFilter
	ch           chan *runtimev1.MemoryEvent
}

type ingestTaskProjection struct {
	BankID string
	Slug   string
	Title  string
}

type storedMemoryContent struct {
	Summary      string          `json:"summary,omitempty"`
	Context      string          `json:"context,omitempty"`
	Participants []string        `json:"participants,omitempty"`
	Subject      string          `json:"subject,omitempty"`
	Predicate    string          `json:"predicate,omitempty"`
	Object       string          `json:"object,omitempty"`
	Confidence   float64         `json:"confidence,omitempty"`
	EventType    string          `json:"event_type,omitempty"`
	Source       string          `json:"source,omitempty"`
	ObservedAt   string          `json:"observed_at,omitempty"`
	Runtime      json.RawMessage `json:"_runtime_record,omitempty"`
}

type storedKnowledgeBody struct {
	Content string          `json:"content"`
	Runtime json.RawMessage `json:"_runtime_page,omitempty"`
}

func New(logger *slog.Logger, cfg config.Config, memorySvc *memoryservice.Service, knowledgeSvc *knowledgeservice.Service) (*Service, error) {
	if memorySvc == nil {
		return nil, errors.New("cognition service: memory service is required")
	}
	if knowledgeSvc == nil {
		return nil, errors.New("cognition service: knowledge service is required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	root := filepath.Join(filepath.Dir(strings.TrimSpace(cfg.LocalStatePath)), "runtime-cognition")
	core, err := nimicognition.New(root)
	if err != nil {
		return nil, fmt.Errorf("cognition service: init cognition core: %w", err)
	}
	return &Service{
		logger:        logger,
		memorySvc:     memorySvc,
		knowledgeSvc:  knowledgeSvc,
		cognitionCore: core,
		subscribers:   make(map[uint64]*subscriber),
		ingestTasks:   make(map[string]ingestTaskProjection),
	}, nil
}

func (s *Service) Close() error {
	if s == nil || s.cognitionCore == nil {
		return nil
	}
	return s.cognitionCore.Close()
}

func (s *Service) CreateBank(ctx context.Context, req *runtimev1.CreateBankRequest) (*runtimev1.CreateBankResponse, error) {
	resp, err := s.memorySvc.CreateBank(ctx, req)
	if err != nil {
		return nil, err
	}
	if resp != nil && resp.GetBank() != nil {
		s.publishMemoryEvent(&runtimev1.MemoryEvent{
			EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_BANK_CREATED,
			Bank:      cloneMemoryLocator(resp.GetBank().GetLocator()),
			Timestamp: timestamppb.Now(),
			Detail: &runtimev1.MemoryEvent_BankCreated{
				BankCreated: cloneMemoryBank(resp.GetBank()),
			},
		})
	}
	return resp, nil
}

func (s *Service) GetBank(ctx context.Context, req *runtimev1.GetBankRequest) (*runtimev1.GetBankResponse, error) {
	if err := validatePublicRuntimeMemoryLocator(req.GetLocator()); err != nil {
		return nil, err
	}
	return s.memorySvc.GetBank(ctx, req)
}

func (s *Service) ListBanks(ctx context.Context, req *runtimev1.ListBanksRequest) (*runtimev1.ListBanksResponse, error) {
	resp, err := s.memorySvc.ListBanks(ctx, req)
	if err != nil {
		return nil, err
	}
	filtered := make([]*runtimev1.MemoryBank, 0, len(resp.GetBanks()))
	for _, bank := range resp.GetBanks() {
		if bank == nil || !isPublicMemoryScope(bank.GetLocator().GetScope()) {
			continue
		}
		filtered = append(filtered, cloneMemoryBank(bank))
	}
	return &runtimev1.ListBanksResponse{
		Banks:         filtered,
		NextPageToken: resp.GetNextPageToken(),
	}, nil
}

func (s *Service) DeleteBank(ctx context.Context, req *runtimev1.DeleteBankRequest) (*runtimev1.DeleteBankResponse, error) {
	locator, err := publicMemoryLocatorToFull(req.GetLocator())
	if err != nil {
		return nil, err
	}
	bankResp, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{
		Context: req.GetContext(),
		Locator: locator,
	})
	if err != nil {
		return nil, err
	}
	resp, err := s.memorySvc.DeleteBank(ctx, req)
	if err != nil {
		return nil, err
	}
	if err := s.cognitionCore.DeleteScope(memoryScopeID(bankResp.GetBank().GetBankId())); err != nil && s.logger != nil {
		s.logger.Warn("runtime cognition memory scope cleanup failed", "bank_id", bankResp.GetBank().GetBankId(), "error", err)
	}
	s.publishMemoryEvent(&runtimev1.MemoryEvent{
		EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_BANK_DELETED,
		Bank:      cloneMemoryLocator(locator),
		Timestamp: timestamppb.Now(),
		Detail: &runtimev1.MemoryEvent_BankDeleted{
			BankDeleted: cloneMemoryBank(bankResp.GetBank()),
		},
	})
	return resp, nil
}

func (s *Service) SubscribeMemoryEvents(req *runtimev1.SubscribeMemoryEventsRequest, stream runtimev1.RuntimeCognitionService_SubscribeMemoryEventsServer) error {
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
			if err := stream.Send(cloneMemoryEvent(event)); err != nil {
				return err
			}
		}
	}
}

func (s *Service) addSubscriber(req *runtimev1.SubscribeMemoryEventsRequest) *subscriber {
	sub := &subscriber{
		scopeFilters: make(map[runtimev1.MemoryBankScope]struct{}),
		ownerFilters: cloneMemoryOwnerFilters(req.GetOwnerFilters()),
		ch:           make(chan *runtimev1.MemoryEvent, subscriberBuffer),
	}
	for _, scope := range req.GetScopeFilters() {
		sub.scopeFilters[scope] = struct{}{}
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

func (s *Service) publishMemoryEvent(event *runtimev1.MemoryEvent) {
	if event == nil {
		return
	}
	s.mu.Lock()
	s.sequence++
	event.Sequence = s.sequence
	targets := make([]*subscriber, 0, len(s.subscribers))
	for _, sub := range s.subscribers {
		if sub == nil || !subscriberMatches(sub, event.GetBank()) {
			continue
		}
		targets = append(targets, sub)
	}
	s.mu.Unlock()
	for _, sub := range targets {
		select {
		case sub.ch <- cloneMemoryEvent(event):
		default:
		}
	}
}

func subscriberMatches(sub *subscriber, locator *runtimev1.MemoryBankLocator) bool {
	if sub == nil || locator == nil {
		return false
	}
	if len(sub.scopeFilters) > 0 {
		if _, ok := sub.scopeFilters[locator.GetScope()]; !ok {
			return false
		}
	}
	if len(sub.ownerFilters) == 0 {
		return true
	}
	for _, filter := range sub.ownerFilters {
		if memoryOwnerMatches(filter, locator) {
			return true
		}
	}
	return false
}

func isPublicMemoryScope(scope runtimev1.MemoryBankScope) bool {
	return scope == runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE ||
		scope == runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE
}

func validatePublicRuntimeMemoryLocator(locator *runtimev1.MemoryBankLocator) error {
	if locator == nil || !isPublicMemoryScope(locator.GetScope()) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func memoryScopeID(bankID string) string {
	return "mem_" + sanitizeScopeID(bankID)
}

func knowledgeScopeID(bankID string) string {
	return "know_" + sanitizeScopeID(bankID)
}

func sanitizeScopeID(value string) string {
	if value == "" {
		return "scope"
	}
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	if len(out) > 128 {
		return out[:128]
	}
	return out
}

func decodePageToken(raw string) (int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, nil
	}
	var value int
	if _, err := fmt.Sscanf(trimmed, "%d", &value); err != nil || value < 0 {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return value, nil
}

func encodePageToken(offset int) string {
	if offset <= 0 {
		return ""
	}
	return fmt.Sprintf("%d", offset)
}

func pageWindow(total, offset, pageSize int) (start, end int, next string) {
	if offset > total {
		offset = total
	}
	start = offset
	end = start + pageSize
	if end > total {
		end = total
	}
	if end < total {
		next = encodePageToken(end)
	}
	return start, end, next
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

func mustProtoJSON(value proto.Message) json.RawMessage {
	if value == nil {
		return nil
	}
	raw, _ := protojson.Marshal(value)
	return raw
}

func cloneMemoryBank(value *runtimev1.MemoryBank) *runtimev1.MemoryBank {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.MemoryBank)
	return cloned
}

func cloneMemoryRecord(value *runtimev1.MemoryRecord) *runtimev1.MemoryRecord {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.MemoryRecord)
	return cloned
}

func cloneMemoryLocator(value *runtimev1.MemoryBankLocator) *runtimev1.MemoryBankLocator {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.MemoryBankLocator)
	return cloned
}

func cloneMemoryEvent(value *runtimev1.MemoryEvent) *runtimev1.MemoryEvent {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.MemoryEvent)
	return cloned
}

func cloneMemoryOwnerFilters(values []*runtimev1.MemoryBankOwnerFilter) []*runtimev1.MemoryBankOwnerFilter {
	out := make([]*runtimev1.MemoryBankOwnerFilter, 0, len(values))
	for _, value := range values {
		if value == nil {
			continue
		}
		cloned, _ := proto.Clone(value).(*runtimev1.MemoryBankOwnerFilter)
		out = append(out, cloned)
	}
	return out
}

func memoryOwnerMatches(filter *runtimev1.MemoryBankOwnerFilter, locator *runtimev1.MemoryBankLocator) bool {
	if filter == nil || locator == nil {
		return false
	}
	switch {
	case filter.GetAppPrivate() != nil && locator.GetAppPrivate() != nil:
		return strings.TrimSpace(filter.GetAppPrivate().GetAccountId()) == strings.TrimSpace(locator.GetAppPrivate().GetAccountId()) &&
			strings.TrimSpace(filter.GetAppPrivate().GetAppId()) == strings.TrimSpace(locator.GetAppPrivate().GetAppId())
	case filter.GetWorkspacePrivate() != nil && locator.GetWorkspacePrivate() != nil:
		return strings.TrimSpace(filter.GetWorkspacePrivate().GetAccountId()) == strings.TrimSpace(locator.GetWorkspacePrivate().GetAccountId()) &&
			strings.TrimSpace(filter.GetWorkspacePrivate().GetWorkspaceId()) == strings.TrimSpace(locator.GetWorkspacePrivate().GetWorkspaceId())
	case filter.GetAgentCore() != nil && locator.GetAgentCore() != nil:
		return strings.TrimSpace(filter.GetAgentCore().GetAgentId()) == strings.TrimSpace(locator.GetAgentCore().GetAgentId())
	case filter.GetAgentDyadic() != nil && locator.GetAgentDyadic() != nil:
		return strings.TrimSpace(filter.GetAgentDyadic().GetAgentId()) == strings.TrimSpace(locator.GetAgentDyadic().GetAgentId()) &&
			strings.TrimSpace(filter.GetAgentDyadic().GetUserId()) == strings.TrimSpace(locator.GetAgentDyadic().GetUserId())
	case filter.GetWorldShared() != nil && locator.GetWorldShared() != nil:
		return strings.TrimSpace(filter.GetWorldShared().GetWorldId()) == strings.TrimSpace(locator.GetWorldShared().GetWorldId())
	default:
		return false
	}
}

func publicMemoryLocatorToFull(locator *runtimev1.PublicMemoryBankLocator) (*runtimev1.MemoryBankLocator, error) {
	if locator == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if value := locator.GetAppPrivate(); value != nil {
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE,
			Owner: &runtimev1.MemoryBankLocator_AppPrivate{
				AppPrivate: cloneAppPrivateOwner(value),
			},
		}, nil
	}
	if value := locator.GetWorkspacePrivate(); value != nil {
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE,
			Owner: &runtimev1.MemoryBankLocator_WorkspacePrivate{
				WorkspacePrivate: cloneWorkspacePrivateOwner(value),
			},
		}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
}

func cloneAppPrivateOwner(value *runtimev1.AppPrivateBankOwner) *runtimev1.AppPrivateBankOwner {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.AppPrivateBankOwner)
	return cloned
}

func cloneWorkspacePrivateOwner(value *runtimev1.WorkspacePrivateBankOwner) *runtimev1.WorkspacePrivateBankOwner {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.WorkspacePrivateBankOwner)
	return cloned
}

func sortMemoryRecords(records []*runtimev1.MemoryRecord) {
	sort.Slice(records, func(i, j int) bool {
		left := records[i].GetUpdatedAt().AsTime()
		right := records[j].GetUpdatedAt().AsTime()
		if left.Equal(right) {
			return records[i].GetMemoryId() < records[j].GetMemoryId()
		}
		return left.After(right)
	})
}

func sortKnowledgePages(pages []*runtimev1.KnowledgePage) {
	sort.Slice(pages, func(i, j int) bool {
		left := pages[i].GetUpdatedAt().AsTime()
		right := pages[j].GetUpdatedAt().AsTime()
		if left.Equal(right) {
			return pages[i].GetPageId() < pages[j].GetPageId()
		}
		return left.After(right)
	})
}

func reasonCodeFromError(err error, fallback runtimev1.ReasonCode) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	if code, ok := grpcerr.ExtractReasonCode(err); ok {
		return code
	}
	return fallback
}

func cloneStruct(value *structpb.Struct) *structpb.Struct {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*structpb.Struct)
	return cloned
}

func newULID() string {
	return ulid.Make().String()
}

func validateKnowledgeContext(ctx *runtimev1.KnowledgeRequestContext) error {
	if ctx == nil || strings.TrimSpace(ctx.GetAppId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func okAck() *runtimev1.Ack {
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
}
