package memory

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
)

type ReviewTopicCluster = memoryengine.ReviewTopicCluster

func (s *Service) ClusterCanonicalReviewInputs(ctx context.Context, locator *runtimev1.MemoryBankLocator, checkpoint string, limit int) ([]ReviewTopicCluster, []*runtimev1.MemoryRecord, error) {
	if locator == nil {
		return nil, nil, nil
	}
	bankState, err := s.bankForLocator(locator)
	if err != nil {
		return nil, nil, err
	}
	inputs, err := s.ListCanonicalReviewInputs(ctx, locator, checkpoint, limit)
	if err != nil {
		return nil, nil, err
	}
	if bankState.Bank.GetEmbeddingProfile() == nil {
		return nil, inputs, nil
	}
	embeddings, err := s.reviewInputEmbeddings(locatorKey(locator), inputs)
	if err != nil {
		return nil, nil, err
	}
	clusters, leftovers := memoryengine.ClusterReviewRecords(inputs, embeddings)
	return clusters, leftovers, nil
}

func (s *Service) reviewInputEmbeddings(bankKey string, records []*runtimev1.MemoryRecord) (map[string][]float64, error) {
	if s == nil || s.backend == nil {
		return nil, nil
	}
	recordIDs := make(map[string]struct{}, len(records))
	for _, record := range records {
		if record == nil || record.GetMemoryId() == "" {
			continue
		}
		recordIDs[record.GetMemoryId()] = struct{}{}
	}
	if len(recordIDs) == 0 {
		return nil, nil
	}
	rows, err := s.backend.DB().Query(`
		SELECT memory_id, vector_json
		FROM memory_record_embedding
		WHERE locator_key = ?
	`, bankKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string][]float64, len(recordIDs))
	for rows.Next() {
		var memoryID string
		var vectorRaw string
		if err := rows.Scan(&memoryID, &vectorRaw); err != nil {
			return nil, err
		}
		if _, ok := recordIDs[memoryID]; !ok {
			continue
		}
		out[memoryID] = unmarshalFloatVector(vectorRaw)
	}
	return out, rows.Err()
}
