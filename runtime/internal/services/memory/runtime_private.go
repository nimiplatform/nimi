package memory

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
)

type TruthCandidate = memoryengine.TruthRecord

type NarrativeCandidate = memoryengine.NarrativeRecord

type RelationCandidate = memoryengine.RelationRecord

type CanonicalReviewOutcomes = memoryengine.ReviewOutcomes

type ReviewCheckpoint = memoryengine.ReviewCheckpoint

func (s *Service) ListAdmittedTruths(ctx context.Context, locator *runtimev1.MemoryBankLocator) ([]TruthCandidate, error) {
	scope, err := memoryengine.ScopeFromMemoryBankLocator(locator)
	if err != nil {
		return nil, err
	}
	items, err := s.CanonicalReviewStore().ListAdmittedTruths(ctx, scope)
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) ListNarrativeContext(ctx context.Context, locator *runtimev1.MemoryBankLocator, query string, limit int) ([]*runtimev1.NarrativeRecallHit, error) {
	return s.searchNarratives(ctx, locator, query, limit)
}

func (s *Service) ListCanonicalReviewInputs(ctx context.Context, locator *runtimev1.MemoryBankLocator, checkpoint string, limit int) ([]*runtimev1.MemoryRecord, error) {
	scope, err := memoryengine.ScopeFromMemoryBankLocator(locator)
	if err != nil {
		return nil, err
	}
	return s.CanonicalReviewStore().ListCanonicalReviewInputs(ctx, scope, checkpoint, limit)
}

func (s *Service) GetReviewCheckpoint(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*ReviewCheckpoint, error) {
	scope, err := memoryengine.ScopeFromMemoryBankLocator(locator)
	if err != nil {
		return nil, err
	}
	checkpoint, err := s.CanonicalReviewStore().GetReviewCheckpoint(ctx, scope)
	if err != nil {
		return nil, err
	}
	return checkpoint, nil
}

func (s *Service) CommitCanonicalReview(ctx context.Context, reviewRunID string, locator *runtimev1.MemoryBankLocator, checkpointBasis string, outcomes CanonicalReviewOutcomes) error {
	if strings.TrimSpace(reviewRunID) == "" || locator == nil {
		return fmt.Errorf("review_run_id and locator are required")
	}
	scope, err := memoryengine.ScopeFromMemoryBankLocator(locator)
	if err != nil {
		return err
	}
	return s.CanonicalReviewStore().CommitCanonicalReview(ctx, memoryengine.CommitCanonicalReviewRequest{
		ReviewRunID:     reviewRunID,
		Scope:           scope,
		CheckpointBasis: checkpointBasis,
		Outcomes:        outcomes,
	})
}

func (s *Service) ftsRecallScores(bank *runtimev1.MemoryBank, query string) map[string]float32 {
	if s.backend == nil || bank == nil {
		return nil
	}
	match := buildFTSQuery(query)
	if match == "" {
		return nil
	}
	rows, err := s.backend.DB().Query(`
		SELECT memory_id, rank
		FROM memory_record_fts
		WHERE locator_key = ? AND memory_record_fts MATCH ?
		ORDER BY rank
		LIMIT 32
	`, locatorKey(bank.GetLocator()), match)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make(map[string]float32)
	for rows.Next() {
		var memoryID string
		var rank float64
		if err := rows.Scan(&memoryID, &rank); err != nil {
			return nil
		}
		out[memoryID] = float32(1.0 / (1.0 + mathAbs(rank)))
	}
	return out
}

func (s *Service) embeddingRecallScores(bank *runtimev1.MemoryBank, query string) map[string]float64 {
	if bank == nil || bank.GetEmbeddingProfile() == nil || !s.embeddingAvailableForProfile(bank.GetEmbeddingProfile()) {
		return nil
	}
	queryVector := computeEmbeddingVector(query, bank.GetEmbeddingProfile().GetDimension())
	if len(queryVector) == 0 {
		return nil
	}
	rows, err := s.backend.DB().Query(`
		SELECT memory_id, vector_json
		FROM memory_record_embedding
		WHERE locator_key = ?
	`, locatorKey(bank.GetLocator()))
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make(map[string]float64)
	for rows.Next() {
		var memoryID string
		var vectorRaw string
		if err := rows.Scan(&memoryID, &vectorRaw); err != nil {
			return nil
		}
		out[memoryID] = cosineSimilarity(queryVector, unmarshalFloatVector(vectorRaw))
	}
	return out
}

func (s *Service) searchNarratives(ctx context.Context, locator *runtimev1.MemoryBankLocator, query string, limit int) ([]*runtimev1.NarrativeRecallHit, error) {
	if locator == nil {
		return nil, nil
	}
	scope, err := memoryengine.ScopeFromMemoryBankLocator(locator)
	if err != nil {
		return nil, err
	}
	return s.CanonicalReviewStore().ListNarrativeContext(ctx, scope, query, limit)
}

func mathAbs(input float64) float64 {
	if input < 0 {
		return -input
	}
	return input
}
