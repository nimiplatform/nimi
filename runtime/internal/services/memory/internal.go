package memory

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) SetManagedEmbeddingProfile(profile *runtimev1.MemoryEmbeddingProfile) {
	s.mu.Lock()
	s.managedEmbeddingProfile = cloneEmbeddingProfile(profile)
	s.mu.Unlock()
}

func (s *Service) ManagedEmbeddingProfile() *runtimev1.MemoryEmbeddingProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneEmbeddingProfile(s.managedEmbeddingProfile)
}

func (s *Service) ensureCurrentEmbeddingGenerationID(bank *runtimev1.MemoryBank, profile *runtimev1.MemoryEmbeddingProfile) string {
	if bank == nil || profile == nil {
		return ""
	}
	if existing := currentEmbeddingGenerationID(bank); existing != "" {
		return existing
	}
	seed := strings.Join([]string{
		"legacy",
		strings.TrimSpace(locatorKey(bank.GetLocator())),
		memoryEmbeddingProfileIdentity(profile),
	}, "|")
	generationID := embeddingGenerationID(seed)
	setCurrentEmbeddingGenerationID(bank, generationID)
	return generationID
}

func (s *Service) newEmbeddingGenerationID(locator *runtimev1.MemoryBankLocator, profile *runtimev1.MemoryEmbeddingProfile) string {
	seed := strings.Join([]string{
		"current",
		strings.TrimSpace(locatorKey(locator)),
		memoryEmbeddingProfileIdentity(profile),
		s.now().UTC().Format(time.RFC3339Nano),
	}, "|")
	return embeddingGenerationID(seed)
}

func (s *Service) SetRuntimeEmbeddingProfileResolver(resolver MemoryEmbeddingProfileResolver) {
	s.mu.Lock()
	s.runtimeEmbeddingResolver = resolver
	s.mu.Unlock()
}

func (s *Service) runtimeEmbeddingProfileResolver() MemoryEmbeddingProfileResolver {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.runtimeEmbeddingResolver
}

func (s *Service) SetRuntimeEmbeddingVectorExecutor(executor MemoryEmbeddingVectorExecutor) {
	s.mu.Lock()
	s.runtimeEmbeddingExecutor = executor
	s.mu.Unlock()
}

func (s *Service) runtimeEmbeddingVectorExecutor() MemoryEmbeddingVectorExecutor {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.runtimeEmbeddingExecutor
}

func (s *Service) EnsurePublicBankEmbeddingAvailability(bank *runtimev1.MemoryBank) error {
	if bank == nil {
		return status.Error(codes.InvalidArgument, "memory bank is required")
	}
	profile := bank.GetEmbeddingProfile()
	if profile == nil || s.embeddingAvailableForProfile(profile) {
		return nil
	}
	return memoryProviderUnavailableError()
}

func (s *Service) PersistenceBackend() *runtimepersistence.Backend {
	return s.backend
}

func LocatorKey(locator *runtimev1.MemoryBankLocator) string {
	return locatorKey(locator)
}

func (s *Service) EnsureCanonicalBank(ctx context.Context, locator *runtimev1.MemoryBankLocator, displayName string, metadata *structpb.Struct) (*runtimev1.MemoryBank, error) {
	key := locatorKey(locator)
	s.mu.RLock()
	existing := s.banks[key]
	s.mu.RUnlock()
	if existing != nil {
		return cloneBank(existing.Bank), nil
	}

	now := time.Now().UTC()
	bankID := deriveBankID(locator)
	bank := &runtimev1.MemoryBank{
		BankId:              bankID,
		Locator:             cloneLocator(locator),
		EmbeddingProfile:    nil,
		DisplayName:         firstNonEmpty(strings.TrimSpace(displayName), defaultCanonicalBankDisplayName(locator)),
		CanonicalAgentScope: true,
		PublicApiWritable:   false,
		Metadata:            cloneStruct(metadata),
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
	return cloneBank(bank), nil
}

func (s *Service) BindCanonicalBankEmbeddingProfile(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*runtimev1.MemoryBank, error) {
	profile := s.ManagedEmbeddingProfile()
	if profile == nil {
		return nil, memoryProviderUnavailableError()
	}
	return s.BindCanonicalBankResolvedEmbeddingProfile(ctx, locator, profile)
}

func (s *Service) BindCanonicalBankResolvedEmbeddingProfile(ctx context.Context, locator *runtimev1.MemoryBankLocator, profile *runtimev1.MemoryEmbeddingProfile) (*runtimev1.MemoryBank, error) {
	if profile == nil {
		return nil, memoryProviderUnavailableError()
	}
	key := locatorKey(locator)
	s.mu.Lock()
	state := s.banks[key]
	if state == nil {
		s.mu.Unlock()
		return nil, status.Error(codes.NotFound, "memory bank not found")
	}
	if !state.Bank.GetCanonicalAgentScope() {
		s.mu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "embedding profile bind is canonical-bank only")
	}
	if state.Bank.GetEmbeddingProfile() != nil {
		s.ensureCurrentEmbeddingGenerationID(state.Bank, state.Bank.GetEmbeddingProfile())
		result := cloneBank(state.Bank)
		s.mu.Unlock()
		return result, nil
	}
	state.Bank.EmbeddingProfile = cloneEmbeddingProfile(profile)
	setCurrentEmbeddingGenerationID(state.Bank, s.newEmbeddingGenerationID(locator, profile))
	state.PendingEmbeddingCutover = nil
	state.Bank.UpdatedAt = timestamppb.New(time.Now().UTC())
	for _, recordID := range state.Order {
		record := state.Records[recordID]
		if record == nil {
			continue
		}
		record.UpdatedAt = timestamppb.Now()
	}
	if err := s.persistLocked(); err != nil {
		state.Bank.EmbeddingProfile = nil
		s.mu.Unlock()
		return nil, err
	}
	result := cloneBank(state.Bank)
	s.mu.Unlock()
	return result, nil
}

func (s *Service) StageCanonicalBankEmbeddingCutover(ctx context.Context, locator *runtimev1.MemoryBankLocator, profile *runtimev1.MemoryEmbeddingProfile, revisionToken string) (*runtimev1.MemoryBank, error) {
	if profile == nil {
		return nil, memoryProviderUnavailableError()
	}
	key := locatorKey(locator)
	s.mu.Lock()
	state := s.banks[key]
	if state == nil {
		s.mu.Unlock()
		return nil, status.Error(codes.NotFound, "memory bank not found")
	}
	if !state.Bank.GetCanonicalAgentScope() {
		s.mu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "embedding profile staging is canonical-bank only")
	}
	if state.Bank.GetEmbeddingProfile() == nil {
		s.mu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "embedding profile staging requires bound canonical bank")
	}
	s.ensureCurrentEmbeddingGenerationID(state.Bank, state.Bank.GetEmbeddingProfile())
	previousPending := clonePendingEmbeddingCutoverState(state.PendingEmbeddingCutover)
	state.PendingEmbeddingCutover = &pendingEmbeddingCutoverState{
		GenerationID:      s.newEmbeddingGenerationID(locator, profile),
		TargetProfile:     cloneEmbeddingProfile(profile),
		RevisionToken:     strings.TrimSpace(revisionToken),
		ReadyForCutover:   false,
		BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
	}
	state.Bank.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := s.persistLocked(); err != nil {
		state.PendingEmbeddingCutover = previousPending
		s.mu.Unlock()
		return nil, err
	}
	result := cloneBank(state.Bank)
	s.mu.Unlock()
	return result, nil
}

func (s *Service) SetCanonicalBankEmbeddingCutoverReadiness(ctx context.Context, locator *runtimev1.MemoryBankLocator, ready bool, blockedReasonCode runtimev1.ReasonCode) (*runtimev1.MemoryBank, error) {
	key := locatorKey(locator)
	s.mu.Lock()
	state := s.banks[key]
	if state == nil {
		s.mu.Unlock()
		return nil, status.Error(codes.NotFound, "memory bank not found")
	}
	if !state.Bank.GetCanonicalAgentScope() {
		s.mu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "embedding profile cutover readiness is canonical-bank only")
	}
	if state.PendingEmbeddingCutover == nil || state.PendingEmbeddingCutover.TargetProfile == nil {
		result := cloneBank(state.Bank)
		s.mu.Unlock()
		return result, nil
	}
	previousPending := clonePendingEmbeddingCutoverState(state.PendingEmbeddingCutover)
	previousUpdatedAt := state.Bank.GetUpdatedAt()
	state.PendingEmbeddingCutover.ReadyForCutover = ready
	if ready {
		state.PendingEmbeddingCutover.BlockedReasonCode = runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	} else {
		state.PendingEmbeddingCutover.BlockedReasonCode = blockedReasonCode
	}
	state.Bank.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := s.persistLocked(); err != nil {
		state.PendingEmbeddingCutover = previousPending
		state.Bank.UpdatedAt = previousUpdatedAt
		s.mu.Unlock()
		return nil, err
	}
	result := cloneBank(state.Bank)
	s.mu.Unlock()
	return result, nil
}

func (s *Service) ClearCanonicalBankEmbeddingCutover(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*runtimev1.MemoryBank, error) {
	key := locatorKey(locator)
	s.mu.Lock()
	state := s.banks[key]
	if state == nil {
		s.mu.Unlock()
		return nil, status.Error(codes.NotFound, "memory bank not found")
	}
	if state.PendingEmbeddingCutover == nil {
		result := cloneBank(state.Bank)
		s.mu.Unlock()
		return result, nil
	}
	previousPending := clonePendingEmbeddingCutoverState(state.PendingEmbeddingCutover)
	state.PendingEmbeddingCutover = nil
	state.Bank.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := s.persistLocked(); err != nil {
		state.PendingEmbeddingCutover = previousPending
		s.mu.Unlock()
		return nil, err
	}
	result := cloneBank(state.Bank)
	s.mu.Unlock()
	return result, nil
}

func (s *Service) CommitCanonicalBankEmbeddingCutover(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*runtimev1.MemoryBank, error) {
	key := locatorKey(locator)
	s.mu.Lock()
	state := s.banks[key]
	if state == nil {
		s.mu.Unlock()
		return nil, status.Error(codes.NotFound, "memory bank not found")
	}
	if !state.Bank.GetCanonicalAgentScope() {
		s.mu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "embedding profile cutover is canonical-bank only")
	}
	if state.PendingEmbeddingCutover == nil || state.PendingEmbeddingCutover.TargetProfile == nil {
		result := cloneBank(state.Bank)
		s.mu.Unlock()
		return result, nil
	}
	if !state.PendingEmbeddingCutover.ReadyForCutover {
		s.mu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "embedding profile cutover is not ready")
	}
	previousProfile := cloneEmbeddingProfile(state.Bank.GetEmbeddingProfile())
	previousPending := clonePendingEmbeddingCutoverState(state.PendingEmbeddingCutover)
	previousGenerationID := currentEmbeddingGenerationID(state.Bank)
	state.Bank.EmbeddingProfile = cloneEmbeddingProfile(state.PendingEmbeddingCutover.TargetProfile)
	setCurrentEmbeddingGenerationID(state.Bank, state.PendingEmbeddingCutover.GenerationID)
	state.PendingEmbeddingCutover = nil
	now := time.Now().UTC()
	state.Bank.UpdatedAt = timestamppb.New(now)
	for _, recordID := range state.Order {
		record := state.Records[recordID]
		if record == nil {
			continue
		}
		record.UpdatedAt = timestamppb.New(now)
	}
	if err := s.persistLockedWithTxHook(clearNarrativeEmbeddingsForLocatorHook(locator)); err != nil {
		state.Bank.EmbeddingProfile = previousProfile
		setCurrentEmbeddingGenerationID(state.Bank, previousGenerationID)
		state.PendingEmbeddingCutover = previousPending
		s.mu.Unlock()
		return nil, err
	}
	result := cloneBank(state.Bank)
	s.mu.Unlock()
	return result, nil
}

func defaultCanonicalBankDisplayName(locator *runtimev1.MemoryBankLocator) string {
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		return "Agent Memory"
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		return "Agent Dyadic Memory"
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED:
		return "World Shared Memory"
	default:
		return defaultBankDisplayName(locator)
	}
}
