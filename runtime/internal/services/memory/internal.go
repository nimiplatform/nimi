package memory

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

func (s *Service) EnsureCanonicalBank(ctx context.Context, locator *runtimev1.MemoryBankLocator, displayName string, metadata *structpb.Struct) (*runtimev1.MemoryBank, error) {
	profile := s.ManagedEmbeddingProfile()
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
		EmbeddingProfile:    cloneEmbeddingProfile(profile),
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
