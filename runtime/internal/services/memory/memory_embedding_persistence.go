package memory

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

type preparedMemoryRecordEmbedding struct {
	LocatorKey string
	Dimension  int32
	Vector     []float64
}

type memoryRecordEmbeddingProjection map[string]preparedMemoryRecordEmbedding

func (s *Service) prepareMemoryRecordEmbeddingProjection(ctx context.Context, bank *runtimev1.MemoryBank, records []*runtimev1.MemoryRecord) (memoryRecordEmbeddingProjection, error) {
	if bank == nil || bank.GetEmbeddingProfile() == nil || len(records) == 0 {
		return nil, nil
	}
	raws := make([]string, 0, len(records))
	for _, record := range records {
		if record == nil {
			return nil, memoryEmbeddingOutputInvalidError()
		}
		raws = append(raws, memoryRecordEmbeddingInput(record))
	}
	vectors, err := s.embeddingVectors(ctx, bank.GetEmbeddingProfile(), raws)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(vectors) != len(records) {
		return nil, memoryEmbeddingOutputInvalidError()
	}
	projection := make(memoryRecordEmbeddingProjection, len(records))
	for index, record := range records {
		projection[record.GetMemoryId()] = preparedMemoryRecordEmbedding{
			LocatorKey: locatorKey(bank.GetLocator()),
			Dimension:  bank.GetEmbeddingProfile().GetDimension(),
			Vector:     append([]float64(nil), vectors[index]...),
		}
	}
	return projection, nil
}

func memoryEmbeddingProfilesEquivalent(left, right *runtimev1.MemoryEmbeddingProfile) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return embeddingProfilesMatch(left, right)
}

func memoryEmbeddingBankStateMatchesSnapshot(current, snapshot *bankState) bool {
	if current == nil || snapshot == nil || !proto.Equal(current.Bank, snapshot.Bank) || len(current.Order) != len(snapshot.Order) {
		return false
	}
	for index, recordID := range snapshot.Order {
		if current.Order[index] != recordID {
			return false
		}
		if !proto.Equal(current.Records[recordID], snapshot.Records[recordID]) {
			return false
		}
	}
	return true
}
