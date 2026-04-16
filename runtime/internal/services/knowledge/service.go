package knowledge

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultKeywordTopK          = 5
	maxKeywordTopK              = 50
	defaultBankPageSize         = 50
	maxBankPageSize             = 100
	defaultPagePageSize         = 50
	maxPagePageSize             = 100
	defaultHybridPageSize       = 10
	maxHybridPageSize           = 100
	defaultGraphPageSize        = 25
	maxGraphPageSize            = 100
	defaultGraphTraversalDepth  = 2
	maxGraphTraversalDepth      = 5
	knowledgeEmbeddingDimension = 32
)

type bankState struct {
	Bank       *runtimev1.KnowledgeBank
	PagesByID  map[string]*runtimev1.KnowledgePage
	SlugToPage map[string]string
	LinksByID  map[string]*runtimev1.KnowledgeLink
}

type ingestTaskState struct {
	Task  *runtimev1.KnowledgeIngestTask
	AppID string
}

// Service provides runtime-local knowledge backing state for cognition surfaces.
type Service struct {
	logger  *slog.Logger
	backend *runtimepersistence.Backend

	ownsBackend bool

	mu              sync.RWMutex
	banksByID       map[string]*bankState
	bankIDByOwner   map[string]string
	ingestTasksByID map[string]*ingestTaskState
}

func New(logger *slog.Logger) *Service {
	svc, _ := newService(logger, nil, false)
	return svc
}

func NewWithBackend(logger *slog.Logger, backend *runtimepersistence.Backend) (*Service, error) {
	return newService(logger, backend, false)
}

func NewPersistent(logger *slog.Logger, localStatePath string) (*Service, error) {
	backend, err := runtimepersistence.Open(logger, localStatePath)
	if err != nil {
		return nil, err
	}
	svc, err := newService(logger, backend, true)
	if err != nil {
		_ = backend.Close()
		return nil, err
	}
	return svc, nil
}

func newService(logger *slog.Logger, backend *runtimepersistence.Backend, ownsBackend bool) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	svc := &Service{
		logger:          logger,
		backend:         backend,
		ownsBackend:     ownsBackend,
		banksByID:       make(map[string]*bankState),
		bankIDByOwner:   make(map[string]string),
		ingestTasksByID: make(map[string]*ingestTaskState),
	}
	if err := svc.loadState(); err != nil {
		return nil, err
	}
	return svc, nil
}

func (s *Service) Close() error {
	if s == nil || s.backend == nil || !s.ownsBackend {
		return nil
	}
	return s.backend.Close()
}

func (s *Service) CreateKnowledgeBank(_ context.Context, req *runtimev1.CreateKnowledgeBankRequest) (*runtimev1.CreateKnowledgeBankResponse, error) {
	locator, err := fullLocatorFromPublic(req.GetLocator())
	if err != nil {
		return nil, err
	}
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	if err := validateCreateBankAccess(req.GetContext(), locator); err != nil {
		return nil, err
	}

	key := locatorKey(locator)
	s.mu.RLock()
	if existingID, ok := s.bankIDByOwner[key]; ok {
		existing := s.banksByID[existingID]
		s.mu.RUnlock()
		if existing != nil {
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_BANK_ALREADY_EXISTS)
		}
	} else {
		s.mu.RUnlock()
	}

	now := time.Now().UTC()
	bank := &runtimev1.KnowledgeBank{
		BankId:      deriveBankID(locator),
		Locator:     cloneKnowledgeLocator(locator),
		DisplayName: defaultBankDisplayName(locator, req.GetDisplayName()),
		Metadata:    cloneStruct(req.GetMetadata()),
		CreatedAt:   timestamppb.New(now),
		UpdatedAt:   timestamppb.New(now),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.bankIDByOwner[key]; exists {
		return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_BANK_ALREADY_EXISTS)
	}
	s.bankIDByOwner[key] = bank.GetBankId()
	state := &bankState{
		Bank:       bank,
		PagesByID:  make(map[string]*runtimev1.KnowledgePage),
		SlugToPage: make(map[string]string),
		LinksByID:  make(map[string]*runtimev1.KnowledgeLink),
	}
	s.banksByID[bank.GetBankId()] = state
	if err := s.persistLocked(); err != nil {
		delete(s.bankIDByOwner, key)
		delete(s.banksByID, bank.GetBankId())
		return nil, err
	}
	return &runtimev1.CreateKnowledgeBankResponse{Bank: cloneKnowledgeBank(bank)}, nil
}

func (s *Service) GetKnowledgeBank(_ context.Context, req *runtimev1.GetKnowledgeBankRequest) (*runtimev1.GetKnowledgeBankResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	if bankID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.RLock()
	state := s.banksByID[bankID]
	s.mu.RUnlock()
	if state == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}
	return &runtimev1.GetKnowledgeBankResponse{Bank: cloneKnowledgeBank(state.Bank)}, nil
}

func (s *Service) ListKnowledgeBanks(_ context.Context, req *runtimev1.ListKnowledgeBanksRequest) (*runtimev1.ListKnowledgeBanksResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}

	s.mu.RLock()
	items := make([]*runtimev1.KnowledgeBank, 0, len(s.banksByID))
	for _, state := range s.banksByID {
		if state == nil || state.Bank == nil {
			continue
		}
		if authorizeBank(req.GetContext(), state.Bank) != nil {
			continue
		}
		if !matchesBankFilters(state.Bank, req.GetScopeFilters(), req.GetOwnerFilters()) {
			continue
		}
		items = append(items, cloneKnowledgeBank(state.Bank))
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
	start, end, next := sliceBounds(len(items), offset, pageSize)
	return &runtimev1.ListKnowledgeBanksResponse{
		Banks:         items[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) DeleteKnowledgeBank(_ context.Context, req *runtimev1.DeleteKnowledgeBankRequest) (*runtimev1.DeleteKnowledgeBankResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	if bankID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}
	previous := cloneBankState(state)
	delete(s.bankIDByOwner, locatorKey(state.Bank.GetLocator()))
	delete(s.banksByID, bankID)
	if err := s.persistLocked(); err != nil {
		s.bankIDByOwner[locatorKey(previous.Bank.GetLocator())] = previous.Bank.GetBankId()
		s.banksByID[bankID] = previous
		return nil, err
	}
	return &runtimev1.DeleteKnowledgeBankResponse{
		Ack: &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED},
	}, nil
}

func (s *Service) PutPage(_ context.Context, req *runtimev1.PutPageRequest) (*runtimev1.PutPageResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	slug := strings.TrimSpace(req.GetSlug())
	if bankID == "" || slug == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}

	pageID := strings.TrimSpace(req.GetPageId())
	slugOwnerPageID, slugTaken := state.SlugToPage[slug]
	if pageID != "" && slugTaken && slugOwnerPageID != pageID {
		return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_PAGE_SLUG_CONFLICT)
	}

	now := time.Now().UTC()
	previous := cloneBankState(state)
	page := upsertPageLocked(state, req, now)
	if err := s.persistLocked(); err != nil {
		s.banksByID[bankID] = previous
		return nil, err
	}
	return &runtimev1.PutPageResponse{Page: cloneKnowledgePage(page)}, nil
}

func (s *Service) GetPage(_ context.Context, req *runtimev1.GetPageRequest) (*runtimev1.GetPageResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	state, page, err := s.lookupPage(req.GetContext(), req.GetBankId(), req.GetPageId(), req.GetSlug())
	if err != nil {
		return nil, err
	}
	_ = state
	return &runtimev1.GetPageResponse{Page: cloneKnowledgePage(page)}, nil
}

func (s *Service) ListPages(_ context.Context, req *runtimev1.ListPagesRequest) (*runtimev1.ListPagesResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	if bankID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.RLock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		s.mu.RUnlock()
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		s.mu.RUnlock()
		return nil, err
	}
	items := make([]*runtimev1.KnowledgePage, 0, len(state.PagesByID))
	for _, page := range state.PagesByID {
		if !matchesPageFilters(page, req.GetEntityTypeFilters(), req.GetSlugPrefix()) {
			continue
		}
		items = append(items, cloneKnowledgePage(page))
	}
	s.mu.RUnlock()

	sort.Slice(items, func(i, j int) bool {
		left := timestampValue(items[i].GetUpdatedAt())
		right := timestampValue(items[j].GetUpdatedAt())
		if left.Equal(right) {
			return items[i].GetPageId() < items[j].GetPageId()
		}
		return left.After(right)
	})

	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultPagePageSize, maxPagePageSize)
	start, end, next := sliceBounds(len(items), offset, pageSize)
	return &runtimev1.ListPagesResponse{
		Pages:         items[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) DeletePage(_ context.Context, req *runtimev1.DeletePageRequest) (*runtimev1.DeletePageResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	pageID := strings.TrimSpace(req.GetPageId())
	slug := strings.TrimSpace(req.GetSlug())
	if bankID == "" || (pageID == "" && slug == "") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}
	page := resolveExistingPage(state, pageID, slug)
	if page == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	previous := cloneBankState(state)
	delete(state.PagesByID, page.GetPageId())
	delete(state.SlugToPage, page.GetSlug())
	for linkID, link := range state.LinksByID {
		if link == nil {
			continue
		}
		if link.GetFromPageId() == page.GetPageId() || link.GetToPageId() == page.GetPageId() {
			delete(state.LinksByID, linkID)
		}
	}
	state.Bank.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := s.persistLocked(); err != nil {
		s.banksByID[bankID] = previous
		return nil, err
	}
	return &runtimev1.DeletePageResponse{
		Ack: &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED},
	}, nil
}

func (s *Service) SearchKeyword(_ context.Context, req *runtimev1.SearchKeywordRequest) (*runtimev1.SearchKeywordResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	topK := int(req.GetTopK())
	if topK <= 0 {
		topK = defaultKeywordTopK
	} else if topK > maxKeywordTopK {
		topK = maxKeywordTopK
	}

	bankIDs := normalizeBankIDs(req.GetBankIds())
	s.mu.RLock()
	defer s.mu.RUnlock()

	targetBanks := make([]*bankState, 0, len(s.banksByID))
	if len(bankIDs) == 0 {
		for _, state := range s.banksByID {
			if state == nil || state.Bank == nil {
				continue
			}
			if authorizeBank(req.GetContext(), state.Bank) != nil {
				continue
			}
			targetBanks = append(targetBanks, state)
		}
	} else {
		for _, bankID := range bankIDs {
			state := s.banksByID[bankID]
			if state == nil || state.Bank == nil {
				return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
			}
			if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
				return nil, err
			}
			targetBanks = append(targetBanks, state)
		}
	}

	queryLower := strings.ToLower(query)
	hits := make([]*runtimev1.KnowledgeKeywordHit, 0)
	for _, state := range targetBanks {
		for _, page := range state.PagesByID {
			if !matchesPageFilters(page, req.GetEntityTypeFilters(), req.GetSlugPrefix()) {
				continue
			}
			text := page.GetTitle() + "\n" + page.GetContent()
			textLower := strings.ToLower(text)
			if !strings.Contains(textLower, queryLower) {
				continue
			}
			hits = append(hits, &runtimev1.KnowledgeKeywordHit{
				BankId:   page.GetBankId(),
				PageId:   page.GetPageId(),
				Slug:     page.GetSlug(),
				Title:    page.GetTitle(),
				Snippet:  snippet(text, query),
				Score:    1.0,
				Metadata: cloneStruct(page.GetMetadata()),
			})
		}
	}

	sort.Slice(hits, func(i, j int) bool {
		if hits[i].GetScore() == hits[j].GetScore() {
			if hits[i].GetBankId() == hits[j].GetBankId() {
				return hits[i].GetPageId() < hits[j].GetPageId()
			}
			return hits[i].GetBankId() < hits[j].GetBankId()
		}
		return hits[i].GetScore() > hits[j].GetScore()
	})
	if len(hits) > topK {
		hits = hits[:topK]
	}
	return &runtimev1.SearchKeywordResponse{Hits: hits, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) SearchHybrid(_ context.Context, req *runtimev1.SearchHybridRequest) (*runtimev1.SearchHybridResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	query := strings.TrimSpace(req.GetQuery())
	if bankID == "" || query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultHybridPageSize, maxHybridPageSize)
	queryVector := computeKnowledgeEmbedding(query, knowledgeEmbeddingDimension)
	queryLower := strings.ToLower(query)

	s.mu.RLock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		s.mu.RUnlock()
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		s.mu.RUnlock()
		return nil, err
	}
	type hybridHit struct {
		hit   *runtimev1.KnowledgeKeywordHit
		score float64
	}
	items := make([]hybridHit, 0, len(state.PagesByID))
	for _, page := range state.PagesByID {
		if !matchesPageFilters(page, req.GetEntityTypeFilters(), "") {
			continue
		}
		text := page.GetTitle() + "\n" + page.GetContent()
		lexicalScore := lexicalMatchScore(text, queryLower)
		vectorScore := cosineSimilarity(queryVector, computeKnowledgeEmbedding(text, knowledgeEmbeddingDimension))
		if lexicalScore <= 0 && vectorScore <= 0 {
			continue
		}
		score := lexicalScore*0.6 + maxFloat(vectorScore, 0)*0.4
		items = append(items, hybridHit{
			score: score,
			hit: &runtimev1.KnowledgeKeywordHit{
				BankId:   page.GetBankId(),
				PageId:   page.GetPageId(),
				Slug:     page.GetSlug(),
				Title:    page.GetTitle(),
				Snippet:  snippet(text, query),
				Score:    float32(score),
				Metadata: cloneStruct(page.GetMetadata()),
			},
		})
	}
	s.mu.RUnlock()

	sort.Slice(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].hit.GetPageId() < items[j].hit.GetPageId()
		}
		return items[i].score > items[j].score
	})

	start, end, next := sliceBounds(len(items), offset, pageSize)
	hits := make([]*runtimev1.KnowledgeKeywordHit, 0, end-start)
	for _, item := range items[start:end] {
		hits = append(hits, item.hit)
	}
	return &runtimev1.SearchHybridResponse{
		Hits:          hits,
		NextPageToken: next,
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) AddLink(_ context.Context, req *runtimev1.AddLinkRequest) (*runtimev1.AddLinkResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	fromPageID := strings.TrimSpace(req.GetFromPageId())
	toPageID := strings.TrimSpace(req.GetToPageId())
	linkType := strings.TrimSpace(req.GetLinkType())
	if bankID == "" || fromPageID == "" || toPageID == "" || linkType == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if fromPageID == toPageID {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_LINK_INVALID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}
	if state.PagesByID[fromPageID] == nil || state.PagesByID[toPageID] == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	if findDuplicateLink(state, fromPageID, toPageID, linkType) != nil {
		return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_LINK_ALREADY_EXISTS)
	}

	previous := cloneBankState(state)
	now := time.Now().UTC()
	link := &runtimev1.KnowledgeLink{
		LinkId:     ulid.Make().String(),
		BankId:     bankID,
		FromPageId: fromPageID,
		ToPageId:   toPageID,
		LinkType:   linkType,
		Metadata:   cloneStruct(req.GetMetadata()),
		CreatedAt:  timestamppb.New(now),
		UpdatedAt:  timestamppb.New(now),
	}
	state.LinksByID[link.GetLinkId()] = link
	state.Bank.UpdatedAt = timestamppb.New(now)
	if err := s.persistLocked(); err != nil {
		s.banksByID[bankID] = previous
		return nil, err
	}
	return &runtimev1.AddLinkResponse{Link: cloneKnowledgeLink(link)}, nil
}

func (s *Service) RemoveLink(_ context.Context, req *runtimev1.RemoveLinkRequest) (*runtimev1.RemoveLinkResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	linkID := strings.TrimSpace(req.GetLinkId())
	if bankID == "" || linkID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}
	if state.LinksByID[linkID] == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_LINK_NOT_FOUND)
	}

	previous := cloneBankState(state)
	delete(state.LinksByID, linkID)
	state.Bank.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := s.persistLocked(); err != nil {
		s.banksByID[bankID] = previous
		return nil, err
	}
	return &runtimev1.RemoveLinkResponse{
		Ack: &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED},
	}, nil
}

func (s *Service) ListLinks(_ context.Context, req *runtimev1.ListLinksRequest) (*runtimev1.ListLinksResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultGraphPageSize, maxGraphPageSize)
	state, _, err := s.lookupPage(req.GetContext(), req.GetBankId(), req.GetFromPageId(), "")
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	items := make([]*runtimev1.KnowledgeGraphEdge, 0, len(state.LinksByID))
	for _, link := range state.LinksByID {
		if link == nil || link.GetFromPageId() != strings.TrimSpace(req.GetFromPageId()) {
			continue
		}
		if !matchesLinkTypeFilters(link, req.GetLinkTypeFilters()) {
			continue
		}
		items = append(items, buildGraphEdge(state, link))
	}
	s.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool {
		left := timestampValue(items[i].GetLink().GetUpdatedAt())
		right := timestampValue(items[j].GetLink().GetUpdatedAt())
		if left.Equal(right) {
			return items[i].GetLink().GetLinkId() < items[j].GetLink().GetLinkId()
		}
		return left.After(right)
	})
	start, end, next := sliceBounds(len(items), offset, pageSize)
	return &runtimev1.ListLinksResponse{Links: items[start:end], NextPageToken: next}, nil
}

func (s *Service) ListBacklinks(_ context.Context, req *runtimev1.ListBacklinksRequest) (*runtimev1.ListBacklinksResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultGraphPageSize, maxGraphPageSize)
	state, _, err := s.lookupPage(req.GetContext(), req.GetBankId(), req.GetToPageId(), "")
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	items := make([]*runtimev1.KnowledgeGraphEdge, 0, len(state.LinksByID))
	for _, link := range state.LinksByID {
		if link == nil || link.GetToPageId() != strings.TrimSpace(req.GetToPageId()) {
			continue
		}
		if !matchesLinkTypeFilters(link, req.GetLinkTypeFilters()) {
			continue
		}
		items = append(items, buildGraphEdge(state, link))
	}
	s.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool {
		left := timestampValue(items[i].GetLink().GetUpdatedAt())
		right := timestampValue(items[j].GetLink().GetUpdatedAt())
		if left.Equal(right) {
			return items[i].GetLink().GetLinkId() < items[j].GetLink().GetLinkId()
		}
		return left.After(right)
	})
	start, end, next := sliceBounds(len(items), offset, pageSize)
	return &runtimev1.ListBacklinksResponse{Backlinks: items[start:end], NextPageToken: next}, nil
}

func (s *Service) TraverseGraph(_ context.Context, req *runtimev1.TraverseGraphRequest) (*runtimev1.TraverseGraphResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	maxDepth := int(req.GetMaxDepth())
	if maxDepth == 0 {
		maxDepth = defaultGraphTraversalDepth
	}
	if maxDepth < 1 || maxDepth > maxGraphTraversalDepth {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_GRAPH_DEPTH_INVALID)
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultGraphPageSize, maxGraphPageSize)
	state, root, err := s.lookupPage(req.GetContext(), req.GetBankId(), req.GetRootPageId(), "")
	if err != nil {
		return nil, err
	}

	type traversalStep struct {
		pageID string
		depth  int
	}

	s.mu.RLock()
	visited := map[string]struct{}{root.GetPageId(): {}}
	queue := []traversalStep{{pageID: root.GetPageId(), depth: 0}}
	nodes := make([]*runtimev1.KnowledgeGraphNode, 0, len(state.PagesByID))
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		page := state.PagesByID[current.pageID]
		if page == nil {
			continue
		}
		nodes = append(nodes, &runtimev1.KnowledgeGraphNode{
			BankId:     page.GetBankId(),
			PageId:     page.GetPageId(),
			Slug:       page.GetSlug(),
			Title:      page.GetTitle(),
			EntityType: page.GetEntityType(),
			Metadata:   cloneStruct(page.GetMetadata()),
			Depth:      int32(current.depth),
		})
		if current.depth >= maxDepth {
			continue
		}
		neighbors := outgoingLinksForPage(state, current.pageID, req.GetLinkTypeFilters())
		sort.Slice(neighbors, func(i, j int) bool {
			if neighbors[i].GetToPageId() == neighbors[j].GetToPageId() {
				return neighbors[i].GetLinkId() < neighbors[j].GetLinkId()
			}
			return neighbors[i].GetToPageId() < neighbors[j].GetToPageId()
		})
		for _, link := range neighbors {
			nextPageID := link.GetToPageId()
			if _, seen := visited[nextPageID]; seen {
				continue
			}
			visited[nextPageID] = struct{}{}
			queue = append(queue, traversalStep{pageID: nextPageID, depth: current.depth + 1})
		}
	}
	s.mu.RUnlock()

	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].GetDepth() == nodes[j].GetDepth() {
			return nodes[i].GetPageId() < nodes[j].GetPageId()
		}
		return nodes[i].GetDepth() < nodes[j].GetDepth()
	})
	start, end, next := sliceBounds(len(nodes), offset, pageSize)
	return &runtimev1.TraverseGraphResponse{Nodes: nodes[start:end], NextPageToken: next}, nil
}

func (s *Service) IngestDocument(_ context.Context, req *runtimev1.IngestDocumentRequest) (*runtimev1.IngestDocumentResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	slug := strings.TrimSpace(req.GetSlug())
	content := strings.TrimSpace(req.GetContent())
	if bankID == "" || slug == "" || content == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	now := time.Now().UTC()
	task := &runtimev1.KnowledgeIngestTask{
		TaskId:          ulid.Make().String(),
		BankId:          bankID,
		PageId:          strings.TrimSpace(req.GetPageId()),
		Slug:            slug,
		Title:           defaultPageTitle(slug, req.GetTitle()),
		Status:          runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_QUEUED,
		ProgressPercent: 0,
		ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:       timestamppb.New(now),
		UpdatedAt:       timestamppb.New(now),
	}
	s.ingestTasksByID[task.GetTaskId()] = &ingestTaskState{
		Task:  task,
		AppID: strings.TrimSpace(req.GetContext().GetAppId()),
	}
	if err := s.persistLocked(); err != nil {
		delete(s.ingestTasksByID, task.GetTaskId())
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	go s.runIngestTask(cloneIngestDocumentRequest(req), task.GetTaskId())

	return &runtimev1.IngestDocumentResponse{
		TaskId:     task.GetTaskId(),
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetIngestTask(_ context.Context, req *runtimev1.GetIngestTaskRequest) (*runtimev1.GetIngestTaskResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	taskID := strings.TrimSpace(req.GetTaskId())
	if taskID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.RLock()
	taskState := s.ingestTasksByID[taskID]
	s.mu.RUnlock()
	if taskState == nil || taskState.Task == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
	}
	if err := authorizeIngestTask(req.GetContext(), taskState); err != nil {
		return nil, err
	}
	return &runtimev1.GetIngestTaskResponse{Task: cloneKnowledgeIngestTask(taskState.Task)}, nil
}

func (s *Service) lookupPage(ctx *runtimev1.KnowledgeRequestContext, bankID, pageID, slug string) (*bankState, *runtimev1.KnowledgePage, error) {
	bankID = strings.TrimSpace(bankID)
	pageID = strings.TrimSpace(pageID)
	slug = strings.TrimSpace(slug)
	if bankID == "" || (pageID == "" && slug == "") {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(ctx, state.Bank); err != nil {
		return nil, nil, err
	}
	page := resolveExistingPage(state, pageID, slug)
	if page == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	return state, page, nil
}

func validateRequestContext(ctx *runtimev1.KnowledgeRequestContext) error {
	if strings.TrimSpace(ctx.GetAppId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func validateCreateBankAccess(ctx *runtimev1.KnowledgeRequestContext, locator *runtimev1.KnowledgeBankLocator) error {
	if locator == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if app := locator.GetAppPrivate(); app != nil {
		if strings.TrimSpace(app.GetAppId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if strings.TrimSpace(ctx.GetAppId()) != strings.TrimSpace(app.GetAppId()) {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED)
		}
		return nil
	}
	if workspace := locator.GetWorkspacePrivate(); workspace != nil {
		if strings.TrimSpace(workspace.GetWorkspaceId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return nil
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID)
}

func authorizeBank(ctx *runtimev1.KnowledgeRequestContext, bank *runtimev1.KnowledgeBank) error {
	if bank == nil || bank.GetLocator() == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if bank.GetLocator().GetAppPrivate() != nil {
		if strings.TrimSpace(ctx.GetAppId()) != strings.TrimSpace(bank.GetLocator().GetAppPrivate().GetAppId()) {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED)
		}
	}
	return nil
}

func fullLocatorFromPublic(locator *runtimev1.PublicKnowledgeBankLocator) (*runtimev1.KnowledgeBankLocator, error) {
	if locator == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if app := locator.GetAppPrivate(); app != nil {
		if strings.TrimSpace(app.GetAppId()) == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &runtimev1.KnowledgeBankLocator{
			Scope: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE,
			Owner: &runtimev1.KnowledgeBankLocator_AppPrivate{AppPrivate: cloneKnowledgeAppOwner(app)},
		}, nil
	}
	if workspace := locator.GetWorkspacePrivate(); workspace != nil {
		if strings.TrimSpace(workspace.GetWorkspaceId()) == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &runtimev1.KnowledgeBankLocator{
			Scope: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE,
			Owner: &runtimev1.KnowledgeBankLocator_WorkspacePrivate{WorkspacePrivate: cloneKnowledgeWorkspaceOwner(workspace)},
		}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID)
}

func locatorKey(locator *runtimev1.KnowledgeBankLocator) string {
	switch owner := locator.GetOwner().(type) {
	case *runtimev1.KnowledgeBankLocator_AppPrivate:
		return fmt.Sprintf("app_private:%s", strings.TrimSpace(owner.AppPrivate.GetAppId()))
	case *runtimev1.KnowledgeBankLocator_WorkspacePrivate:
		return fmt.Sprintf("workspace_private:%s", strings.TrimSpace(owner.WorkspacePrivate.GetWorkspaceId()))
	default:
		return ""
	}
}

func ownerFilterKey(filter *runtimev1.KnowledgeBankOwnerFilter) string {
	switch owner := filter.GetOwner().(type) {
	case *runtimev1.KnowledgeBankOwnerFilter_AppPrivate:
		return fmt.Sprintf("app_private:%s", strings.TrimSpace(owner.AppPrivate.GetAppId()))
	case *runtimev1.KnowledgeBankOwnerFilter_WorkspacePrivate:
		return fmt.Sprintf("workspace_private:%s", strings.TrimSpace(owner.WorkspacePrivate.GetWorkspaceId()))
	default:
		return ""
	}
}

func matchesBankFilters(bank *runtimev1.KnowledgeBank, scopes []runtimev1.KnowledgeBankScope, owners []*runtimev1.KnowledgeBankOwnerFilter) bool {
	if bank == nil || bank.GetLocator() == nil {
		return false
	}
	if len(scopes) > 0 {
		matched := false
		for _, scope := range scopes {
			if bank.GetLocator().GetScope() == scope {
				matched = true
				break
			}
		}
		if !matched {
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

func matchesPageFilters(page *runtimev1.KnowledgePage, entityTypes []string, slugPrefix string) bool {
	if page == nil {
		return false
	}
	if len(entityTypes) > 0 {
		matched := false
		for _, entityType := range entityTypes {
			if strings.EqualFold(strings.TrimSpace(entityType), strings.TrimSpace(page.GetEntityType())) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if prefix := strings.TrimSpace(slugPrefix); prefix != "" && !strings.HasPrefix(page.GetSlug(), prefix) {
		return false
	}
	return true
}

func matchesLinkTypeFilters(link *runtimev1.KnowledgeLink, linkTypes []string) bool {
	if link == nil {
		return false
	}
	if len(linkTypes) == 0 {
		return true
	}
	for _, linkType := range linkTypes {
		if strings.EqualFold(strings.TrimSpace(linkType), strings.TrimSpace(link.GetLinkType())) {
			return true
		}
	}
	return false
}

func resolveExistingPage(state *bankState, pageID, slug string) *runtimev1.KnowledgePage {
	pageID = strings.TrimSpace(pageID)
	slug = strings.TrimSpace(slug)
	if pageID != "" {
		if page := state.PagesByID[pageID]; page != nil {
			return page
		}
	}
	if slug != "" {
		if existingID := state.SlugToPage[slug]; existingID != "" {
			return state.PagesByID[existingID]
		}
	}
	return nil
}

func findDuplicateLink(state *bankState, fromPageID, toPageID, linkType string) *runtimev1.KnowledgeLink {
	if state == nil {
		return nil
	}
	for _, link := range state.LinksByID {
		if link == nil {
			continue
		}
		if link.GetFromPageId() == fromPageID && link.GetToPageId() == toPageID && strings.EqualFold(link.GetLinkType(), linkType) {
			return link
		}
	}
	return nil
}

func outgoingLinksForPage(state *bankState, pageID string, linkTypes []string) []*runtimev1.KnowledgeLink {
	items := make([]*runtimev1.KnowledgeLink, 0)
	if state == nil {
		return items
	}
	for _, link := range state.LinksByID {
		if link == nil || link.GetFromPageId() != pageID {
			continue
		}
		if !matchesLinkTypeFilters(link, linkTypes) {
			continue
		}
		items = append(items, link)
	}
	return items
}

func buildGraphEdge(state *bankState, link *runtimev1.KnowledgeLink) *runtimev1.KnowledgeGraphEdge {
	if state == nil || link == nil {
		return nil
	}
	fromPage := state.PagesByID[link.GetFromPageId()]
	toPage := state.PagesByID[link.GetToPageId()]
	return &runtimev1.KnowledgeGraphEdge{
		Link:           cloneKnowledgeLink(link),
		FromSlug:       pageStringValue(fromPage, func(page *runtimev1.KnowledgePage) string { return page.GetSlug() }),
		FromTitle:      pageStringValue(fromPage, func(page *runtimev1.KnowledgePage) string { return page.GetTitle() }),
		FromEntityType: pageStringValue(fromPage, func(page *runtimev1.KnowledgePage) string { return page.GetEntityType() }),
		ToSlug:         pageStringValue(toPage, func(page *runtimev1.KnowledgePage) string { return page.GetSlug() }),
		ToTitle:        pageStringValue(toPage, func(page *runtimev1.KnowledgePage) string { return page.GetTitle() }),
		ToEntityType:   pageStringValue(toPage, func(page *runtimev1.KnowledgePage) string { return page.GetEntityType() }),
	}
}

func pageStringValue(page *runtimev1.KnowledgePage, selector func(*runtimev1.KnowledgePage) string) string {
	if page == nil || selector == nil {
		return ""
	}
	return selector(page)
}

func defaultBankDisplayName(locator *runtimev1.KnowledgeBankLocator, displayName string) string {
	if trimmed := strings.TrimSpace(displayName); trimmed != "" {
		return trimmed
	}
	switch locator.GetScope() {
	case runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE:
		return "App Private Knowledge"
	case runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE:
		return "Workspace Private Knowledge"
	default:
		return "Knowledge Bank"
	}
}

func defaultPageTitle(slug, title string) string {
	if trimmed := strings.TrimSpace(title); trimmed != "" {
		return trimmed
	}
	return slug
}

func upsertPageLocked(state *bankState, req *runtimev1.PutPageRequest, now time.Time) *runtimev1.KnowledgePage {
	pageID := strings.TrimSpace(req.GetPageId())
	slug := strings.TrimSpace(req.GetSlug())
	existing := resolveExistingPage(state, pageID, slug)
	if existing == nil {
		if pageID == "" {
			pageID = ulid.Make().String()
		}
		page := &runtimev1.KnowledgePage{
			PageId:     pageID,
			BankId:     strings.TrimSpace(req.GetBankId()),
			Slug:       slug,
			Title:      defaultPageTitle(slug, req.GetTitle()),
			Content:    strings.TrimSpace(req.GetContent()),
			EntityType: strings.TrimSpace(req.GetEntityType()),
			Metadata:   cloneStruct(req.GetMetadata()),
			CreatedAt:  timestamppb.New(now),
			UpdatedAt:  timestamppb.New(now),
		}
		state.PagesByID[pageID] = page
		state.SlugToPage[slug] = pageID
		state.Bank.UpdatedAt = timestamppb.New(now)
		return page
	}

	if existing.GetSlug() != slug {
		delete(state.SlugToPage, existing.GetSlug())
		state.SlugToPage[slug] = existing.GetPageId()
	}
	existing.Slug = slug
	existing.Title = defaultPageTitle(slug, req.GetTitle())
	existing.Content = strings.TrimSpace(req.GetContent())
	existing.EntityType = strings.TrimSpace(req.GetEntityType())
	existing.Metadata = cloneStruct(req.GetMetadata())
	existing.UpdatedAt = timestamppb.New(now)
	state.Bank.UpdatedAt = timestamppb.New(now)
	return existing
}

func deriveBankID(locator *runtimev1.KnowledgeBankLocator) string {
	sum := sha256.Sum256([]byte(locatorKey(locator)))
	prefix := strings.TrimPrefix(strings.ToLower(locator.GetScope().String()), "knowledge_bank_scope_")
	return "nimi-knowledge-" + prefix + "-" + hex.EncodeToString(sum[:8])
}

func normalizeBankIDs(values []string) []string {
	items := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		items = append(items, value)
	}
	return items
}

func sliceBounds(total, offset, pageSize int) (start, end int, next string) {
	start = offset
	if start > total {
		start = total
	}
	end = start + pageSize
	if end > total {
		end = total
	}
	if end < total {
		next = encodePageToken(end)
	}
	return start, end, next
}

func clampPageSize(value int32, defaultValue, maxValue int) int {
	pageSize := int(value)
	if pageSize <= 0 {
		return defaultValue
	}
	if pageSize > maxValue {
		return maxValue
	}
	return pageSize
}

func encodePageToken(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

func decodePageToken(token string) (int, error) {
	if strings.TrimSpace(token) == "" {
		return 0, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	offset, err := strconv.Atoi(string(raw))
	if err != nil || offset < 0 {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	return offset, nil
}

func snippet(text string, query string) string {
	runes := []rune(text)
	if len(runes) <= 120 {
		return text
	}
	queryLower := strings.ToLower(query)
	textLower := strings.ToLower(text)
	idx := strings.Index(textLower, queryLower)
	if idx < 0 {
		return string(runes[:120])
	}
	start := utf8.RuneCountInString(text[:idx]) - 40
	if start < 0 {
		start = 0
	}
	end := start + 120
	if end > len(runes) {
		end = len(runes)
	}
	return string(runes[start:end])
}

func lexicalMatchScore(text string, queryLower string) float64 {
	textLower := strings.ToLower(strings.TrimSpace(text))
	if textLower == "" || queryLower == "" {
		return 0
	}
	count := strings.Count(textLower, queryLower)
	if count == 0 {
		return 0
	}
	return 1 + math.Min(float64(count-1)*0.25, 1.0)
}

func computeKnowledgeEmbedding(raw string, dimension int) []float64 {
	if dimension <= 0 {
		return nil
	}
	vector := make([]float64, dimension)
	tokens := strings.Fields(buildKnowledgeSearchTokens(raw))
	if len(tokens) == 0 {
		return vector
	}
	for _, token := range tokens {
		sum := sha256.Sum256([]byte(token))
		for idx := range vector {
			vector[idx] += float64(sum[idx%len(sum)])
		}
	}
	var norm float64
	for _, value := range vector {
		norm += value * value
	}
	if norm == 0 {
		return vector
	}
	norm = math.Sqrt(norm)
	for idx := range vector {
		vector[idx] = vector[idx] / norm
	}
	return vector
}

func cosineSimilarity(left []float64, right []float64) float64 {
	if len(left) == 0 || len(left) != len(right) {
		return 0
	}
	var dot float64
	for idx := range left {
		dot += left[idx] * right[idx]
	}
	return dot
}

func buildKnowledgeSearchTokens(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parts := make([]string, 0)
	var latinBuilder strings.Builder
	flushLatin := func() {
		if latinBuilder.Len() == 0 {
			return
		}
		token := strings.TrimSpace(strings.ToLower(latinBuilder.String()))
		if token != "" {
			parts = append(parts, token)
		}
		latinBuilder.Reset()
	}
	for _, r := range trimmed {
		switch {
		case unicode.IsLetter(r) || unicode.IsNumber(r):
			latinBuilder.WriteRune(unicode.ToLower(r))
		default:
			flushLatin()
		}
	}
	flushLatin()
	return strings.Join(parts, " ")
}

func maxFloat(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
}

func timestampValue(ts *timestamppb.Timestamp) time.Time {
	if ts == nil {
		return time.Time{}
	}
	return ts.AsTime().UTC()
}

func (s *Service) runIngestTask(req *runtimev1.IngestDocumentRequest, taskID string) {
	if err := s.setIngestTaskStatus(taskID, runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_RUNNING, 25, runtimev1.ReasonCode_ACTION_EXECUTED, "", ""); err != nil {
		s.logger.Warn("knowledge ingest task start persist failed", "task_id", taskID, "error", err)
		return
	}

	page, err := s.applyIngestDocument(taskID, req)
	if err != nil {
		reason := runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		if extracted, ok := grpcerr.ExtractReasonCode(err); ok {
			reason = extracted
		}
		actionHint := ""
		if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
			actionHint = strings.TrimSpace(metadata["action_hint"])
		}
		if actionHint == "" {
			actionHint = strings.TrimSpace(err.Error())
		}
		if updateErr := s.setIngestTaskStatus(taskID, runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_FAILED, 100, reason, "", actionHint); updateErr != nil {
			s.logger.Warn("knowledge ingest task failure persist failed", "task_id", taskID, "error", updateErr)
		}
		return
	}
	if err := s.setIngestTaskStatus(taskID, runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED, 100, runtimev1.ReasonCode_ACTION_EXECUTED, page.GetPageId(), ""); err != nil {
		s.logger.Warn("knowledge ingest task completion persist failed", "task_id", taskID, "error", err)
	}
}

func (s *Service) applyIngestDocument(taskID string, req *runtimev1.IngestDocumentRequest) (*runtimev1.KnowledgePage, error) {
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()

	taskState := s.ingestTasksByID[taskID]
	if taskState == nil || taskState.Task == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
	}
	state := s.banksByID[strings.TrimSpace(req.GetBankId())]
	if state == nil || state.Bank == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if strings.TrimSpace(taskState.AppID) != "" && strings.TrimSpace(taskState.AppID) != strings.TrimSpace(req.GetContext().GetAppId()) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}
	pageID := strings.TrimSpace(req.GetPageId())
	slug := strings.TrimSpace(req.GetSlug())
	slugOwnerPageID, slugTaken := state.SlugToPage[slug]
	if pageID != "" && slugTaken && slugOwnerPageID != pageID {
		return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_PAGE_SLUG_CONFLICT)
	}
	previousBank := cloneBankState(state)
	previousTask := cloneIngestTaskState(taskState)
	page := upsertPageLocked(state, &runtimev1.PutPageRequest{
		Context:    req.GetContext(),
		BankId:     req.GetBankId(),
		PageId:     req.GetPageId(),
		Slug:       req.GetSlug(),
		Title:      req.GetTitle(),
		Content:    req.GetContent(),
		EntityType: req.GetEntityType(),
		Metadata:   req.GetMetadata(),
	}, now)
	taskState.Task.PageId = page.GetPageId()
	taskState.Task.ProgressPercent = 80
	taskState.Task.UpdatedAt = timestamppb.New(now)
	taskState.Task.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
	if err := s.persistLocked(); err != nil {
		s.banksByID[state.Bank.GetBankId()] = previousBank
		s.ingestTasksByID[taskID] = previousTask
		return nil, err
	}
	return cloneKnowledgePage(page), nil
}

func (s *Service) setIngestTaskStatus(taskID string, status runtimev1.KnowledgeIngestTaskStatus, progressPercent int32, reason runtimev1.ReasonCode, pageID string, actionHint string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	taskState := s.ingestTasksByID[taskID]
	if taskState == nil || taskState.Task == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
	}
	previous := cloneIngestTaskState(taskState)
	taskState.Task.Status = status
	taskState.Task.ProgressPercent = clampTaskProgress(progressPercent)
	taskState.Task.ReasonCode = reason
	taskState.Task.ActionHint = strings.TrimSpace(actionHint)
	if strings.TrimSpace(pageID) != "" {
		taskState.Task.PageId = strings.TrimSpace(pageID)
	}
	taskState.Task.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := s.persistLocked(); err != nil {
		s.ingestTasksByID[taskID] = previous
		return err
	}
	return nil
}

func clampTaskProgress(value int32) int32 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func cloneStruct(value *structpb.Struct) *structpb.Struct {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*structpb.Struct)
	return cloned
}

func cloneKnowledgeBank(value *runtimev1.KnowledgeBank) *runtimev1.KnowledgeBank {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeBank)
	return cloned
}

func cloneKnowledgePage(value *runtimev1.KnowledgePage) *runtimev1.KnowledgePage {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgePage)
	return cloned
}

func cloneKnowledgeLink(value *runtimev1.KnowledgeLink) *runtimev1.KnowledgeLink {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeLink)
	return cloned
}

func cloneKnowledgeIngestTask(value *runtimev1.KnowledgeIngestTask) *runtimev1.KnowledgeIngestTask {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeIngestTask)
	return cloned
}

func cloneKnowledgeLocator(value *runtimev1.KnowledgeBankLocator) *runtimev1.KnowledgeBankLocator {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeBankLocator)
	return cloned
}

func cloneKnowledgeAppOwner(value *runtimev1.KnowledgeAppPrivateOwner) *runtimev1.KnowledgeAppPrivateOwner {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeAppPrivateOwner)
	return cloned
}

func cloneKnowledgeWorkspaceOwner(value *runtimev1.KnowledgeWorkspacePrivateOwner) *runtimev1.KnowledgeWorkspacePrivateOwner {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeWorkspacePrivateOwner)
	return cloned
}

func cloneBankState(value *bankState) *bankState {
	if value == nil {
		return nil
	}
	cloned := &bankState{
		Bank:       cloneKnowledgeBank(value.Bank),
		PagesByID:  make(map[string]*runtimev1.KnowledgePage, len(value.PagesByID)),
		SlugToPage: make(map[string]string, len(value.SlugToPage)),
		LinksByID:  make(map[string]*runtimev1.KnowledgeLink, len(value.LinksByID)),
	}
	for pageID, page := range value.PagesByID {
		cloned.PagesByID[pageID] = cloneKnowledgePage(page)
	}
	for slug, pageID := range value.SlugToPage {
		cloned.SlugToPage[slug] = pageID
	}
	for linkID, link := range value.LinksByID {
		cloned.LinksByID[linkID] = cloneKnowledgeLink(link)
	}
	return cloned
}

func cloneIngestTaskState(value *ingestTaskState) *ingestTaskState {
	if value == nil {
		return nil
	}
	return &ingestTaskState{
		Task:  cloneKnowledgeIngestTask(value.Task),
		AppID: value.AppID,
	}
}

func cloneIngestDocumentRequest(value *runtimev1.IngestDocumentRequest) *runtimev1.IngestDocumentRequest {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.IngestDocumentRequest)
	return cloned
}

func authorizeIngestTask(ctx *runtimev1.KnowledgeRequestContext, task *ingestTaskState) error {
	if task == nil || task.Task == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
	}
	if strings.TrimSpace(task.AppID) != "" && strings.TrimSpace(ctx.GetAppId()) != strings.TrimSpace(task.AppID) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED)
	}
	return nil
}
