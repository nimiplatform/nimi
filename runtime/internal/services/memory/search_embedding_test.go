package memory

import (
	"context"
	"math"
	"reflect"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestMemoryEmbeddingVectorsBatchAtSixteenWithPerBatchDeadlineAndStableOrder(t *testing.T) {
	t.Parallel()

	svc := newMemoryEmbeddingRuntimePrivateService(t)
	profile := &runtimev1.MemoryEmbeddingProfile{Dimension: 2}
	inputs := make([]string, 33)
	inputIndexes := make(map[string]int, len(inputs))
	for index := range inputs {
		inputs[index] = "input-" + string(rune('a'+index))
		inputIndexes[inputs[index]] = index
	}
	batchSizes := make([]int, 0, 3)
	svc.SetRuntimeEmbeddingVectorExecutor(func(ctx context.Context, _ *runtimev1.MemoryEmbeddingProfile, batch []string) ([][]float64, error) {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Fatal("embedding batch context has no deadline")
		}
		remaining := time.Until(deadline)
		if remaining < 19*time.Second || remaining > 21*time.Second {
			t.Fatalf("embedding batch deadline remaining = %s, want about 20s", remaining)
		}
		batchSizes = append(batchSizes, len(batch))
		vectors := make([][]float64, len(batch))
		for index, input := range batch {
			vectors[index] = []float64{float64(inputIndexes[input]), 1}
		}
		return vectors, nil
	})

	vectors, err := svc.embeddingVectors(context.Background(), profile, inputs)
	if err != nil {
		t.Fatalf("embeddingVectors: %v", err)
	}
	if !reflect.DeepEqual(batchSizes, []int{16, 16, 1}) {
		t.Fatalf("embedding batch sizes = %v, want [16 16 1]", batchSizes)
	}
	if len(vectors) != len(inputs) {
		t.Fatalf("embedding vector count = %d, want %d", len(vectors), len(inputs))
	}
	for index, vector := range vectors {
		if !reflect.DeepEqual(vector, []float64{float64(index), 1}) {
			t.Fatalf("embedding vector[%d] = %v, want stable input order", index, vector)
		}
	}
}

func TestMemoryEmbeddingVectorsRejectInvalidExecutorOutput(t *testing.T) {
	t.Parallel()

	profile := &runtimev1.MemoryEmbeddingProfile{Dimension: 2}
	inputs := []string{"alpha", "beta"}
	tests := []struct {
		name    string
		vectors [][]float64
	}{
		{name: "count", vectors: [][]float64{{1, 0}}},
		{name: "dimension", vectors: [][]float64{{1}, {0, 1}}},
		{name: "nan", vectors: [][]float64{{math.NaN(), 0}, {0, 1}}},
		{name: "positive_infinity", vectors: [][]float64{{math.Inf(1), 0}, {0, 1}}},
		{name: "negative_infinity", vectors: [][]float64{{math.Inf(-1), 0}, {0, 1}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := embeddingVectorsWithExecutor(context.Background(), func(context.Context, *runtimev1.MemoryEmbeddingProfile, []string) ([][]float64, error) {
				return test.vectors, nil
			}, profile, inputs)
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
				t.Fatalf("embedding output error = %v reason = %s present = %v, want AI_OUTPUT_INVALID", err, reason, ok)
			}
		})
	}
}
