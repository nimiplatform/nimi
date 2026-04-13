package memory

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
)

func (s *Service) CanonicalReviewStore() memoryengine.CanonicalReviewStore {
	if s == nil {
		return nil
	}
	return memoryengine.NewSQLiteCanonicalReviewStore(s.backend, s.reviewInputRecords)
}

func (s *Service) reviewInputRecords(_ context.Context, scope memoryengine.ScopeDescriptor, limit int) ([]*runtimev1.MemoryRecord, error) {
	locator, err := memoryengine.ScopeToMemoryBankLocator(scope)
	if err != nil {
		return nil, err
	}
	state, err := s.bankForLocator(locator)
	if err != nil {
		return nil, err
	}
	return s.historyRecords(state, &runtimev1.MemoryHistoryQuery{
		PageSize:           int32(limit),
		IncludeInvalidated: true,
	}), nil
}
