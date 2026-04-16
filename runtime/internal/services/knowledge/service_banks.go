package knowledge

import (
	"context"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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
