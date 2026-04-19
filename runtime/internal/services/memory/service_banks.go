package memory

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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
	if bank.GetEmbeddingProfile() != nil {
		setCurrentEmbeddingGenerationID(bank, embeddingGenerationID(strings.Join([]string{
			"create",
			strings.TrimSpace(locatorKey(locator)),
			memoryEmbeddingProfileIdentity(bank.GetEmbeddingProfile()),
			now.Format(time.RFC3339Nano),
		}, "|")))
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
	sortBanks(items)
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

func validateCreateBankRequest(req *runtimev1.CreateBankRequest, locator *runtimev1.MemoryBankLocator) error {
	if req.GetLocator() == nil || locator == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if profile := req.GetEmbeddingProfile(); profile != nil {
		if strings.TrimSpace(profile.GetProvider()) == "" || strings.TrimSpace(profile.GetModelId()) == "" || profile.GetDimension() <= 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
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
	key, err := memoryengine.LocatorKeyFromMemoryBankLocator(locator)
	if err != nil {
		return ""
	}
	return key
}

func ownerFilterKey(filter *runtimev1.MemoryBankOwnerFilter) string {
	key, err := memoryengine.OwnerFilterKey(filter)
	if err != nil {
		return ""
	}
	return key
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
